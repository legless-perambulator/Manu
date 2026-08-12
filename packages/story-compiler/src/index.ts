/**
 * @jellytind/story-compiler — the Story Build.
 *
 * Deterministic validation over structured story state: the writer presses
 * Build Story and gets real continuity diagnostics, produced by arithmetic
 * rather than by a model re-reading the manuscript (MASTER_BUILD.md §14,
 * docs/STORY_COMPILER.md).
 */
export { buildStory, compareBuilds, resolveConfig, rulesAffectedBy, fingerprint } from "./build";
export type { BuildOptions } from "./build";

export { CORE_RULES, ruleById, RULE_SEVERITY_HINT } from "./rules";

export {
  runStoryTests,
  runStoryTest,
  resolveScope,
  describeTestRun,
  ScopeError,
} from "./story-tests";
export type {
  TestFailure,
  TestResult,
  TestRunInput,
  TestRunSummary,
  TestStatus,
} from "./story-tests";

export { SEVERITIES, RULE_CATEGORIES } from "./types";
export type {
  BuildComparison,
  BuildConfig,
  BuildContext,
  BuildInputKind,
  BuildSummary,
  DanglingReference,
  Diagnostic,
  DiagnosticDraft,
  ResolvedBuildConfig,
  RuleCategory,
  RuleOptions,
  RuleOutcome,
  Severity,
  StoryBuild,
  StoryCompilerRule,
} from "./types";
