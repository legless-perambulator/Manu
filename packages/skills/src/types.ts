import { AppError } from "@jellytind/shared";
import type { SkillFinding, SkillMeasurement, SkillRun, SkillRunSummary } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";

export type SkillErrorCode =
  | "unknown_skill"
  | "unknown_operation"
  | "missing_input"
  | "invalid_workflow"
  | "invalid_definition"
  | "run_not_found"
  | "not_resumable"
  | "step_failed"
  | "cancelled";

export class SkillError extends AppError {
  constructor(
    code: SkillErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(code, message, options);
  }
}

/** What a skill needs before it can run. */
export interface SkillInput {
  readonly key: string;
  readonly label: string;
  /** Which entity kind the value names, so the interface can offer a picker. */
  readonly entityKind?: "character" | "chapter" | "scene" | "plot_thread" | "mystery";
  readonly required: boolean;
  readonly description?: string;
}

/**
 * One executable operation.
 *
 * Operations are the alphabet skills are written in. A skill does not carry
 * code; it names operations in order, which is what makes a custom skill
 * possible without letting one execute anything the built-ins cannot
 * (docs/WRITING_SKILLS.md).
 */
export interface SkillOperation {
  readonly id: string;
  readonly title: string;
  /**
   * `deterministic` runs with no model at all. `semantic` needs one, and is
   * **skipped with a stated reason** when none is configured — never silently
   * dropped and never counted as passed.
   */
  readonly kind: "deterministic" | "semantic";
  /** Inputs it cannot run without. */
  readonly requiresInput: readonly string[];
  /** Output keys of earlier steps it consumes. */
  readonly reads: readonly string[];
  /** The key its own output is stored under. */
  readonly produces: string;
  /** The project operations it uses, named for the interface to show. */
  readonly requiredTools: readonly string[];
  /** The Context Compiler recipe it compiles, when it compiles one. */
  readonly contextRecipe?: string;
  run(context: SkillContext): Promise<StepOutcome>;
}

/** A step in a skill: an operation, optionally retitled for this workflow. */
export interface SkillStep {
  readonly id: string;
  readonly operationId: string;
  readonly title: string;
}

/**
 * The shape a skill promises to return.
 *
 * Declared *and enforced*: `validateReport` refuses a report that is missing a
 * declared section, so the schema cannot drift into decoration.
 */
export interface SkillOutputSchema {
  readonly name: string;
  /** Output keys that must be present in the finished run. */
  readonly sections: readonly string[];
}

export interface SkillDefinition {
  readonly id: string;
  /** The command a writer types, e.g. `/character-pass`. */
  readonly command: string;
  readonly name: string;
  readonly description: string;
  readonly inputs: readonly SkillInput[];
  readonly steps: readonly SkillStep[];
  /** Every tool the workflow uses, derived from its steps. */
  readonly requiredTools: readonly string[];
  /** Every recipe the workflow compiles, derived from its steps. */
  readonly contextRecipes: readonly string[];
  /** The specialist this work belongs to (docs/SPECIALIST_AGENTS.md). */
  readonly preferredAgent?: string;
  readonly outputSchema: SkillOutputSchema;
  /** Written by the writer rather than shipped with Manu. */
  readonly custom?: boolean;
}

/**
 * A short, structured reading by a model — the only thing semantic steps ask
 * for. Notes are proposals: nothing is applied, and each is labelled as
 * model-derived when it reaches the report.
 */
export interface AnalystNote {
  readonly statement: string;
  readonly detail?: string;
  readonly sceneIds?: readonly string[];
  readonly entities?: readonly string[];
}

/**
 * The semantic half, as a port.
 *
 * The skills package holds no provider knowledge and no prompt for generating
 * prose: it states what it needs read, and an implementation above it
 * (`@jellytind/editing`) does the model call. With no analyst, every semantic
 * step is skipped and the deterministic workflow still completes.
 */
export interface SkillAnalyst {
  readonly modelId: string;
  read(request: {
    /** What to look for, in one or two sentences. */
    instruction: string;
    /** The material retrieved by earlier deterministic steps. */
    material: string;
    maxItems?: number;
  }): Promise<readonly AnalystNote[]>;
}

export interface SkillContext {
  readonly repo: StoryRepository;
  readonly inputs: Readonly<Record<string, string>>;
  /**
   * An earlier step's output, read back from the persisted run.
   *
   * Deliberately *not* a live object: a resumed run has only the record, so a
   * step that works from the record works identically on the second attempt.
   */
  read<T>(key: string): T | null;
  readonly analyst: SkillAnalyst | null;
  readonly signal?: AbortSignal;
  /** Mint a finding id inside the current step. */
  finding(index: number): string;
  readonly stepId: string;
  /** What the run has established so far — what a report step assembles. */
  readonly findings: readonly SkillFinding[];
  readonly measurements: readonly SkillMeasurement[];
  readonly notMeasured: readonly string[];
}

export interface StepOutcome {
  /** One line: "Located 31 scenes". Shown as the step's progress line. */
  readonly summary: string;
  /** JSON-serialisable; stored under the operation's `produces` key. */
  readonly data?: unknown;
  readonly findings?: readonly SkillFinding[];
  readonly measurements?: readonly SkillMeasurement[];
  readonly notMeasured?: readonly string[];
  /** Present when the step could not run. `skipped` is not `ok`. */
  readonly skipped?: string;
}

/** Persistence for runs, satisfied structurally by `repo.skillRuns`. */
export interface SkillRunStoreLike {
  nextId(): Promise<string>;
  get(id: string): Promise<SkillRun | null>;
  save(run: SkillRun): Promise<SkillRun>;
  list(limit?: number): Promise<SkillRunSummary[]>;
}
