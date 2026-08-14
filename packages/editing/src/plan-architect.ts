import {
  checkPermission,
  createTask,
  transition,
  type PermissionGrant,
} from "@jellytind/agent-runtime";
import { ContextCompiler, renderContextPackage } from "@jellytind/context-compiler";
import type {
  ChapterPlan,
  FactConstraint,
  KnowledgeChangePlan,
  PlanFinding,
  PlannedKnowledgeState,
  PlannedScene,
} from "@jellytind/domain";
import { ModelError, type LanguageModel, type OutputSchema } from "@jellytind/model-router";
import { resolveSceneRange, type StoryRepository } from "@jellytind/story-repository";
import { EditError } from "./types";

/**
 * Structured plan generation and plan-vs-draft comparison (Phase 32 §4, §8).
 *
 * The Story Architect's planning face: it proposes a **structured, validated
 * chapter plan** — not prose advice — from the chapter's compiled context, the
 * current story state and the writer's instruction. The proposal is saved as a
 * `draft` plan through the ordinary journaled path; nothing reads a draft, and
 * approval is the writer's alone (§5).
 *
 * Everything the model returns is filtered against the project before it is
 * kept: an ID the project does not contain never enters the plan. It is set
 * aside into the plan's notes instead, so the writer can see what the model
 * tried to reference rather than wondering what was silently dropped.
 */

interface RawScene {
  readonly title: string;
  readonly pov?: string;
  readonly locationId?: string;
  readonly characterIds: readonly string[];
  readonly objectIds: readonly string[];
  readonly objective?: string;
  readonly conflict?: string;
  readonly entryState?: string;
  readonly exitState?: string;
  readonly beats: readonly string[];
  readonly revelations: readonly string[];
  readonly knowledgeChanges: readonly Record<string, unknown>[];
  readonly plotThreadIds: readonly string[];
  readonly setupIds: readonly string[];
  readonly payoffSetupIds: readonly string[];
  readonly requiredFactIds: readonly string[];
  readonly minWords?: number;
  readonly maxWords?: number;
  readonly transitionIntent?: string;
}

interface RawPlan {
  readonly objective?: string;
  readonly chapterRole?: string;
  readonly openingState?: string;
  readonly closingState?: string;
  readonly scenes: readonly RawScene[];
  readonly forbiddenFacts: readonly Record<string, unknown>[];
  readonly constraints: readonly string[];
  readonly notes: readonly string[];
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
      )
    : [];

const PLAN_SCHEMA: OutputSchema<RawPlan> = {
  name: "ChapterPlanProposal",
  parse(value: unknown): RawPlan {
    if (typeof value !== "object" || value === null) {
      throw new EditError("empty_response", "ChapterPlanProposal: expected an object.");
    }
    const raw = value as Record<string, unknown>;
    const scenes = records(raw.scenes).map((scene): RawScene => {
      const title = text(scene.title);
      if (title === undefined) {
        throw new EditError("empty_response", "ChapterPlanProposal: every scene needs a title.");
      }
      return {
        title,
        ...(text(scene.pov) !== undefined ? { pov: text(scene.pov) } : {}),
        ...(text(scene.locationId) !== undefined ? { locationId: text(scene.locationId) } : {}),
        characterIds: strings(scene.characterIds),
        objectIds: strings(scene.objectIds),
        ...(text(scene.objective) !== undefined ? { objective: text(scene.objective) } : {}),
        ...(text(scene.conflict) !== undefined ? { conflict: text(scene.conflict) } : {}),
        ...(text(scene.entryState) !== undefined ? { entryState: text(scene.entryState) } : {}),
        ...(text(scene.exitState) !== undefined ? { exitState: text(scene.exitState) } : {}),
        beats: strings(scene.beats),
        revelations: strings(scene.revelations),
        knowledgeChanges: records(scene.knowledgeChanges),
        plotThreadIds: strings(scene.plotThreadIds),
        setupIds: strings(scene.setupIds),
        payoffSetupIds: strings(scene.payoffSetupIds),
        requiredFactIds: strings(scene.requiredFactIds),
        ...(typeof scene.minWords === "number" ? { minWords: scene.minWords } : {}),
        ...(typeof scene.maxWords === "number" ? { maxWords: scene.maxWords } : {}),
        ...(text(scene.transitionIntent) !== undefined
          ? { transitionIntent: text(scene.transitionIntent) }
          : {}),
      };
    });
    if (scenes.length === 0) {
      throw new EditError("empty_response", "ChapterPlanProposal: no scenes were proposed.");
    }
    return {
      ...(text(raw.objective) !== undefined ? { objective: text(raw.objective) } : {}),
      ...(text(raw.chapterRole) !== undefined ? { chapterRole: text(raw.chapterRole) } : {}),
      ...(text(raw.openingState) !== undefined ? { openingState: text(raw.openingState) } : {}),
      ...(text(raw.closingState) !== undefined ? { closingState: text(raw.closingState) } : {}),
      scenes,
      forbiddenFacts: records(raw.forbiddenFacts),
      constraints: strings(raw.constraints),
      notes: strings(raw.notes),
    };
  },
};

const SYSTEM_PROMPT = `You are a story architect working inside Manu, a fiction development environment.

You are given compiled context for one chapter: the project's outline material, the story state entering the chapter, the live plot threads, the characters and their arcs, and the adjacent chapters. Propose a structured plan for the chapter — its scenes, their beats, and the knowledge and relationship changes they make.

Rules:
- Use only the entity IDs present in the context (CHAR_/LOC_/THREAD_/FACT_/SETUP_/OBJECT_). Never invent an ID. Anything without an ID belongs in prose fields, not ID fields.
- Beats are short narrative statements of what happens, in order. Three to eight per scene; not screenplay micro-beats.
- Honour the writer's instruction exactly. If it forbids a character understanding something, record that as a forbiddenFacts entry, and do not plan a scene that grants it.
- knowledgeChanges record what a character comes to hold: state one of known, believed, suspected, disbelieved, unknown; name the source entity when there is one.
- You are proposing, not deciding. A human reviews and edits everything before it is used.`;

const FORMAT = `Reply with JSON only, matching:
{
  "objective": "what the chapter is for",
  "chapterRole": "its job in the book",
  "openingState": "where things stand going in",
  "closingState": "where things stand coming out",
  "scenes": [
    {
      "title": "…", "pov": "CHAR_…", "locationId": "LOC_…",
      "characterIds": ["CHAR_…"], "objectIds": ["OBJECT_…"],
      "objective": "…", "conflict": "…", "entryState": "…", "exitState": "…",
      "beats": ["…"], "revelations": ["…"],
      "knowledgeChanges": [{"characterId": "CHAR_…", "factId": "FACT_…", "to": "known|believed|suspected|disbelieved|unknown", "sourceEntityId": "CHAR_… (optional)"}],
      "plotThreadIds": ["THREAD_…"], "setupIds": ["SETUP_…"], "payoffSetupIds": ["SETUP_…"],
      "requiredFactIds": ["FACT_…"], "minWords": 0, "maxWords": 0, "transitionIntent": "…"
    }
  ],
  "forbiddenFacts": [{"factId": "FACT_…", "characterId": "CHAR_… (optional)", "reason": "…"}],
  "constraints": ["…"], "notes": ["…"]
}
Omit any field you have nothing for. minWords/maxWords only where length genuinely matters.`;

const KNOWLEDGE_STATES: readonly PlannedKnowledgeState[] = [
  "known",
  "believed",
  "suspected",
  "disbelieved",
  "unknown",
];

export interface PlanArchitectOptions {
  readonly repo: StoryRepository;
  readonly model: LanguageModel;
  readonly grant: PermissionGrant;
  readonly now?: () => string;
  readonly maxContextTokens?: number;
}

export interface PlanProposalResult {
  readonly plan: ChapterPlan;
  /** Deterministic validation, run immediately so review starts informed. */
  readonly findings: readonly PlanFinding[];
  readonly taskId: string;
}

/** Verdict of plan-vs-draft comparison for one planned element (§8). */
export interface CoverageVerdict {
  readonly beat: string;
  readonly verdict: "covered" | "partially_covered" | "missed";
  readonly note: string;
  readonly source: "model";
}

export interface SceneCoverage {
  readonly sceneId: string;
  readonly title: string;
  readonly beats: readonly CoverageVerdict[];
  /** Things the prose does that the plan never asked for — possibly useful. */
  readonly unexpected: readonly string[];
}

interface RawCoverage {
  readonly beats: readonly Record<string, unknown>[];
  readonly unexpected: readonly string[];
}

const COVERAGE_SCHEMA: OutputSchema<RawCoverage> = {
  name: "PlanDraftComparison",
  parse(value: unknown): RawCoverage {
    if (typeof value !== "object" || value === null) {
      throw new EditError("empty_response", "PlanDraftComparison: expected an object.");
    }
    const raw = value as Record<string, unknown>;
    return { beats: records(raw.beats), unexpected: strings(raw.unexpected) };
  },
};

export class PlanArchitect {
  private readonly repo: StoryRepository;
  private readonly model: LanguageModel;
  private readonly grant: PermissionGrant;
  private readonly now: () => string;
  private readonly maxContextTokens: number;

  constructor(options: PlanArchitectOptions) {
    this.repo = options.repo;
    this.model = options.model;
    this.grant = options.grant;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxContextTokens = options.maxContextTokens ?? 12_000;
  }

  /**
   * Propose a chapter plan from the project's current state and the writer's
   * instruction, and save it as a **draft** for review (§4–5).
   */
  async proposeChapterPlan(request: {
    chapterId: string;
    instruction?: string;
  }): Promise<PlanProposalResult> {
    const decision = checkPermission(
      { name: "create_chapter_plan", permission: "edit_plans" },
      this.grant,
    );
    if (!decision.allowed) {
      throw new EditError("permission_denied", decision.reason);
    }
    const chapter = (await this.repo.listChapters()).find((c) => c.id === request.chapterId);
    if (chapter === undefined) {
      throw new EditError("unknown_target", `No chapter exists with ID "${request.chapterId}".`);
    }

    const task = createTask({
      id: await this.repo.agents.nextTaskId(),
      goal: `plan_chapter: ${chapter.title}`,
      now: this.now(),
      scope: [chapter.id as string],
      allowedTools: [],
      approvalPolicy: "approve_every_edit",
    });
    await this.repo.agents.saveTask(task);
    const current = await this.repo.agents.saveTask(
      transition(task, "running", { now: this.now() }),
    );

    try {
      const compiler = new ContextCompiler(this.repo, { now: this.now });
      const pkg = await compiler.compile({
        recipe: "chapter_inspection",
        targetId: chapter.id as string,
        instruction: request.instruction ?? `Plan ${chapter.title}.`,
        budget: { maxTokens: this.maxContextTokens, reserveForOutput: 4_000 },
      });
      const neighbours = await this.neighbours(chapter.id as string);

      const raw = await this.model.generateStructured(
        {
          system: SYSTEM_PROMPT,
          messages: [
            { role: "user", content: renderContextPackage(pkg) },
            {
              role: "user",
              content: `${neighbours}Plan ${chapter.title}.${
                request.instruction === undefined
                  ? ""
                  : `\n\nThe writer's instruction — honour it exactly:\n${request.instruction}`
              }\n\n${FORMAT}`,
            },
          ],
          schema: PLAN_SCHEMA,
          maxOutputTokens: 6_000,
        },
        { timeoutMs: 240_000 },
      );

      const { plan, pruned } = await this.toPlan(chapter.id as string, raw);
      const stored = await this.repo.saveChapterPlan(plan, {
        actor: "agent",
        taskId: current.id,
        modelId: this.model.id,
        note: "generated",
      });
      const findings = await this.repo.validateChapterPlan(stored);

      await this.repo.agents.saveTask(
        transition(current, "awaiting_approval", { now: this.now() }),
      );
      await this.repo.agents.appendActivity({
        taskId: current.id,
        timestamp: this.now(),
        tool: "plan_chapter",
        argumentsSummary: `chapter=${chapter.id as string}`,
        resultSummary: `${String(stored.scenes.length)} scene(s) proposed, ${String(pruned)} unknown reference(s) set aside, ${String(findings.length)} finding(s)`,
        status: "ok",
      });
      return { plan: stored, findings, taskId: current.id };
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      await this.repo.agents.saveTask(
        transition(current, "failed", { now: this.now(), failureReason: reason }),
      );
      if (cause instanceof ModelError) throw new EditError("provider_failed", reason, { cause });
      throw cause;
    }
  }

  /**
   * Compare the drafted chapter against its approved plan (§8): covered,
   * partially covered, missed — and the unexpected-but-possibly-useful.
   * Semantic judgement, labelled; accepting deviation is the writer's call.
   */
  async comparePlanToDraft(chapterId: string): Promise<SceneCoverage[]> {
    const plan = await this.repo.plans.get(chapterId);
    if (plan === null || plan.status !== "approved") {
      throw new EditError("unknown_target", `No approved plan exists for ${chapterId}.`);
    }
    const chapter = (await this.repo.listChapters()).find((c) => c.id === chapterId);
    if (chapter === undefined) {
      throw new EditError("unknown_target", `No chapter exists with ID "${chapterId}".`);
    }
    const file = (await this.repo.readProjectFile(chapter.filePath)) ?? "";
    const chapterSceneIds = (await this.repo.listScenes())
      .filter((scene) => scene.chapterId === chapter.id)
      .map((scene) => scene.id as string);

    const out: SceneCoverage[] = [];
    for (const planned of plan.scenes) {
      if (planned.sceneId === undefined) continue;
      const resolved = resolveSceneRange(file, planned.sceneId, {
        chapterSceneIds,
        mode: "replace",
      });
      const prose = resolved.ok ? file.slice(resolved.start, resolved.end).trim() : "";
      const elements = [...planned.beats, ...planned.revelations.map((r) => `Revelation: ${r}`)];
      if (elements.length === 0 || prose === "") {
        out.push({
          sceneId: planned.sceneId,
          title: planned.title,
          beats: [],
          unexpected: [],
        });
        continue;
      }
      const raw = await this.model.generateStructured(
        {
          system:
            "You compare a drafted fiction scene against its approved plan. Judge each planned element: covered, partially_covered, or missed. Also list anything significant the prose does that the plan never asked for. Word-for-word adherence is not required — judge substance.",
          messages: [
            {
              role: "user",
              content: `THE PLAN\n${elements.map((e) => `- ${e}`).join("\n")}\n\nTHE DRAFT\n${prose}\n\nReply with JSON only: {"beats":[{"beat":"…","verdict":"covered|partially_covered|missed","note":"one sentence"}],"unexpected":["…"]} — one entry per planned element, in order.`,
            },
          ],
          schema: COVERAGE_SCHEMA,
          maxOutputTokens: 2_000,
        },
        { timeoutMs: 120_000 },
      );
      out.push({
        sceneId: planned.sceneId,
        title: planned.title,
        beats: raw.beats.map((entry): CoverageVerdict => {
          const verdict = entry.verdict;
          return {
            beat: typeof entry.beat === "string" ? entry.beat : "",
            verdict:
              verdict === "covered" || verdict === "partially_covered" || verdict === "missed"
                ? verdict
                : "missed",
            note: typeof entry.note === "string" ? entry.note : "",
            source: "model",
          };
        }),
        unexpected: raw.unexpected,
      });
    }
    return out;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /** The previous and next chapters, named so the plan can bridge them. */
  private async neighbours(chapterId: string): Promise<string> {
    const chapters = [...(await this.repo.listChapters())].sort((a, b) => a.order - b.order);
    const at = chapters.findIndex((chapter) => (chapter.id as string) === chapterId);
    const previous = at > 0 ? chapters[at - 1] : undefined;
    const next = at >= 0 && at + 1 < chapters.length ? chapters[at + 1] : undefined;
    const lines: string[] = [];
    if (previous !== undefined) lines.push(`The previous chapter is "${previous.title}".`);
    if (next !== undefined) lines.push(`The next chapter is "${next.title}".`);
    return lines.length === 0 ? "" : `${lines.join(" ")}\n\n`;
  }

  /**
   * Filter the raw proposal against the project. Unknown IDs never enter the
   * plan; they are counted and set aside into its notes, visibly.
   */
  private async toPlan(
    chapterId: string,
    raw: RawPlan,
  ): Promise<{
    plan: Omit<ChapterPlan, "version" | "revisions" | "createdAt" | "updatedAt">;
    pruned: number;
  }> {
    const [characters, locations, threads, facts, setups, objects] = await Promise.all([
      this.repo.listCharacters(),
      this.repo.listLocations(),
      this.repo.listPlotThreads(),
      this.repo.listFacts(),
      this.repo.listSetups(),
      this.repo.listObjects(),
    ]);
    const known = {
      character: new Set(characters.map((c) => c.id as string)),
      location: new Set(locations.map((l) => l.id as string)),
      thread: new Set(threads.map((t) => t.id as string)),
      fact: new Set(facts.map((f) => f.id as string)),
      setup: new Set(setups.map((s) => s.id as string)),
      object: new Set(objects.map((o) => o.id as string)),
    };
    const setAside: string[] = [];
    const keep = (set: Set<string>, ids: readonly string[], what: string): string[] =>
      ids.filter((id) => {
        if (set.has(id)) return true;
        setAside.push(`${what}: ${id}`);
        return false;
      });

    const scenes = raw.scenes.map((scene, index): PlannedScene => {
      const knowledgeChanges = scene.knowledgeChanges
        .map((change): KnowledgeChangePlan | null => {
          const characterId = typeof change.characterId === "string" ? change.characterId : "";
          const factId = typeof change.factId === "string" ? change.factId : "";
          const to = change.to;
          if (!known.character.has(characterId) || !known.fact.has(factId)) {
            setAside.push(`knowledge change: ${characterId} / ${factId}`);
            return null;
          }
          if (!KNOWLEDGE_STATES.includes(to as PlannedKnowledgeState)) return null;
          const sourceEntityId =
            typeof change.sourceEntityId === "string" &&
            (known.character.has(change.sourceEntityId) || known.object.has(change.sourceEntityId))
              ? change.sourceEntityId
              : undefined;
          return {
            characterId,
            factId,
            to: to as PlannedKnowledgeState,
            ...(sourceEntityId !== undefined ? { sourceEntityId } : {}),
          };
        })
        .filter((change): change is KnowledgeChangePlan => change !== null);

      const pov = scene.pov !== undefined && known.character.has(scene.pov) ? scene.pov : undefined;
      if (scene.pov !== undefined && pov === undefined) setAside.push(`POV: ${scene.pov}`);
      const locationId =
        scene.locationId !== undefined && known.location.has(scene.locationId)
          ? scene.locationId
          : undefined;
      if (scene.locationId !== undefined && locationId === undefined)
        setAside.push(`location: ${scene.locationId}`);

      return {
        key: `s${String(index + 1)}`,
        title: scene.title,
        ...(pov !== undefined ? { pov } : {}),
        ...(locationId !== undefined ? { locationId } : {}),
        characterIds: keep(known.character, scene.characterIds, "character"),
        objectIds: keep(known.object, scene.objectIds, "object"),
        ...(scene.objective !== undefined ? { objective: scene.objective } : {}),
        ...(scene.conflict !== undefined ? { conflict: scene.conflict } : {}),
        ...(scene.entryState !== undefined ? { entryState: scene.entryState } : {}),
        ...(scene.exitState !== undefined ? { exitState: scene.exitState } : {}),
        beats: scene.beats,
        revelations: scene.revelations,
        knowledgeChanges,
        relationshipChanges: [],
        plotThreadIds: keep(known.thread, scene.plotThreadIds, "thread"),
        setupIds: keep(known.setup, scene.setupIds, "setup"),
        payoffSetupIds: keep(known.setup, scene.payoffSetupIds, "payoff"),
        requiredFactIds: keep(known.fact, scene.requiredFactIds, "fact"),
        ...(scene.minWords !== undefined || scene.maxWords !== undefined
          ? {
              targetWords: {
                ...(scene.minWords !== undefined ? { minWords: scene.minWords } : {}),
                ...(scene.maxWords !== undefined ? { maxWords: scene.maxWords } : {}),
              },
            }
          : {}),
        ...(scene.transitionIntent !== undefined
          ? { transitionIntent: scene.transitionIntent }
          : {}),
      };
    });

    const forbiddenFacts = raw.forbiddenFacts
      .map((entry): FactConstraint | null => {
        const factId = typeof entry.factId === "string" ? entry.factId : "";
        if (!known.fact.has(factId)) {
          setAside.push(`forbidden fact: ${factId}`);
          return null;
        }
        const characterId =
          typeof entry.characterId === "string" && known.character.has(entry.characterId)
            ? entry.characterId
            : undefined;
        return {
          factId,
          ...(characterId !== undefined ? { characterId } : {}),
          ...(typeof entry.reason === "string" && entry.reason !== ""
            ? { reason: entry.reason }
            : {}),
        };
      })
      .filter((entry): entry is FactConstraint => entry !== null);

    const notes = [
      ...raw.notes,
      ...(setAside.length === 0
        ? []
        : [
            `References the model proposed that this project does not contain: ${setAside.join("; ")}.`,
          ]),
    ];

    return {
      plan: {
        id: `PLANFOR_${chapterId}`,
        chapterId,
        status: "draft",
        ...(raw.objective !== undefined ? { objective: raw.objective } : {}),
        ...(raw.chapterRole !== undefined ? { chapterRole: raw.chapterRole } : {}),
        ...(raw.openingState !== undefined ? { openingState: raw.openingState } : {}),
        ...(raw.closingState !== undefined ? { closingState: raw.closingState } : {}),
        scenes,
        activePlotThreadIds: [...new Set(scenes.flatMap((scene) => scene.plotThreadIds))],
        requiredSetupIds: [...new Set(scenes.flatMap((scene) => scene.setupIds))],
        requiredPayoffIds: [...new Set(scenes.flatMap((scene) => scene.payoffSetupIds))],
        characterArcMovement: [],
        forbiddenFacts,
        constraints: raw.constraints,
        notes,
        source: "model",
        modelId: this.model.id,
      },
      pruned: setAside.length,
    };
  }
}
