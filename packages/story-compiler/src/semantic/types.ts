import type {
  AuthorVoiceProfile,
  Chapter,
  Character,
  Decision,
  Dependency,
  ReaderSimulation,
  Relationship,
  Scene,
  Setup,
  StoryTest,
} from "@jellytind/domain";
import type { StateTransition } from "@jellytind/story-state";
import type { LanguageModel, OutputSchema } from "@jellytind/model-router";

/**
 * The semantic compiler layer (Phase 37).
 *
 * Everything here is **judgement, clearly labelled as judgement**. A semantic
 * finding is never an error: it has no `Severity`, it cannot fail a build,
 * and nothing in this module can emit into the deterministic diagnostic
 * stream. The two layers share a project and nothing else (§1).
 *
 * Two kinds of judgement exist and each finding says which it is:
 *
 * - `heuristic` — computed from the text by a fixed procedure. Repeatable,
 *   model-free, and still not an error: a repeated phrase can be a defect or
 *   a drumbeat, and only the writer knows which.
 * - `model_judgement` — a model's reading, through validated structured
 *   output. Labelled with the model that made it.
 */

export const SEMANTIC_CATEGORIES = [
  "pacing",
  "tension",
  "scene_purpose",
  "motivation",
  "character_voice",
  "dialogue",
  "prose",
  "foreshadowing",
  "structure",
] as const;
export type SemanticCategory = (typeof SEMANTIC_CATEGORIES)[number];

export const SEMANTIC_CATEGORY_LABELS: Readonly<Record<SemanticCategory, string>> = {
  pacing: "Pacing",
  tension: "Tension",
  scene_purpose: "Scene purpose",
  motivation: "Motivation",
  character_voice: "Character voice",
  dialogue: "Dialogue",
  prose: "Prose",
  foreshadowing: "Foreshadowing",
  structure: "Structure",
};

/** Qualitative only (§5). No invented probabilities, ever. */
export const SEMANTIC_CONFIDENCES = ["low", "medium", "high"] as const;
export type SemanticConfidence = (typeof SEMANTIC_CONFIDENCES)[number];

export const SEMANTIC_FINDING_KINDS = ["heuristic", "model_judgement"] as const;
export type SemanticFindingKind = (typeof SEMANTIC_FINDING_KINDS)[number];

/**
 * The finding's lifecycle (§14). `acknowledged` is the writer saying "this is
 * intentional" — the finding is kept, quietly, and never nags again.
 * `resolved` is assigned by the build when a previously seen finding stops
 * being produced.
 */
export const SEMANTIC_FINDING_STATUSES = ["open", "acknowledged", "ignored", "resolved"] as const;
export type SemanticFindingStatus = (typeof SEMANTIC_FINDING_STATUSES)[number];

/**
 * What the finding rests on (§4). A judgement with no examples is not
 * emitted: `sceneIds` or `notes` must carry something concrete.
 */
export interface SemanticEvidence {
  readonly sceneIds: readonly string[];
  readonly entities: readonly string[];
  /** The concrete observations: shared tendencies, quoted phrases, counts. */
  readonly notes: readonly string[];
}

export interface SemanticFinding {
  /** Fingerprint, stable across builds — what the lifecycle attaches to. */
  readonly id: string;
  readonly ruleId: string;
  readonly category: SemanticCategory;
  readonly kind: SemanticFindingKind;
  /** The finding in one sentence a writer would understand. */
  readonly message: string;
  readonly detail?: string;
  readonly evidence: SemanticEvidence;
  readonly confidence: SemanticConfidence;
  /** The model that judged, for `model_judgement` findings. */
  readonly modelId?: string;
  /** What a writer could do about it. Never applied automatically (§17). */
  readonly suggestedAction?: string;
  readonly status: SemanticFindingStatus;
}

/** A finding as a rule emits it, before identity and lifecycle are applied. */
export interface SemanticFindingDraft {
  readonly category: SemanticCategory;
  readonly kind: SemanticFindingKind;
  readonly message: string;
  readonly detail?: string;
  readonly evidence: SemanticEvidence;
  readonly confidence: SemanticConfidence;
  readonly modelId?: string;
  readonly suggestedAction?: string;
  /** Disambiguator within a rule, part of the fingerprint. */
  readonly key?: string;
}

// ── Scope and depth ──────────────────────────────────────────────────────────

/** What to analyse (§12). Nothing outside the scope is read or re-judged. */
export type SemanticScope =
  | { readonly kind: "book" }
  | { readonly kind: "act"; readonly chapterIds: readonly string[] }
  | { readonly kind: "chapter"; readonly chapterId: string }
  | { readonly kind: "scene"; readonly sceneId: string };

/**
 * Quick runs the deterministic-procedure heuristics only — zero model calls,
 * zero cost. Full adds the model judgements (§11).
 */
export const SEMANTIC_DEPTHS = ["quick", "full"] as const;
export type SemanticDepth = (typeof SEMANTIC_DEPTHS)[number];

/** Which depth a rule belongs to. `light` rules run in both. */
export type SemanticRuleWeight = "light" | "full";

// ── Context ──────────────────────────────────────────────────────────────────

/**
 * Everything semantic rules read, assembled once by the caller (the Story
 * Repository). Prose arrives per scene, so a scene-scoped run genuinely reads
 * one scene rather than the manuscript.
 */
export interface SemanticBuildContext {
  readonly scenes: readonly Scene[];
  readonly chapters: readonly Chapter[];
  readonly characters: readonly Character[];
  readonly relationships: readonly Relationship[];
  readonly setups: readonly Setup[];
  readonly decisions: readonly Decision[];
  readonly dependencies: readonly Dependency[];
  readonly transitions: readonly StateTransition[];
  /** The prose of each scene, keyed by scene id. Absent = no prose yet. */
  readonly prose: Readonly<Record<string, string>>;
  /**
   * The writer's confirmed voice (§7): their own rules plus confirmed
   * tendencies. Proposed tendencies are NOT here — an unreviewed inference
   * must not silence a finding.
   */
  readonly voice: AuthorVoiceProfile;
  /** Enabled genre modules (§8). Rules may adapt; the core never branches. */
  readonly modules: readonly string[];
  /**
   * Completed reader simulations (§9). Evidence drawn from these is always
   * labelled simulation, never presented as real readers.
   */
  readonly readerSimulations: readonly ReaderSimulation[];
  /**
   * Ask the Character Simulator about one character in one scene (§10).
   * Optional and expensive: rules call it only after cheaper checks have
   * already flagged a candidate, never wholesale.
   */
  readonly characterInsight?: (characterId: string, sceneId: string) => Promise<string | null>;
}

// ── Rules ────────────────────────────────────────────────────────────────────

export interface SemanticRuleOutcome {
  readonly ruleId: string;
  readonly name: string;
  readonly category: SemanticCategory;
  readonly status: "ran" | "cached" | "skipped" | "failed";
  readonly findingCount: number;
  /** Why it was skipped or how it failed; also notes voice suppressions. */
  readonly reason?: string;
}

/**
 * A modular semantic check (§2).
 *
 * `version` participates in the cache key (§13): changing what a rule looks
 * for invalidates its cached judgements. `weight` decides quick vs full.
 * `requiresModule` gates genre rules (§8): the registry filters them out
 * when the module is off, and no genre assumption runs globally.
 */
export interface SemanticCompilerRule {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly category: SemanticCategory;
  readonly description: string;
  readonly weight: SemanticRuleWeight;
  readonly requiresModule?: string;
  /** True when the rule needs a model; skipped with a reason when none is given. */
  readonly requiresModel: boolean;
  run(
    context: SemanticBuildContext,
    target: SemanticTarget,
    model: LanguageModel | null,
  ): Promise<RuleRun>;
}

/** The resolved scope: the scenes under analysis, in story order. */
export interface SemanticTarget {
  readonly scope: SemanticScope;
  readonly sceneIds: readonly string[];
  readonly chapterIds: readonly string[];
}

export interface RuleRun {
  readonly findings: readonly SemanticFindingDraft[];
  /** e.g. "2 findings suppressed by your Author Voice rules". */
  readonly note?: string;
}

/**
 * The declarative halves of a model-judgement rule (§2): what material is
 * sent, and the validated shape that must come back. `judgementRule` in the
 * registry assembles these into a {@link SemanticCompilerRule}.
 */
export interface JudgementRuleSpec<T> {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly category: SemanticCategory;
  readonly description: string;
  readonly requiresModule?: string;
  /** The system instruction: what the model is judging, and how to answer. */
  readonly instruction: string;
  /**
   * The material for one run, or `null` when there is nothing to judge — the
   * deterministic pre-check that keeps model calls off empty targets.
   */
  contextRecipe(context: SemanticBuildContext, target: SemanticTarget): string | null;
  readonly outputSchema: OutputSchema<T>;
  /** Turn the validated output into findings. Drops anything without evidence. */
  interpret(parsed: T, context: SemanticBuildContext, target: SemanticTarget): RuleRun;
}

// ── Build ────────────────────────────────────────────────────────────────────

/** Per-rule switches (§6): absent = enabled. */
export interface SemanticBuildConfig {
  readonly disabledRules: readonly string[];
}

export interface SemanticBuild {
  readonly at: string;
  readonly scope: SemanticScope;
  readonly depth: SemanticDepth;
  readonly findings: readonly SemanticFinding[];
  readonly rules: readonly SemanticRuleOutcome[];
  /** Open findings per category — the §15 counts. */
  readonly counts: Readonly<Partial<Record<SemanticCategory, number>>>;
  /** Fingerprints previously acknowledged/ignored that no longer occur. */
  readonly resolved: readonly string[];
  readonly modelId?: string;
  /** Semantic story tests, when the run evaluated them (§18). */
  readonly tests?: SemanticTestRun;
}

// ── Semantic story tests (§18–19) ────────────────────────────────────────────

/** Deliberately not booleans: a judgement can be honestly undecided. */
export const SEMANTIC_TEST_VERDICTS = ["pass", "concern", "inconclusive"] as const;
export type SemanticTestVerdict = (typeof SEMANTIC_TEST_VERDICTS)[number];

export interface SemanticTestResult {
  readonly testId: string;
  readonly name: string;
  readonly statement: string;
  readonly verdict: SemanticTestVerdict;
  /** The model's reading, in words — or why no reading was possible. */
  readonly judgement: string;
  /** Qualitative uncertainty about the judgement itself (§5, §19). */
  readonly uncertainty: SemanticConfidence;
  /** The scenes actually analysed. */
  readonly scopeSceneIds: readonly string[];
  /** What was sent, summarised — so the judgement's basis is inspectable. */
  readonly contextSummary: string;
  readonly evidence: SemanticEvidence;
  readonly modelId?: string;
}

export interface SemanticTestRun {
  readonly total: number;
  readonly pass: number;
  readonly concern: number;
  readonly inconclusive: number;
  readonly results: readonly SemanticTestResult[];
}

/** The stored lifecycle word for one fingerprint (§14). */
export interface SemanticStatusEntry {
  readonly status: Extract<SemanticFindingStatus, "acknowledged" | "ignored">;
  readonly note?: string;
  readonly at: string;
}

/** The semantic tests a project holds, narrowed to what this layer evaluates. */
export function semanticTests(tests: readonly StoryTest[]): StoryTest[] {
  return tests.filter((test) => test.type === "semantic" && test.enabled);
}
