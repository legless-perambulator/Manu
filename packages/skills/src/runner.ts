import { describeStep } from "@jellytind/domain";
import type { SkillFinding, SkillMeasurement, SkillRun, SkillStepRecord } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import { operationById } from "./operations";
import {
  SkillError,
  type SkillAnalyst,
  type SkillContext,
  type SkillDefinition,
  type SkillRunStoreLike,
} from "./types";

export interface SkillProgress {
  readonly run: SkillRun;
  readonly step: SkillStepRecord;
  readonly index: number;
  readonly total: number;
  /** The line a progress display shows: `✓ Located 31 scenes`. */
  readonly line: string;
}

export interface RunOptions {
  readonly onProgress?: (event: SkillProgress) => void;
  readonly signal?: AbortSignal;
}

export interface SkillRunnerOptions {
  readonly repo: StoryRepository;
  readonly runs: SkillRunStoreLike;
  /** Without one, semantic steps are skipped and the rest still runs. */
  readonly analyst?: SkillAnalyst | null;
  readonly now?: () => string;
}

/**
 * Executes a skill, step by step, writing the run after every one.
 *
 * Two properties matter more than anything else here:
 *
 * **It is resumable.** Each step's output is persisted as plain JSON under the
 * key its operation produces, and a later step reads that record rather than a
 * live object. A run that died at step six — a crashed app, a provider
 * timeout, a closed lid — is picked up at step six.
 *
 * **A step that could not run says so.** `skipped` is a status of its own, with
 * a reason, and it never becomes `ok`. A report is allowed to be thin; it is
 * not allowed to imply it checked something it did not
 * (docs/WRITING_SKILLS.md).
 */
export class SkillRunner {
  private readonly repo: StoryRepository;
  private readonly runs: SkillRunStoreLike;
  private readonly analyst: SkillAnalyst | null;
  private readonly now: () => string;

  constructor(options: SkillRunnerOptions) {
    this.repo = options.repo;
    this.runs = options.runs;
    this.analyst = options.analyst ?? null;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Begin a run. Inputs are checked before any step executes. */
  async start(
    skill: SkillDefinition,
    inputs: Readonly<Record<string, string>> = {},
    options: RunOptions = {},
  ): Promise<SkillRun> {
    for (const input of skill.inputs) {
      if (input.required && (inputs[input.key] ?? "") === "") {
        throw new SkillError("missing_input", `${skill.name} needs ${input.label}.`, {
          details: { skill: skill.id, input: input.key },
        });
      }
    }

    const run: SkillRun = {
      id: await this.runs.nextId(),
      skillId: skill.id,
      skillName: skill.name,
      inputs,
      status: "running",
      steps: skill.steps.map((step) => ({
        id: step.id,
        title: step.title,
        operationId: step.operationId,
        status: "pending",
      })),
      outputs: {},
      findings: [],
      measurements: [],
      notMeasured: [],
      startedAt: this.now(),
      resumeCount: 0,
    };
    await this.runs.save(run);
    return this.execute(skill, run, options);
  }

  /**
   * Continue a run that stopped part-way.
   *
   * Completed steps are not run again — their recorded outputs are what the
   * remaining steps read.
   */
  async resume(runId: string, skill: SkillDefinition, options: RunOptions = {}): Promise<SkillRun> {
    const stored = await this.runs.get(runId);
    if (stored === null) {
      throw new SkillError("run_not_found", `No skill run with id ${runId}.`);
    }
    if (stored.status === "completed") {
      throw new SkillError("not_resumable", `${stored.skillName} (${runId}) already completed.`);
    }
    if (stored.skillId !== skill.id) {
      throw new SkillError(
        "not_resumable",
        `Run ${runId} belongs to ${stored.skillName}, not ${skill.name}.`,
      );
    }

    const run: SkillRun = {
      ...stored,
      status: "running",
      resumeCount: stored.resumeCount + 1,
      // A failed step is retried; one that was skipped for a stated reason is
      // not — skipping was the answer, and re-running it would change what the
      // report claims without the writer asking for it.
      steps: stored.steps.map((step) =>
        step.status === "failed" || step.status === "running"
          ? { id: step.id, title: step.title, operationId: step.operationId, status: "pending" }
          : step,
      ),
    };
    const cleared: SkillRun = { ...run };
    delete (cleared as { failureReason?: string }).failureReason;
    await this.runs.save(cleared);
    return this.execute(skill, cleared, options);
  }

  private async execute(
    skill: SkillDefinition,
    initial: SkillRun,
    options: RunOptions,
  ): Promise<SkillRun> {
    let run = initial;
    const total = run.steps.length;

    for (const [index, planned] of run.steps.entries()) {
      if (planned.status === "ok" || planned.status === "skipped") continue;

      if (options.signal?.aborted === true) {
        return this.finish(run, "cancelled", "Cancelled before this step ran.");
      }

      const step = skill.steps.find((entry) => entry.id === planned.id);
      /* istanbul ignore next — the run's steps come from the skill's. */
      if (step === undefined) continue;
      const operation = operationById(step.operationId);

      const startedAt = this.now();
      const started = Date.now();
      run = await this.record(run, index, { status: "running", startedAt });
      options.onProgress?.({
        run,
        step: run.steps[index] as SkillStepRecord,
        index,
        total,
        line: describeStep(run.steps[index] as SkillStepRecord),
      });

      const context: SkillContext = {
        repo: this.repo,
        inputs: run.inputs,
        read: <T>(key: string): T | null => (run.outputs[key] as T | undefined) ?? null,
        analyst: operation.kind === "semantic" ? this.analyst : null,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        finding: (n: number) => `${run.id}.${step.id}.${String(n + 1)}`,
        stepId: step.id,
        findings: run.findings,
        measurements: run.measurements,
        notMeasured: run.notMeasured,
      };

      try {
        const outcome = await operation.run(context);
        const durationMs = Date.now() - started;

        if (outcome.skipped !== undefined) {
          run = await this.record(run, index, {
            status: "skipped",
            summary: outcome.summary,
            reason: outcome.skipped,
            startedAt,
            finishedAt: this.now(),
            durationMs,
          });
        } else {
          run = await this.record(
            run,
            index,
            {
              status: "ok",
              summary: outcome.summary,
              startedAt,
              finishedAt: this.now(),
              durationMs,
            },
            {
              ...(outcome.data === undefined ? {} : { [operation.produces]: outcome.data }),
            },
            outcome.findings ?? [],
            outcome.measurements ?? [],
            outcome.notMeasured ?? [],
            operation.kind === "semantic" ? (this.analyst?.modelId ?? undefined) : undefined,
          );
        }
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        run = await this.record(run, index, {
          status: "failed",
          reason,
          startedAt,
          finishedAt: this.now(),
          durationMs: Date.now() - started,
        });
        options.onProgress?.({
          run,
          step: run.steps[index] as SkillStepRecord,
          index,
          total,
          line: describeStep(run.steps[index] as SkillStepRecord),
        });
        // The steps that did run keep their results: a failure at step six must
        // not cost the writer steps one to five.
        return this.finish(run, "failed", reason);
      }

      options.onProgress?.({
        run,
        step: run.steps[index] as SkillStepRecord,
        index,
        total,
        line: describeStep(run.steps[index] as SkillStepRecord),
      });
    }

    const problems = validateReport(skill, run);
    if (problems.length > 0) {
      return this.finish(run, "failed", problems.join(" "));
    }
    return this.finish(run, "completed");
  }

  private async record(
    run: SkillRun,
    index: number,
    patch: Partial<SkillStepRecord> & { status: SkillStepRecord["status"] },
    outputs: Record<string, unknown> = {},
    findings: readonly SkillFinding[] = [],
    measurements: readonly SkillMeasurement[] = [],
    notMeasured: readonly string[] = [],
    modelId?: string,
  ): Promise<SkillRun> {
    const steps = run.steps.map((step, at) => (at === index ? { ...step, ...patch } : step));
    const next: SkillRun = {
      ...run,
      steps,
      outputs: { ...run.outputs, ...outputs },
      findings: [...run.findings, ...findings],
      measurements: [...run.measurements, ...measurements],
      notMeasured: [...run.notMeasured, ...notMeasured],
      ...(modelId === undefined ? {} : { modelId }),
    };
    return this.runs.save(next);
  }

  private async finish(
    run: SkillRun,
    status: SkillRun["status"],
    failureReason?: string,
  ): Promise<SkillRun> {
    return this.runs.save({
      ...run,
      status,
      finishedAt: this.now(),
      ...(failureReason === undefined ? {} : { failureReason }),
    });
  }
}

/**
 * Check a finished run against the shape its skill promised.
 *
 * A declared section may be legitimately absent — when the step that produces
 * it was skipped, and said why. Anything else is a broken promise, and the run
 * is marked failed rather than quietly returning less than it claimed.
 */
export function validateReport(skill: SkillDefinition, run: SkillRun): string[] {
  const problems: string[] = [];
  for (const section of skill.outputSchema.sections) {
    if (Object.prototype.hasOwnProperty.call(run.outputs, section)) continue;
    const producing = skill.steps.filter(
      (step) => operationById(step.operationId).produces === section,
    );
    const allAccountedFor = producing.every((step) => {
      const record = run.steps.find((entry) => entry.id === step.id);
      return record?.status === "skipped" || record?.status === "pending";
    });
    if (!allAccountedFor) {
      problems.push(`${skill.outputSchema.name} declares "${section}", which no step produced.`);
    }
  }
  return problems;
}
