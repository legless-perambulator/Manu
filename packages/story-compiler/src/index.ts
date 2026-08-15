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

export { SEVERITIES, RULE_CATEGORIES, NO_MODULES } from "./types";
export type {
  BuildComparison,
  BuildConfig,
  BuildContext,
  BuildInputKind,
  BuildSummary,
  DanglingReference,
  Diagnostic,
  DiagnosticDraft,
  ModuleBuildInput,
  ResolvedBuildConfig,
  RuleCategory,
  RuleOptions,
  RuleOutcome,
  Severity,
  StoryBuild,
  StoryCompilerRule,
} from "./types";

// ── The semantic layer (Phase 37) — judgement, clearly labelled ──────────────

export {
  SEMANTIC_CATEGORIES,
  SEMANTIC_CATEGORY_LABELS,
  SEMANTIC_CONFIDENCES,
  SEMANTIC_FINDING_KINDS,
  SEMANTIC_FINDING_STATUSES,
  SEMANTIC_DEPTHS,
  SEMANTIC_TEST_VERDICTS,
  semanticTests,
} from "./semantic/types";
export type {
  SemanticBuild,
  SemanticBuildConfig,
  SemanticBuildContext,
  SemanticCategory,
  SemanticCompilerRule,
  SemanticConfidence,
  SemanticDepth,
  SemanticEvidence,
  SemanticFinding,
  SemanticFindingDraft,
  SemanticFindingKind,
  SemanticFindingStatus,
  SemanticRuleOutcome,
  SemanticRuleWeight,
  SemanticScope,
  SemanticStatusEntry,
  SemanticTarget,
  SemanticTestResult,
  SemanticTestRun,
  SemanticTestVerdict,
  JudgementRuleSpec,
  RuleRun,
} from "./semantic/types";

export { runSemanticBuild, resolveSemanticScope, debugQuestionFor } from "./semantic/build";
export type {
  SemanticBuildOptions,
  SemanticBuildPorts,
  SemanticCacheEntry,
} from "./semantic/build";

export { heuristicRule, judgementRule, voiceSanctions } from "./semantic/registry";
export { HEURISTIC_RULES } from "./semantic/heuristics";
export { JUDGEMENT_RULES } from "./semantic/judgements";
export { runSemanticStoryTests } from "./semantic/tests";

import { HEURISTIC_RULES } from "./semantic/heuristics";
import { JUDGEMENT_RULES } from "./semantic/judgements";
import type { SemanticCompilerRule as SemanticRule } from "./semantic/types";

/** Every semantic rule this build ships: light heuristics + model judgements. */
export const SEMANTIC_RULES: readonly SemanticRule[] = [...HEURISTIC_RULES, ...JUDGEMENT_RULES];
