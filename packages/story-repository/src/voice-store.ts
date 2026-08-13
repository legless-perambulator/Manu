import { WRITER_DIR } from "@jellytind/domain";
import type {
  AuthorVoiceProfile,
  SampleStance,
  VoiceCategory,
  VoiceRule,
  VoiceRuleId,
  VoiceSample,
  VoiceSampleId,
  VoiceScope,
  VoiceTendency,
  VoiceTendencyId,
  TendencyStatus,
} from "@jellytind/domain";
import { categoriesFor, isEvidence, scopeRank } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";

const VOICE_DIR = `${WRITER_DIR}/voice`;
const PATHS = {
  rules: `${VOICE_DIR}/rules.json`,
  tendencies: `${VOICE_DIR}/tendencies.json`,
  samples: `${VOICE_DIR}/samples.json`,
} as const;

/**
 * The Author Voice profile on disk.
 *
 * It lives inside the project, in plain JSON the writer can read, because how
 * someone writes is theirs. Nothing is sent anywhere except as part of an
 * operation they asked for (docs/SECURITY_PRIVACY.md).
 *
 * Written straight to the store rather than through the journal: a voice
 * profile is a record *about* the work, not a revision of it, and journalling
 * every "confirm this tendency" would bury the manuscript's own history.
 */
export class VoiceStore {
  constructor(private readonly store: ProjectStore) {}

  async load(): Promise<AuthorVoiceProfile> {
    const [rules, tendencies, samples] = await Promise.all([
      this.read<VoiceRule>(PATHS.rules),
      this.read<VoiceTendency>(PATHS.tendencies),
      this.read<VoiceSample>(PATHS.samples),
    ]);
    return { rules, tendencies, samples };
  }

  private async read<T>(path: string): Promise<T[]> {
    const raw = await this.store.readFile(path);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  private async write(path: string, items: readonly unknown[]): Promise<void> {
    await this.store.createDirectory(VOICE_DIR);
    await this.store.writeFile(path, `${JSON.stringify(items, null, 2)}\n`);
  }

  private nextId(existing: readonly { id: string }[], prefix: string): string {
    const highest = existing.reduce((max, item) => {
      const n = Number.parseInt(item.id.replace(`${prefix}_`, ""), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    return `${prefix}_${String(highest + 1).padStart(4, "0")}`;
  }

  // ── The writer's own rules ────────────────────────────────────────────────

  async addRule(input: {
    kind: VoiceRule["kind"];
    category: VoiceCategory;
    statement: string;
    scope?: VoiceScope;
    appliesToId?: string;
    pattern?: string;
  }): Promise<VoiceRule> {
    const rules = await this.read<VoiceRule>(PATHS.rules);
    const rule: VoiceRule = {
      id: this.nextId(rules, "VRULE") as VoiceRuleId,
      kind: input.kind,
      category: input.category,
      scope: input.scope ?? "project",
      ...(input.appliesToId !== undefined ? { appliesToId: input.appliesToId } : {}),
      statement: input.statement.trim(),
      ...(input.pattern !== undefined && input.pattern !== "" ? { pattern: input.pattern } : {}),
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    await this.write(PATHS.rules, [...rules, rule]);
    return rule;
  }

  async setRuleEnabled(id: VoiceRuleId, enabled: boolean): Promise<void> {
    const rules = await this.read<VoiceRule>(PATHS.rules);
    await this.write(
      PATHS.rules,
      rules.map((r) => (r.id === id ? { ...r, enabled } : r)),
    );
  }

  async deleteRule(id: VoiceRuleId): Promise<void> {
    const rules = await this.read<VoiceRule>(PATHS.rules);
    await this.write(
      PATHS.rules,
      rules.filter((r) => r.id !== id),
    );
  }

  // ── Samples ───────────────────────────────────────────────────────────────

  /**
   * Record a passage and what the writer thinks of it.
   *
   * The stance is required and defaults to nothing useful: a passage nobody has
   * assessed is not evidence of desired style, however it got here.
   */
  async addSample(input: {
    stance: SampleStance;
    text: string;
    category?: VoiceCategory;
    scope?: VoiceScope;
    appliesToId?: string;
    source?: string;
    replacedText?: string;
    note?: string;
  }): Promise<VoiceSample> {
    const samples = await this.read<VoiceSample>(PATHS.samples);
    const sample: VoiceSample = {
      id: this.nextId(samples, "VSAMPLE") as VoiceSampleId,
      stance: input.stance,
      text: input.text,
      ...(input.category !== undefined ? { category: input.category } : {}),
      scope: input.scope ?? "project",
      ...(input.appliesToId !== undefined ? { appliesToId: input.appliesToId } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.replacedText !== undefined ? { replacedText: input.replacedText } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      createdAt: new Date().toISOString(),
    };
    await this.write(PATHS.samples, [...samples, sample]);
    return sample;
  }

  async setSampleStance(id: VoiceSampleId, stance: SampleStance): Promise<void> {
    const samples = await this.read<VoiceSample>(PATHS.samples);
    await this.write(
      PATHS.samples,
      samples.map((s) => (s.id === id ? { ...s, stance } : s)),
    );
  }

  /** Only assessed passages. Imported prose contributes nothing by itself. */
  async evidenceSamples(): Promise<VoiceSample[]> {
    return (await this.read<VoiceSample>(PATHS.samples)).filter((s) => isEvidence(s.stance));
  }

  // ── Inferred tendencies ───────────────────────────────────────────────────

  async addTendencies(
    drafts: readonly {
      category: VoiceCategory;
      statement: string;
      evidenceSampleIds: readonly VoiceSampleId[];
      evidence: string;
      scope?: VoiceScope;
      appliesToId?: string;
      modelId?: string;
    }[],
  ): Promise<VoiceTendency[]> {
    const existing = await this.read<VoiceTendency>(PATHS.tendencies);
    const added: VoiceTendency[] = [];
    let pool = [...existing];
    for (const draft of drafts) {
      const tendency: VoiceTendency = {
        id: this.nextId(pool, "VTEND") as VoiceTendencyId,
        category: draft.category,
        scope: draft.scope ?? "project",
        ...(draft.appliesToId !== undefined ? { appliesToId: draft.appliesToId } : {}),
        statement: draft.statement,
        // Always proposed. A reading nobody has looked at is not a preference.
        status: "proposed",
        evidenceSampleIds: draft.evidenceSampleIds,
        evidence: draft.evidence,
        ...(draft.modelId !== undefined ? { modelId: draft.modelId } : {}),
        createdAt: new Date().toISOString(),
      };
      pool = [...pool, tendency];
      added.push(tendency);
    }
    await this.write(PATHS.tendencies, pool);
    return added;
  }

  /** Confirm, reject, or (by writing a new statement) edit a tendency. */
  async reviewTendency(
    id: VoiceTendencyId,
    status: TendencyStatus,
    editedStatement?: string,
  ): Promise<void> {
    const tendencies = await this.read<VoiceTendency>(PATHS.tendencies);
    await this.write(
      PATHS.tendencies,
      tendencies.map((t) =>
        t.id === id
          ? {
              ...t,
              status,
              ...(editedStatement !== undefined && editedStatement.trim() !== ""
                ? { statement: editedStatement.trim() }
                : {}),
              reviewedAt: new Date().toISOString(),
            }
          : t,
      ),
    );
  }

  // ── Retrieval ─────────────────────────────────────────────────────────────

  /**
   * The slice of the profile that bears on one operation.
   *
   * This is the whole reason voice is categorised rather than kept as one
   * instruction blob: a dialogue rewrite gets dialogue, punctuation and
   * narrative distance, and is not handed the writer's preferences about
   * landscape description.
   *
   * Only the writer's rules and **confirmed** tendencies are returned. A
   * proposed reading has never been agreed to and must not steer prose.
   */
  async forOperation(options?: {
    operation?: string;
    characterId?: string;
    povCharacterId?: string;
  }): Promise<{ rules: VoiceRule[]; tendencies: VoiceTendency[]; categories: VoiceCategory[] }> {
    const profile = await this.load();
    const categories = [...categoriesFor(options?.operation)];
    const wanted = new Set<VoiceCategory>(categories);

    const inScope = (scope: VoiceScope, appliesToId?: string): boolean => {
      if (scope === "global" || scope === "project") return true;
      if (scope === "pov")
        return appliesToId === undefined || appliesToId === options?.povCharacterId;
      return appliesToId === undefined || appliesToId === options?.characterId;
    };

    const rules = profile.rules
      .filter((r) => r.enabled && wanted.has(r.category) && inScope(r.scope, r.appliesToId))
      .sort((a, b) => scopeRank(a.scope) - scopeRank(b.scope));

    const tendencies = profile.tendencies
      .filter(
        (t) =>
          t.status === "confirmed" && wanted.has(t.category) && inScope(t.scope, t.appliesToId),
      )
      .sort((a, b) => scopeRank(a.scope) - scopeRank(b.scope));

    return { rules, tendencies, categories };
  }
}

// ── Deterministic comparison ────────────────────────────────────────────────

export interface RuleHit {
  readonly ruleId: string;
  readonly statement: string;
  readonly kind: VoiceRule["kind"];
  readonly category: VoiceCategory;
  /** Every place in the passage the pattern matched, with a little context. */
  readonly occurrences: readonly { index: number; excerpt: string }[];
}

export interface VoiceCheckResult {
  readonly checked: readonly string[];
  readonly notChecked: readonly string[];
  readonly hits: readonly RuleHit[];
}

/**
 * Check a passage against the rules that can be checked.
 *
 * Some rules are mechanical — "avoid 'couldn't help but'", "avoid semicolons in
 * dialogue" — and a machine can answer those exactly. Most are not: "prefer
 * physical observation before internal reflection" is a reading, and pretending
 * otherwise would be inventing a measurement.
 *
 * So this reports both halves: what it checked, and what it could not. A rule
 * with no pattern appears under `notChecked`, never silently passed
 * (docs/STORY_COMPILER.md — "skipped is not passed").
 */
export function checkVoiceRules(text: string, rules: readonly VoiceRule[]): VoiceCheckResult {
  const checked: string[] = [];
  const notChecked: string[] = [];
  const hits: RuleHit[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.pattern === undefined || rule.pattern === "") {
      notChecked.push(rule.statement);
      continue;
    }
    checked.push(rule.statement);

    let regex: RegExp;
    try {
      regex = new RegExp(rule.pattern, "giu");
    } catch {
      // A pattern the writer typed by hand may not compile. That is not a
      // reason to fail the check — it is a reason to say it was not checked.
      notChecked.push(rule.statement);
      checked.pop();
      continue;
    }

    const occurrences: { index: number; excerpt: string }[] = [];
    for (const match of text.matchAll(regex)) {
      if (match.index === undefined) continue;
      const from = Math.max(0, match.index - 30);
      const to = Math.min(text.length, match.index + match[0].length + 30);
      occurrences.push({
        index: match.index,
        excerpt: `${from > 0 ? "…" : ""}${text.slice(from, to).trim()}${to < text.length ? "…" : ""}`,
      });
      if (occurrences.length >= 10) break;
    }

    // A `prefer` rule with a pattern is satisfied by matching, not violated.
    const violated = rule.kind === "avoid" ? occurrences.length > 0 : occurrences.length === 0;
    if (violated) {
      hits.push({
        ruleId: rule.id,
        statement: rule.statement,
        kind: rule.kind,
        category: rule.category,
        occurrences,
      });
    }
  }

  return { checked, notChecked, hits };
}
