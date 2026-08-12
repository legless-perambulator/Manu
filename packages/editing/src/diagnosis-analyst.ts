import {
  checkPermission,
  createTask,
  transition,
  type PermissionGrant,
} from "@jellytind/agent-runtime";
import { ModelError, type LanguageModel, type OutputSchema } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  CONFIDENCE_LEVELS,
  DEBUG_MODE_LABEL,
  INTERVENTION_EFFORTS,
  INTERVENTION_KINDS,
  type Confidence,
  type DebugReport,
  type DebugRequest,
  type DebugRequestInput,
  type DebugTrace,
  type Diagnosis,
  type Intervention,
  type InterventionEffort,
  type InterventionKind,
} from "@jellytind/story-debugger";
import { EditError } from "./types";

const REQUIRED_PERMISSION = "read_canon" as const;

/**
 * The interpreting half of the Story Debugger.
 *
 * The deterministic trace lives in `@jellytind/story-debugger`, below the
 * repository, and knows nothing about models. This is the controlled AI
 * operation layered on top — which is why it lives here, beside the manuscript
 * editor and the state extractor: the same posture governs all three. The model
 * *proposes*; a human decides; nothing is applied (docs/STORY_DEBUGGER.md,
 * docs/AI_EDITING.md).
 *
 * The contract with the model is narrow on purpose. It is given the evidence
 * the trace retrieved, each item with an ID, and it must cite those IDs. A
 * claim citing evidence that does not exist is not quietly dropped — it is
 * reported as unsupported, because a diagnosis resting on invented evidence is
 * exactly the failure this product exists to prevent.
 */

const SYSTEM_PROMPT = `You are the Story Debugger inside Manu, a fiction development environment.

A writer has said something is not working in their story. You are given the deterministic evidence the project retrieved about it: what is recorded, where, and by which system. Your job is to interpret that evidence — not to give general writing advice.

Rules:
- Every claim you make must rest on the evidence given. Cite the evidence IDs (E1, E2, …) that support it.
- Do not assert anything about prose you were not shown. You have excerpts, not the manuscript.
- Do not invent scenes, characters, facts or IDs. If the evidence does not settle something, say so in your uncertainty.
- Measurements are counts, not verdicts. "The first signal is nine scenes before the reveal" does not mean nine is too many; say what you think it means and why.
- Distinguish what the project records from what you infer. An absence of recorded data means nothing was recorded, which is not the same as nothing happening in the story.
- State what would change your answer. A diagnosis with no stated uncertainty is not a diagnosis.
- Propose interventions as options for the writer, with a reason each. You are not making the change and must not describe one as made.
- Be specific and short. A writer reads this to decide what to do next.`;

interface RawDiagnosis {
  readonly diagnosis?: {
    readonly statement?: unknown;
    readonly reasoning?: unknown;
    readonly confidence?: unknown;
    readonly uncertainty?: unknown;
    readonly basis?: unknown;
  };
  readonly interventions?: unknown;
}

const DIAGNOSIS_SCHEMA: OutputSchema<RawDiagnosis> = {
  name: "StoryDiagnosis",
  parse(value: unknown): RawDiagnosis {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new EditError("empty_response", "StoryDiagnosis: expected an object.");
    }
    return value as RawDiagnosis;
  },
};

const FORMAT = `Reply with JSON only, matching:
{
  "diagnosis": {
    "statement": "one sentence: what you think is going on",
    "reasoning": "two or three sentences connecting the evidence to that statement",
    "confidence": "${CONFIDENCE_LEVELS.join(" | ")}",
    "uncertainty": ["what would change this answer"],
    "basis": ["E1", "E4"]
  },
  "interventions": [
    {
      "kind": "${INTERVENTION_KINDS.join(" | ")}",
      "summary": "what the writer could do",
      "rationale": "why it would help, referring to the evidence",
      "effort": "${INTERVENTION_EFFORTS.join(" | ")}",
      "sceneIds": ["SCENE_0001"],
      "entities": ["CHAR_0001"]
    }
  ]
}`;

export interface DiagnosisAnalystOptions {
  readonly repo: StoryRepository;
  readonly model: LanguageModel;
  readonly grant: PermissionGrant;
  readonly now?: () => string;
  readonly maxOutputTokens?: number;
}

export class DiagnosisAnalyst {
  private readonly repo: StoryRepository;
  private readonly model: LanguageModel;
  private readonly grant: PermissionGrant;
  private readonly now: () => string;
  private readonly maxOutputTokens: number;

  constructor(options: DiagnosisAnalystOptions) {
    this.repo = options.repo;
    this.model = options.model;
    this.grant = options.grant;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxOutputTokens = options.maxOutputTokens ?? 1_500;
  }

  /**
   * Trace a problem, interpret the evidence, and store the report.
   *
   * The trace always runs. If the model call fails, the report is still saved
   * with its evidence and no diagnosis — a failed interpretation must not cost
   * the writer the investigation.
   */
  async debug(request: DebugRequestInput | DebugRequest): Promise<DebugReport> {
    const decision = checkPermission(
      { name: "story_debug", permission: REQUIRED_PERMISSION },
      this.grant,
    );
    if (!decision.allowed) {
      throw new EditError("permission_denied", decision.reason, {
        details: { mode: request.mode },
      });
    }

    const started = Date.now();
    const trace = await this.repo.traceStoryProblem(request);

    const task = createTask({
      id: await this.repo.agents.nextTaskId(),
      goal: `story_debug (${request.mode}): ${trace.problem}`,
      now: this.now(),
      scope: [...trace.scope.sceneIds],
      allowedTools: [],
      approvalPolicy: "approve_every_edit",
    });
    await this.repo.agents.saveTask(task);
    let current = await this.repo.agents.saveTask(transition(task, "running", { now: this.now() }));

    try {
      const { diagnosis, interventions } = await this.interpret(trace);
      const report = await this.repo.saveDebugReport(trace, {
        durationMs: Date.now() - started,
        diagnosis,
        interventions,
        modelId: this.model.id,
      });

      current = await this.repo.agents.saveTask(
        transition(current, "awaiting_approval", { now: this.now() }),
      );
      await this.repo.agents.appendActivity({
        taskId: current.id,
        timestamp: this.now(),
        tool: "story_debug",
        argumentsSummary: `${request.mode}: ${trace.problem}`,
        resultSummary: `${String(trace.evidence.length)} evidence item(s), ${String(interventions.length)} intervention(s) proposed`,
        status: "ok",
      });
      return report;
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      await this.repo.agents.saveTask(
        transition(current, "failed", { now: this.now(), failureReason: reason }),
      );
      // The evidence is worth keeping even when nothing interpreted it.
      const report = await this.repo.saveDebugReport(trace, { durationMs: Date.now() - started });
      if (cause instanceof ModelError) {
        throw new EditError(
          "provider_failed",
          `${reason} The evidence was saved as ${report.id}.`,
          {
            cause,
          },
        );
      }
      throw cause;
    }
  }

  private async interpret(
    trace: DebugTrace,
  ): Promise<{ diagnosis: Diagnosis; interventions: readonly Intervention[] }> {
    const raw = await this.model.generateStructured(
      {
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: renderTraceForModel(trace) },
          { role: "user", content: `Diagnose the problem stated above.\n\n${FORMAT}` },
        ],
        schema: DIAGNOSIS_SCHEMA,
        maxOutputTokens: this.maxOutputTokens,
      },
      { timeoutMs: 120_000 },
    );

    const known = new Set(trace.evidence.map((item) => item.id));
    const cited = strings(raw.diagnosis?.basis);
    const statement = text(raw.diagnosis?.statement);
    if (statement === "") {
      throw new EditError("empty_response", "The model returned no diagnosis.");
    }

    return {
      diagnosis: {
        statement,
        reasoning: text(raw.diagnosis?.reasoning),
        confidence: confidenceOf(raw.diagnosis?.confidence),
        uncertainty: strings(raw.diagnosis?.uncertainty),
        basis: cited.filter((id) => known.has(id)),
        // Kept, not dropped: a citation to nothing is the thing worth seeing.
        unsupported: cited.filter((id) => !known.has(id)),
      },
      interventions: interventionsOf(raw.interventions),
    };
  }
}

/**
 * The trace as the model sees it.
 *
 * Evidence IDs are printed prominently because the model is required to cite
 * them, and measurements carry their basis so the model can see how a number
 * was arrived at rather than treating it as a verdict.
 */
export function renderTraceForModel(trace: DebugTrace): string {
  const out: string[] = [];
  out.push(`PROBLEM (${DEBUG_MODE_LABEL[trace.mode]})`);
  out.push(trace.problem);
  out.push("");
  out.push("SCOPE INSPECTED");
  out.push(trace.scope.summary);
  out.push(`Systems traced: ${trace.scope.systems.join(", ")}`);
  for (const gap of trace.scope.notInspected) out.push(`NOT inspected: ${gap}`);
  out.push("");

  out.push("EVIDENCE — deterministic, retrieved from the project. Cite these IDs.");
  for (const item of trace.evidence) {
    out.push(`${item.id} [${item.system}] ${item.statement}`);
    if (item.detail !== undefined) out.push(`   ${item.detail}`);
  }
  out.push("");

  if (trace.measurements.length > 0) {
    out.push("MEASUREMENTS — counts, not verdicts.");
    for (const m of trace.measurements) {
      out.push(`${m.label}: ${String(m.value)} ${m.unit} (${m.basis})`);
    }
    out.push("");
  }

  if (trace.excerpts.length > 0) {
    out.push("PROSE — excerpts only. Do not reason about text you were not shown.");
    for (const ex of trace.excerpts) {
      out.push(`--- ${ex.label}`);
      out.push(ex.text);
    }
  }
  return out.join("\n");
}

// ── Coercion: model output is untrusted ──────────────────────────────────────

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== "") : [];

function confidenceOf(value: unknown): Confidence {
  return typeof value === "string" && (CONFIDENCE_LEVELS as readonly string[]).includes(value)
    ? (value as Confidence)
    : // An unreadable confidence is not a high one.
      "low";
}

function interventionsOf(value: unknown): readonly Intervention[] {
  if (!Array.isArray(value)) return [];
  const out: Intervention[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const summary = text(raw.summary);
    if (summary === "") continue;
    out.push({
      kind: oneOf(raw.kind, INTERVENTION_KINDS, "revise"),
      summary,
      rationale: text(raw.rationale),
      effort: oneOf(raw.effort, INTERVENTION_EFFORTS, "moderate"),
      sceneIds: strings(raw.sceneIds).filter((id) => id.startsWith("SCENE_")),
      entities: strings(raw.entities).filter((id) => /^[A-Z]+_/.test(id)),
    });
  }
  return out;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export type { InterventionKind, InterventionEffort };
