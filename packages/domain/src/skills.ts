/**
 * The vocabulary of a Writing Skill run.
 *
 * A skill is an executable workflow, so the record of running one is a
 * sequence of **steps** with their own outcomes — not a transcript and not a
 * single blob of model output. These are the plain data shapes that get
 * written to the project; the workflow engine that produces them lives in
 * `@jellytind/skills` (docs/WRITING_SKILLS.md).
 */

export const SKILL_RUN_STATUSES = ["running", "completed", "failed", "cancelled"] as const;
export type SkillRunStatus = (typeof SKILL_RUN_STATUSES)[number];

/**
 * `skipped` is not `ok`.
 *
 * A step that had nothing to work on, or needed a model where none is
 * configured, did not pass — it did not run. Collapsing the two would let a
 * report claim coverage it never had (AGENTS.md — "skipped is not passed").
 */
export const SKILL_STEP_STATUSES = ["pending", "running", "ok", "skipped", "failed"] as const;
export type SkillStepStatus = (typeof SKILL_STEP_STATUSES)[number];

/**
 * What kind of claim a finding is.
 *
 * Kept distinct because a writer deciding what to do next needs to know which
 * they are reading: a count is not a judgement, and an absence of records is
 * not an absence in the story.
 */
export const SKILL_FINDING_KINDS = [
  /** A count, with its basis. Never a verdict. */
  "measurement",
  /** The project records nothing here. Silence is not a claim. */
  "gap",
  /** Two records disagree — deterministic, and checkable. */
  "conflict",
  /** Worth a look. Heuristic, and labelled as such. */
  "attention",
  /** Something a writer could do. Nothing has applied it. */
  "proposal",
] as const;
export type SkillFindingKind = (typeof SKILL_FINDING_KINDS)[number];

/** Where a claim came from. Canon and inference never blur. */
export const FINDING_SOURCES = ["deterministic", "model"] as const;
export type FindingSource = (typeof FINDING_SOURCES)[number];

export interface SkillFinding {
  readonly id: string;
  readonly kind: SkillFindingKind;
  /** One line, in the writer's terms. */
  readonly statement: string;
  readonly detail?: string;
  /** Why this is believed: the records behind it. */
  readonly basis?: string;
  readonly sceneIds?: readonly string[];
  readonly entities?: readonly string[];
  readonly source: FindingSource;
  /** The step that produced it, so a finding is always traceable. */
  readonly stepId: string;
}

/** A count with its unit and how it was arrived at. */
export interface SkillMeasurement {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly basis: string;
}

export interface SkillStepRecord {
  readonly id: string;
  readonly title: string;
  readonly operationId: string;
  readonly status: SkillStepStatus;
  /** One line of what happened: "Located 31 scenes". */
  readonly summary?: string;
  /** Why a step was skipped, or why it failed. Never left implicit. */
  readonly reason?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
}

/**
 * A run of a skill, resumable.
 *
 * `outputs` is what makes resumption real: each step's result is persisted as
 * plain JSON under the key its operation produces, so a later step reads the
 * *record* of an earlier one rather than a live object. A run that failed at
 * step six can be picked up at step six after a restart.
 */
export interface SkillRun {
  readonly id: string;
  readonly skillId: string;
  readonly skillName: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly status: SkillRunStatus;
  readonly steps: readonly SkillStepRecord[];
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly findings: readonly SkillFinding[];
  readonly measurements: readonly SkillMeasurement[];
  /** What this run could not look at, and why. */
  readonly notMeasured: readonly string[];
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly failureReason?: string;
  /** Set only when a model contributed to some step. */
  readonly modelId?: string;
  /** How many times this run has been resumed after a failure. */
  readonly resumeCount: number;
}

export interface SkillRunSummary {
  readonly id: string;
  readonly skillId: string;
  readonly skillName: string;
  readonly status: SkillRunStatus;
  readonly startedAt: string;
  readonly stepsDone: number;
  readonly stepsTotal: number;
  readonly findingCount: number;
}

export function summariseRun(run: SkillRun): SkillRunSummary {
  return {
    id: run.id,
    skillId: run.skillId,
    skillName: run.skillName,
    status: run.status,
    startedAt: run.startedAt,
    stepsDone: run.steps.filter((s) => s.status === "ok" || s.status === "skipped").length,
    stepsTotal: run.steps.length,
    findingCount: run.findings.length,
  };
}

/** True when a run stopped part-way and has steps left to do. */
export function isResumable(run: SkillRun): boolean {
  return (
    (run.status === "failed" || run.status === "cancelled") &&
    run.steps.some((step) => step.status === "pending" || step.status === "failed")
  );
}

/** The progress line a step shows while a skill runs. */
export function describeStep(step: SkillStepRecord): string {
  switch (step.status) {
    case "ok":
      return `✓ ${step.summary ?? step.title}`;
    case "skipped":
      return `− ${step.title} — ${step.reason ?? "skipped"}`;
    case "failed":
      return `✗ ${step.title} — ${step.reason ?? "failed"}`;
    case "running":
      return `→ ${step.title}`;
    case "pending":
      return `  ${step.title}`;
  }
}
