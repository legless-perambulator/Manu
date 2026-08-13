import type {
  Chapter,
  Character,
  Decision,
  Dependency,
  ExtensionRecord,
  Fact,
  Location,
  PlotThread,
  Relationship,
  Scene,
  Setup,
  StoryEvent,
  StoryTest,
  StoryObject,
  TemporalLink,
  TravelRule,
  WorldRule,
} from "@jellytind/domain";
import type {
  ManuscriptMetrics,
  StateTransition,
  StoryChronology,
  StoryTimeline,
} from "@jellytind/story-state";
import type { TestRunSummary } from "./story-tests";

/**
 * How serious a diagnostic is.
 *
 * `error` is reserved for deterministic violations the recorded data cannot
 * support. `warning` is a likely problem that may well be intentional.
 * `info` is something worth knowing that is not a problem at all.
 *
 * The compiler must **never** present subjective literary judgement as an
 * error. Semantic analysis arrives later and will be labelled as such; nothing
 * in this version produces a finding a model had a hand in
 * (docs/STORY_COMPILER.md).
 */
export type Severity = "error" | "warning" | "info";

export const SEVERITIES: readonly Severity[] = ["error", "warning", "info"];

/** Rule groupings, for the build report and for enabling whole areas at once. */
export type RuleCategory =
  | "referential_integrity"
  | "character_continuity"
  | "knowledge"
  | "objects"
  | "timeline"
  | "plot_threads"
  | "setup_payoff"
  | "project_rules"
  | "story_tests"
  | "causality";

export const RULE_CATEGORIES: readonly RuleCategory[] = [
  "referential_integrity",
  "character_continuity",
  "knowledge",
  "objects",
  "timeline",
  "plot_threads",
  "setup_payoff",
  "project_rules",
  "story_tests",
  "causality",
];

/**
 * What a rule reads.
 *
 * Declared so a future incremental build can map a change to the rules it could
 * possibly affect and re-run only those. Nothing else in this version depends on
 * it, but declaring it now means the seam exists and is tested rather than
 * being retrofitted later (docs/STORY_COMPILER.md — "Incremental builds").
 */
export type BuildInputKind =
  | "entities"
  | "scenes"
  | "transitions"
  | "chronology"
  | "setups"
  | "world_rules"
  | "prose"
  | "story_tests"
  | "dependencies"
  | "extensions";

/**
 * One finding from one rule.
 *
 * `id` is a **fingerprint**, stable across builds: it is derived from the rule,
 * the scene and the entities involved, never from the message. That is what
 * lets two builds be compared into new, resolved and persistent diagnostics
 * without rewording a message inventing a "new" problem.
 */
export interface Diagnostic {
  readonly id: string;
  readonly ruleId: string;
  readonly severity: Severity;
  readonly message: string;
  /** Every entity the finding is about, for navigation and for the fingerprint. */
  readonly entities: readonly string[];
  readonly sceneId?: string;
  readonly chapterId?: string;
  /** Why the compiler believes this — the recorded data behind the message. */
  readonly evidence: string;
  /** What a writer could do about it. Never applied automatically. */
  readonly suggestedAction?: string;
}

/** A diagnostic as a rule emits it, before the build assigns identity. */
export interface DiagnosticDraft {
  readonly severity: Severity;
  readonly message: string;
  readonly entities?: readonly string[];
  readonly sceneId?: string;
  readonly evidence: string;
  readonly suggestedAction?: string;
  /**
   * Disambiguator for a rule that can emit several findings about the same
   * entities in the same scene. Part of the fingerprint; the message is not.
   */
  readonly key?: string;
}

/**
 * Everything the rules read, gathered once per build.
 *
 * Assembled by the caller — the Story Repository, which owns the project — so
 * the compiler depends on no layer above it and a rule can be tested against a
 * hand-built context with no filesystem at all.
 */
export interface BuildContext {
  readonly scenes: readonly Scene[];
  readonly chapters: readonly Chapter[];
  readonly characters: readonly Character[];
  readonly locations: readonly Location[];
  readonly objects: readonly StoryObject[];
  readonly threads: readonly PlotThread[];
  readonly facts: readonly Fact[];
  readonly worldRules: readonly WorldRule[];
  readonly events: readonly StoryEvent[];
  readonly setups: readonly Setup[];
  readonly relationships: readonly Relationship[];
  readonly storyTests: readonly StoryTest[];
  readonly dependencies: readonly Dependency[];
  readonly decisions: readonly Decision[];
  readonly transitions: readonly StateTransition[];
  readonly temporalLinks: readonly TemporalLink[];
  readonly travelRules: readonly TravelRule[];

  readonly timeline: StoryTimeline;
  readonly chronology: StoryChronology;
  readonly metrics: ManuscriptMetrics;
  /**
   * Dangling references, as the entity graph reports them.
   *
   * Passed in rather than computed here: the graph lives in the repository,
   * which sits above the compiler, and reversing that dependency to save one
   * field would be the wrong trade.
   */
  readonly danglingReferences: readonly DanglingReference[];

  /**
   * What the enabled genre modules brought with them.
   *
   * The compiler knows that modules exist and knows nothing about any genre.
   * A module's rule reads its own slot — `context.modules.data["mystery"]` —
   * which it filled itself via `collect`, and the core never grows a branch
   * per genre (docs/GENRE_MODULES.md).
   */
  readonly modules: ModuleBuildInput;

  readonly config: ResolvedBuildConfig;
  /**
   * Test results, evaluated once by the build before the rules run.
   *
   * Populated by `buildStory`, not by the caller: tests are decided in one place
   * so the separate suite summary and the navigable diagnostics can never
   * disagree about what happened (docs/STORY_TESTS.md).
   */
  readonly testResults?: TestRunSummary;
}

/**
 * The genre modules' contribution to a build.
 *
 * Deliberately opaque. `data` is keyed by module id and each module casts its
 * own entry — a rule that reads another module's slot is reaching outside
 * itself and gets `unknown` for its trouble.
 */
export interface ModuleBuildInput {
  readonly enabled: readonly string[];
  readonly extensions: readonly ExtensionRecord[];
  readonly data: Readonly<Record<string, unknown>>;
}

export const NO_MODULES: ModuleBuildInput = { enabled: [], extensions: [], data: {} };

export interface DanglingReference {
  readonly fromId: string;
  readonly fromKind: string;
  readonly field: string;
  readonly toId: string;
}

/**
 * A modular check.
 *
 * Rules are values, not code paths, so the registry can be extended — by later
 * phases now and by plugins eventually — without touching the build itself.
 */
export interface StoryCompilerRule {
  readonly id: string;
  readonly name: string;
  readonly category: RuleCategory;
  /** What the rule looks for, in one sentence a writer would understand. */
  readonly description: string;
  /** What it reads, for incremental re-running. */
  readonly inputs: readonly BuildInputKind[];
  run(context: BuildContext): DiagnosticDraft[] | Promise<DiagnosticDraft[]>;
}

/** How a build was configured. */
export interface BuildConfig {
  /** Rule IDs to skip entirely. */
  readonly disabledRules?: readonly string[];
  /** Whole categories to skip. */
  readonly disabledCategories?: readonly RuleCategory[];
  /**
   * Force every finding from a rule to one severity.
   *
   * A blunt instrument on purpose: a writer who wants dormancy as `info` rather
   * than `warning` should not have to learn which sub-finding is which.
   */
  readonly severityOverrides?: Readonly<Record<string, Severity>>;
  readonly options?: RuleOptions;
}

/**
 * Per-rule settings that need a number rather than a switch.
 *
 * Deliberately typed rather than a bag of unknowns: a setting nobody can
 * discover is a setting nobody uses.
 */
export interface RuleOptions {
  /**
   * Report a thread quiet for at least this many scenes. Off by default,
   * because the right number for a thriller is wrong for a family saga
   * (docs/NARRATIVE_THREADS.md).
   */
  readonly dormantAfterScenes?: number;
}

export interface ResolvedBuildConfig {
  readonly disabledRules: readonly string[];
  readonly disabledCategories: readonly RuleCategory[];
  readonly severityOverrides: Readonly<Record<string, Severity>>;
  readonly options: RuleOptions;
}

/** How a rule fared in a build. */
export interface RuleOutcome {
  readonly ruleId: string;
  readonly name: string;
  readonly category: RuleCategory;
  readonly status: "passed" | "found" | "skipped" | "failed";
  readonly diagnosticCount: number;
  /** Why it was skipped or how it failed. */
  readonly reason?: string;
}

export interface StoryBuild {
  readonly id: string;
  /** Monotonic per project — the number a writer says out loud. */
  readonly number: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  /** `failed` when any error was found; a build with only warnings still passes. */
  readonly status: "passed" | "passed_with_warnings" | "failed";
  readonly counts: Readonly<Record<Severity, number>>;
  readonly diagnostics: readonly Diagnostic[];
  readonly rules: readonly RuleOutcome[];
  readonly config: ResolvedBuildConfig;
  /**
   * The story-test suite, reported separately from the rules.
   *
   * A writer's own assertions are a different kind of result from the
   * compiler's built-in checks, and a build that blurred them would hide which
   * of the two just went red.
   */
  readonly tests: TestRunSummary;
}

/** A build without its diagnostics — what a history list shows. */
export type BuildSummary = Omit<StoryBuild, "diagnostics">;

/**
 * What changed between two builds.
 *
 * The question a writer actually asks after fixing something is "did that work,
 * and did I break anything?", which is three lists rather than two numbers.
 */
export interface BuildComparison {
  readonly previousBuildId?: string;
  readonly buildId: string;
  readonly added: readonly Diagnostic[];
  readonly resolved: readonly Diagnostic[];
  readonly persistent: readonly Diagnostic[];
}
