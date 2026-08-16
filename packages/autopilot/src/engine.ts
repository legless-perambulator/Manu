import { collectNameStats, type MappingSourceChapter } from "@jellytind/story-mapper";
import {
  AutopilotError,
  DEFAULT_SETTINGS,
  type AnalysisKind,
  type AutopilotJob,
  type AutopilotPorts,
  type AutopilotSettings,
  type AutopilotStatus,
  type ConflictResolution,
  type IntelFinding,
  type IntelProposal,
  type IntelStatus,
  type KnownEntity,
  type LearnedRules,
  type ProposalKind,
  type ProposalRisk,
  type ProseUnit,
  type SyncEstimate,
} from "./types";

/**
 * The autopilot engine.
 *
 * Everything is persisted under `.writer/autopilot/` before the engine moves
 * on, so a restart resumes queue, proposals and decisions from the files
 * alone (§32.15). Change detection is a fingerprint per prose unit: editing
 * one scene enqueues work for that scene and nothing else (§2, §33). The
 * queue always runs deterministic scans before semantic ones (§5), and
 * semantic work waits — visibly, with a reason — when the autopilot is
 * paused, no analyst is configured, or the budget is spent (§27, §28).
 *
 * The engine has no prose-writing port. Autopilot updates the map, never
 * the manuscript (§17, §21) — that is a property of the types, not a rule.
 */

export const AUTOPILOT_DIR = ".writer/autopilot";
const STATE_PATH = `${AUTOPILOT_DIR}/state.json`;
const QUEUE_PATH = `${AUTOPILOT_DIR}/queue.json`;
const PROPOSALS_PATH = `${AUTOPILOT_DIR}/proposals.json`;
const SETTINGS_PATH = `${AUTOPILOT_DIR}/settings.json`;
const LEARNING_PATH = `${AUTOPILOT_DIR}/learning.json`;

interface EngineState {
  readonly fingerprints: Record<string, number>;
  readonly month: string;
  readonly monthSpentUsd: number;
  readonly semanticCalls: number;
  readonly proposalSeq: number;
  /** Scenes touched by applies since the last incremental build (§26). */
  readonly affectedScenes: readonly string[];
}

const EMPTY_STATE: EngineState = {
  fingerprints: {},
  month: "",
  monthSpentUsd: 0,
  semanticCalls: 0,
  proposalSeq: 0,
  affectedScenes: [],
};

const EMPTY_RULES: LearnedRules = { aliases: [], notEntities: [] };

function fingerprint(text: string): number {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return hash;
}

const HONORIFIC_PREFIX =
  /^(?:Detective|Inspector|Sergeant|Captain|Professor|Doctor|Father|Sister|Aunt|Uncle|Lady|Lord|Mr\.?|Mrs\.?|Ms\.?|Miss|Dr\.?)\s+/;

/** "Detective Ellison" reads as "Mara Ellison": stripped-token subset match. */
function aliasTarget(name: string, entities: readonly KnownEntity[]): KnownEntity | null {
  const words = name.replace(HONORIFIC_PREFIX, "").trim().split(/\s+/);
  if (words.length === 0 || words[0] === "") return null;
  const matches = entities.filter((entity) => {
    const known = new Set(
      [entity.name, ...entity.aliases]
        .flatMap((held) => held.replace(HONORIFIC_PREFIX, "").split(/\s+/))
        .filter((held) => held !== ""),
    );
    return words.every((word) => known.has(word));
  });
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function knownName(name: string, entities: readonly KnownEntity[]): boolean {
  const flat = name.trim().toLowerCase();
  return entities.some(
    (entity) =>
      entity.name.toLowerCase() === flat ||
      entity.aliases.some((alias) => alias.toLowerCase() === flat),
  );
}

const SEMANTIC_KINDS: readonly AnalysisKind[] = [
  "scene",
  "state",
  "knowledge",
  "relationships",
  "objects",
  "threads",
  "timeline",
  "facts",
];

const KIND_OF: Readonly<Record<AnalysisKind, ProposalKind>> = {
  scene: "scene_metadata",
  state: "state_transition",
  knowledge: "knowledge",
  relationships: "relationship",
  objects: "object_transfer",
  threads: "thread",
  timeline: "timeline",
  facts: "fact",
};

/**
 * Risk per kind (§9, §11, §15). Objective state and object movement are low
 * risk — checkable against prose. Relationships, facts and new structure
 * carry interpretation, so they never auto-apply below "review".
 */
const RISK_OF: Readonly<Record<ProposalKind, ProposalRisk>> = {
  new_entity: "medium",
  alias: "low",
  scene_metadata: "low",
  state_transition: "low",
  knowledge: "medium",
  relationship: "medium",
  object_transfer: "low",
  thread: "medium",
  timeline: "medium",
  fact: "medium",
};

const BRIEFING: Readonly<Record<AnalysisKind, string>> = {
  scene:
    "Identify this scene's point of view, location, participants, purpose and conflict. Report only what the prose states.",
  state:
    "Identify objective state changes: who moved where, what changed hands, physical condition changes. Only what the prose shows.",
  knowledge:
    "Identify who learns, is told, or comes to falsely believe what, with the sentence that shows it.",
  relationships:
    "Identify meaningful relationship shifts — betrayals, alliances, ruptures. Ignore moment-to-moment mood.",
  objects:
    "Identify significant recurring objects and any transfer or state change. Ignore incidental props.",
  threads:
    "Identify plot-thread movement: a new thread, an advancement, a resolution, a setup or a payoff.",
  timeline:
    "Identify chronology signals: explicit times, jumps, flashbacks, parallel action. Do not invent precision the prose lacks.",
  facts: "Identify facts the prose strongly establishes about the world or its people.",
};

export class Autopilot {
  private constructor(
    private readonly ports: AutopilotPorts,
    private state: EngineState,
    private queue: AutopilotJob[],
    private proposals: IntelProposal[],
    private settings: AutopilotSettings,
    private rules: LearnedRules,
  ) {}

  static async open(ports: AutopilotPorts): Promise<Autopilot> {
    const read = async <T>(path: string, fallback: T): Promise<T> => {
      const raw = await ports.files.readProjectFile(path);
      return raw === null || raw.trim() === "" ? fallback : (JSON.parse(raw) as T);
    };
    return new Autopilot(
      ports,
      await read(STATE_PATH, EMPTY_STATE),
      await read(QUEUE_PATH, [] as AutopilotJob[]),
      await read(PROPOSALS_PATH, [] as IntelProposal[]),
      await read(SETTINGS_PATH, DEFAULT_SETTINGS),
      await read(LEARNING_PATH, EMPTY_RULES),
    );
  }

  private now(): string {
    return this.ports.now?.() ?? new Date().toISOString();
  }

  private async persist(): Promise<void> {
    const write = (path: string, value: unknown) =>
      this.ports.files.writeProjectFile(path, JSON.stringify(value, null, 2));
    await write(STATE_PATH, this.state);
    await write(QUEUE_PATH, this.queue);
    await write(PROPOSALS_PATH, this.proposals);
    await write(SETTINGS_PATH, this.settings);
    await write(LEARNING_PATH, this.rules);
  }

  getSettings(): AutopilotSettings {
    return this.settings;
  }

  async configure(patch: Partial<AutopilotSettings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    await this.persist();
  }

  list(status?: IntelStatus): readonly IntelProposal[] {
    return status === undefined
      ? this.proposals
      : this.proposals.filter((held) => held.status === status);
  }

  /** §25: what may feed authoritative context — decided intelligence only. */
  confirmed(): readonly IntelProposal[] {
    return this.proposals.filter(
      (held) => held.status === "accepted" || held.status === "auto_applied",
    );
  }

  /** §25: supplied only as explicitly uncertain context, never as truth. */
  uncertain(): readonly IntelProposal[] {
    return this.proposals.filter(
      (held) => held.status === "needs_review" || held.status === "conflict",
    );
  }

  /** §26: scenes whose applied intelligence changed since last collection. */
  takeAffectedScenes(): readonly string[] {
    const affected = this.state.affectedScenes;
    this.state = { ...this.state, affectedScenes: [] };
    return affected;
  }

  status(): AutopilotStatus {
    const needsReview = this.list("needs_review").length;
    const conflicts = this.list("conflict").length;
    const pendingJobs = this.queue.length;
    let waiting: string | undefined;
    if (this.settings.paused) waiting = "Background intelligence is paused.";
    else if (this.ports.analyst === null && this.queue.some((j) => j.kind === "semantic_scan")) {
      waiting = "Semantic analysis waits for a configured model.";
    } else if (this.overBudget() && this.queue.some((j) => j.kind === "semantic_scan")) {
      waiting = "The monthly background-analysis budget is spent.";
    }
    const label = this.settings.paused
      ? "Paused"
      : pendingJobs > 0
        ? "Syncing…"
        : conflicts > 0
          ? `${String(conflicts)} conflict(s) need you`
          : needsReview > 0
            ? `${String(needsReview)} item(s) need review`
            : "Story Intelligence synced";
    return {
      label,
      needsReview,
      conflicts,
      pendingJobs,
      paused: this.settings.paused,
      ...(waiting !== undefined ? { waiting } : {}),
    };
  }

  /**
   * §23: after Map Manuscript has applied its mapping, the autopilot records
   * the manuscript as known-synchronised and takes over from there.
   */
  async markSynced(): Promise<void> {
    const units = await this.ports.units();
    const fingerprints: Record<string, number> = {};
    for (const unit of units) fingerprints[unit.sceneId] = fingerprint(unit.text);
    this.state = { ...this.state, fingerprints };
    this.queue = [];
    await this.persist();
  }

  /**
   * §2, §4: called after autosave, idle, focus loss or manual sync — never
   * per keystroke (the caller debounces). Enqueues work only for units whose
   * prose actually changed.
   */
  async noteChange(): Promise<readonly string[]> {
    const units = await this.ports.units();
    const changed: string[] = [];
    const fingerprints = { ...this.state.fingerprints };
    for (const unit of units) {
      const print = fingerprint(unit.text);
      if (fingerprints[unit.sceneId] === print) continue;
      fingerprints[unit.sceneId] = print;
      changed.push(unit.sceneId);
      this.enqueue(unit.sceneId);
    }
    this.state = { ...this.state, fingerprints };
    await this.persist();
    return changed;
  }

  /** §24: force analysis of a scope, changed or not. */
  async sync(scope: { sceneIds?: readonly string[]; all?: boolean }): Promise<void> {
    const units = await this.ports.units();
    const chosen = scope.all
      ? units
      : units.filter((unit) => scope.sceneIds?.includes(unit.sceneId) === true);
    const fingerprints = { ...this.state.fingerprints };
    for (const unit of chosen) {
      fingerprints[unit.sceneId] = fingerprint(unit.text);
      this.enqueue(unit.sceneId);
    }
    this.state = { ...this.state, fingerprints };
    await this.persist();
  }

  /** §24: what a full sync would take, so the writer decides informed. */
  async estimateSync(scope: {
    all?: boolean;
    sceneIds?: readonly string[];
  }): Promise<SyncEstimate> {
    const units = await this.ports.units();
    const count = scope.all ? units.length : (scope.sceneIds?.length ?? 0);
    const semanticCalls = count * SEMANTIC_KINDS.length;
    const price = this.ports.analyst?.costPerCallUsd;
    return {
      scenes: count,
      semanticCalls,
      ...(price !== undefined ? { estimatedUsd: semanticCalls * price } : {}),
    };
  }

  private enqueue(sceneId: string): void {
    for (const kind of ["deterministic_scan", "semantic_scan"] as const) {
      if (!this.queue.some((job) => job.sceneId === sceneId && job.kind === kind)) {
        this.queue.push({
          id: `JOB_${String(this.queue.length + 1)}_${kind}_${sceneId}`,
          kind,
          sceneId,
          createdAt: this.now(),
        });
      }
    }
  }

  private overBudget(): boolean {
    const budget = this.settings.monthlyBudgetUsd;
    return budget !== undefined && this.state.monthSpentUsd >= budget;
  }

  /**
   * Process queued work. Deterministic first, semantic second (§5); bounded
   * by `limit` jobs per call so the caller stays responsive (§1).
   */
  async drain(limit = 8): Promise<void> {
    if (this.settings.paused) return;
    let done = 0;
    while (done < limit) {
      const job =
        this.queue.find((held) => held.kind === "deterministic_scan") ??
        this.queue.find((held) => held.kind === "semantic_scan");
      if (job === undefined) break;
      if (job.kind === "semantic_scan" && (this.ports.analyst === null || this.overBudget())) {
        break; // Waits visibly; status() says why.
      }
      const units = await this.ports.units();
      const unit = units.find((held) => held.sceneId === job.sceneId);
      this.queue = this.queue.filter((held) => held.id !== job.id);
      if (unit !== undefined) {
        if (job.kind === "deterministic_scan") await this.deterministicScan(unit);
        else await this.semanticScan(unit);
      }
      done += 1;
      await this.persist();
    }
  }

  // ── Deterministic extraction (§5, §6, §7) ─────────────────────────────────

  private async deterministicScan(unit: ProseUnit): Promise<void> {
    const entities = await this.ports.entities();
    const chapter: MappingSourceChapter = {
      index: 0,
      chapterId: unit.chapterId,
      title: unit.title,
      text: unit.text,
    };
    const stats = collectNameStats([chapter]);

    for (const [name, held] of stats) {
      if (knownName(name, entities)) continue;
      const rule = this.rules.aliases.find((r) => r.alias.toLowerCase() === name.toLowerCase());
      if (rule !== undefined) continue; // Learned: already linked (§19).
      if (this.rules.notEntities.some((n) => n.toLowerCase() === name.toLowerCase())) continue;

      const target = aliasTarget(name, entities);
      if (target !== null) {
        // §7: a likely alias of an existing entity, with high confidence
        // when nothing else could own it.
        await this.propose(unit, {
          kind: "alias",
          origin: "deterministic",
          confidence: "high",
          summary: `“${name}” is likely ${target.name}.`,
          because: `Every word of “${name}” matches ${target.name} and no other entity.`,
          payload: { alias: name, entityId: target.id, entityName: target.name },
        });
        continue;
      }
      // §6: repeated unknown names become entity proposals — never every
      // capitalised noun (mentions and dialogue thresholds hold that line).
      if (held.mentions >= 3 && held.midSentence > 0) {
        const exists = this.proposals.some(
          (p) =>
            p.kind === "new_entity" &&
            (p.status === "needs_review" || p.status === "rejected" || p.status === "ignored") &&
            String(p.payload["name"]) === name,
        );
        if (!exists) {
          await this.propose(unit, {
            kind: "new_entity",
            origin: "deterministic",
            confidence: held.dialogue > 0 ? "high" : "medium",
            summary: `Possible new character: ${name}.`,
            because: `“${name}” appears ${String(held.mentions)} time(s)${held.dialogue > 0 ? " and speaks" : ""}, and no existing entity matches.`,
            payload: { name, mentions: held.mentions },
          });
        }
      }
    }
  }

  // ── Semantic extraction (§8–§15) ──────────────────────────────────────────

  private async semanticScan(unit: ProseUnit): Promise<void> {
    const analyst = this.ports.analyst;
    if (analyst === null) return;
    for (const kind of SEMANTIC_KINDS) {
      if (this.overBudget()) return;
      const findings = await analyst.read(kind, {
        sceneId: unit.sceneId,
        sceneTitle: unit.title,
        text: unit.text,
        briefing: BRIEFING[kind],
      });
      this.state = {
        ...this.state,
        semanticCalls: this.state.semanticCalls + 1,
        monthSpentUsd: this.state.monthSpentUsd + (analyst.costPerCallUsd ?? 0),
      };
      for (const finding of findings) {
        await this.proposeFromFinding(unit, kind, finding);
      }
    }
  }

  private async proposeFromFinding(
    unit: ProseUnit,
    kind: AnalysisKind,
    finding: IntelFinding,
  ): Promise<void> {
    const proposalKind = KIND_OF[kind];
    // §20: explicit author metadata is authoritative — the autopilot does
    // not even propose over it, let alone write it.
    if (proposalKind === "scene_metadata" && unit.authoritative !== undefined) {
      const field = String(finding.payload?.["field"] ?? "");
      if (field !== "" && unit.authoritative.includes(field)) return;
    }
    await this.propose(
      unit,
      {
        kind: proposalKind,
        origin: "model",
        confidence: finding.confidence,
        summary: finding.summary,
        because: BRIEFING[kind],
        payload: finding.payload ?? {},
        ...(finding.quote !== undefined ? { quote: finding.quote } : {}),
      },
      finding.conflictsWith,
    );
  }

  private async propose(
    unit: ProseUnit,
    draft: {
      kind: ProposalKind;
      origin: "deterministic" | "model";
      confidence: IntelProposal["confidence"];
      summary: string;
      because: string;
      payload: Readonly<Record<string, unknown>>;
      quote?: string;
    },
    conflictsWith?: string,
  ): Promise<void> {
    const seq = this.state.proposalSeq + 1;
    this.state = { ...this.state, proposalSeq: seq };
    const risk = RISK_OF[draft.kind];
    let proposal: IntelProposal = {
      id: `INT_${String(seq).padStart(4, "0")}`,
      kind: draft.kind,
      status: "needs_review",
      confidence: draft.confidence,
      risk,
      origin: draft.origin,
      summary: draft.summary,
      because: draft.because,
      evidence: [
        {
          sceneId: unit.sceneId,
          sceneTitle: unit.title,
          ...(draft.quote !== undefined ? { quote: draft.quote } : {}),
        },
      ],
      payload: draft.payload,
      createdAt: this.now(),
    };

    // §21: a contradiction never picks a side silently.
    const conflict = conflictsWith ?? (await this.ports.conflictCheck?.(proposal)) ?? undefined;
    if (conflict !== undefined) {
      proposal = { ...proposal, status: "conflict", conflictsWith: conflict };
      this.proposals.push(proposal);
      return;
    }

    if (this.shouldAutoApply(proposal)) {
      const records = await this.ports.applier.apply(proposal);
      proposal = {
        ...proposal,
        status: "auto_applied",
        decidedAt: this.now(),
        appliedRecords: records,
      };
      // An auto-linked alias is a correction the writer will keep or revert;
      // either way the rule is on record and future scans use it (§19).
      await this.learnFrom(proposal, "accepted");
      this.noteAffected(unit.sceneId);
    }
    this.proposals.push(proposal);
  }

  /** §17. Never auto-applies high risk; policy widens only low-risk reach. */
  private shouldAutoApply(proposal: IntelProposal): boolean {
    if (proposal.risk !== "low") return false;
    switch (this.settings.policy) {
      case "conservative":
        return false;
      case "balanced":
        return proposal.confidence === "high";
      case "automatic":
        return proposal.confidence === "high" || proposal.confidence === "medium";
    }
  }

  private noteAffected(sceneId: string): void {
    if (!this.state.affectedScenes.includes(sceneId)) {
      this.state = { ...this.state, affectedScenes: [...this.state.affectedScenes, sceneId] };
    }
  }

  // ── Decisions (§16, §18, §19, §21) ────────────────────────────────────────

  private find(id: string): IntelProposal {
    const found = this.proposals.find((held) => held.id === id);
    if (found === undefined) {
      throw new AutopilotError("unknown_proposal", `No proposal named "${id}".`);
    }
    return found;
  }

  private async replace(next: IntelProposal): Promise<void> {
    this.proposals = this.proposals.map((held) => (held.id === next.id ? next : held));
    await this.persist();
  }

  async accept(id: string): Promise<IntelProposal> {
    const proposal = this.find(id);
    if (proposal.status !== "needs_review") {
      throw new AutopilotError("not_applicable", "Only proposals under review can be accepted.");
    }
    const records = await this.ports.applier.apply(proposal);
    const next: IntelProposal = {
      ...proposal,
      status: "accepted",
      decidedAt: this.now(),
      appliedRecords: records,
    };
    await this.learnFrom(next, "accepted");
    for (const held of next.evidence) this.noteAffected(held.sceneId);
    await this.replace(next);
    return next;
  }

  async reject(id: string): Promise<IntelProposal> {
    const proposal = this.find(id);
    const next: IntelProposal = { ...proposal, status: "rejected", decidedAt: this.now() };
    await this.learnFrom(next, "rejected");
    await this.replace(next);
    return next;
  }

  async ignore(id: string): Promise<IntelProposal> {
    const next: IntelProposal = { ...this.find(id), status: "ignored", decidedAt: this.now() };
    await this.replace(next);
    return next;
  }

  /** Undo an applied proposal — auto-applied intelligence stays reversible. */
  async revert(id: string): Promise<IntelProposal> {
    const proposal = this.find(id);
    if (proposal.appliedRecords === undefined || proposal.appliedRecords.length === 0) {
      throw new AutopilotError("not_applicable", "Nothing was applied for this proposal.");
    }
    if (this.ports.applier.revert === undefined) {
      throw new AutopilotError("not_applicable", "Reverting is not available here.");
    }
    await this.ports.applier.revert(proposal.appliedRecords);
    const next: IntelProposal = { ...proposal, status: "rejected", decidedAt: this.now() };
    await this.replace(next);
    return next;
  }

  /** §21: the writer's four ways out of a conflict, minus rewriting prose. */
  async resolveConflict(
    id: string,
    resolution: ConflictResolution,
    note?: string,
  ): Promise<IntelProposal> {
    const proposal = this.find(id);
    if (proposal.status !== "conflict") {
      throw new AutopilotError("not_applicable", "This proposal is not a conflict.");
    }
    let next: IntelProposal;
    switch (resolution) {
      case "update_canon": {
        const records = await this.ports.applier.apply(proposal);
        next = {
          ...proposal,
          status: "accepted",
          decidedAt: this.now(),
          appliedRecords: records,
        };
        for (const held of next.evidence) this.noteAffected(held.sceneId);
        break;
      }
      case "explain_exception":
        next = {
          ...proposal,
          status: "accepted",
          decidedAt: this.now(),
          exception: note ?? "The writer marked this as a deliberate exception.",
        };
        break;
      case "ignore":
        next = { ...proposal, status: "ignored", decidedAt: this.now() };
        break;
    }
    await this.replace(next);
    return next;
  }

  /**
   * §19: corrections teach the project. Accepting an alias stores the rule;
   * rejecting a discovery stores "not an entity". Never model fine-tuning —
   * a JSON file the writer can read.
   */
  private async learnFrom(
    proposal: IntelProposal,
    outcome: "accepted" | "rejected",
  ): Promise<void> {
    if (proposal.kind === "alias") {
      const alias = String(proposal.payload["alias"] ?? "");
      const entityId = String(proposal.payload["entityId"] ?? "");
      if (outcome === "accepted" && alias !== "" && entityId !== "") {
        if (!this.rules.aliases.some((held) => held.alias === alias)) {
          this.rules = { ...this.rules, aliases: [...this.rules.aliases, { alias, entityId }] };
        }
      }
    }
    if (proposal.kind === "new_entity" && outcome === "rejected") {
      const name = String(proposal.payload["name"] ?? "");
      if (name !== "" && !this.rules.notEntities.includes(name)) {
        this.rules = { ...this.rules, notEntities: [...this.rules.notEntities, name] };
      }
    }
  }

  learned(): LearnedRules {
    return this.rules;
  }
}
