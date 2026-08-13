import { agentById, checkPermission, grantFor } from "@jellytind/agent-runtime";
import { ContextCompiler, renderContextPackage } from "@jellytind/context-compiler";
import type { RoutingClass } from "@jellytind/domain";
import type { LanguageModel, OutputSchema } from "@jellytind/model-router";
import {
  ARTIFACT_FORMATS,
  renderArtifact,
  type AgentWorkExecutor,
  type AgentWorkRequest,
  type AgentWorkResult,
} from "@jellytind/orchestration";
import type { StoryRepository } from "@jellytind/story-repository";
import { EditError } from "./types";

/**
 * One specialist doing one step of a workflow.
 *
 * The orchestrator decides *who* runs and *what they are given*; this is where
 * that becomes a model call. Three things are worth noticing:
 *
 * - The specialist's own grant is checked here, so a workflow cannot hand an
 *   agent work its permissions do not cover
 *   ([SPECIALIST_AGENTS.md](../../../docs/SPECIALIST_AGENTS.md)).
 * - The model is given **compiled context plus the artifacts handed to it** —
 *   not a transcript of what the previous agent said while producing them.
 * - The response is asked for in the artifact's own declared shape, and the
 *   orchestrator validates it before it becomes a handoff. A malformed reply
 *   fails the step; it never reaches the next agent or the project.
 */
const SYSTEM_PREAMBLE = `You are one specialist inside Manu, a fiction development environment, working on one step of a workflow a writer started.

Rules:
- Do the step you were given and nothing else. Another specialist handles what is not yours.
- Work from the material you were handed: compiled project context, and the artifacts earlier steps produced.
- Do not invent scenes, characters or IDs. If something you need is missing, say so in the artifact rather than filling the gap.
- You are not the last word. A writer reads what you produce and may decline it.
- Reply with JSON only, in exactly the shape asked for. No commentary around it.`;

interface RawPayload {
  readonly [field: string]: unknown;
}

const PAYLOAD_SCHEMA: OutputSchema<RawPayload> = {
  name: "WorkflowArtifact",
  parse(value: unknown): RawPayload {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new EditError("empty_response", "WorkflowArtifact: expected a JSON object.");
    }
    return value as RawPayload;
  },
};

export interface ModelAgentWorkExecutorOptions {
  readonly repo: StoryRepository;
  /**
   * The model for a class of work. Different steps may resolve to different
   * models — that is the whole point of the routing class
   * ([MODEL_ROUTER.md](../../../docs/MODEL_ROUTER.md)).
   */
  readonly modelFor: (routingClass: RoutingClass) => Promise<LanguageModel>;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
}

export class ModelAgentWorkExecutor implements AgentWorkExecutor {
  private readonly repo: StoryRepository;
  private readonly modelFor: (routingClass: RoutingClass) => Promise<LanguageModel>;
  private readonly maxOutputTokens: number;
  private readonly timeoutMs: number;

  constructor(options: ModelAgentWorkExecutorOptions) {
    this.repo = options.repo;
    this.modelFor = options.modelFor;
    this.maxOutputTokens = options.maxOutputTokens ?? 4_000;
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  async run(request: AgentWorkRequest): Promise<AgentWorkResult> {
    const specialist = agentById(request.agent);
    const decision = checkPermission(
      { name: "workflow_step", permission: "read_canon" },
      grantFor(specialist),
    );
    /* istanbul ignore next — every specialist holds read_canon. */
    if (!decision.allowed) {
      throw new EditError("permission_denied", decision.reason);
    }

    const model = await this.modelFor(request.routingClass);
    const context = await this.compile(request);
    const handoffs = request.inputs.map((artifact) =>
      renderArtifact(artifact.kind, artifact.payload),
    );

    const system = [
      SYSTEM_PREAMBLE,
      "",
      `YOUR ROLE: ${specialist.name} — ${specialist.role}`,
      `You are responsible for: ${specialist.responsibilities.join("; ")}.`,
      `You do not do: ${specialist.outOfScope.join("; ")}.`,
    ].join("\n");

    const messages = [
      ...(context === null ? [] : [{ role: "user" as const, content: context }]),
      ...(handoffs.length === 0
        ? []
        : [
            {
              role: "user" as const,
              content: `HANDOFFS — what earlier steps produced.\n\n${handoffs.join("\n\n")}`,
            },
          ]),
      {
        role: "user" as const,
        content: `THE WRITER'S GOAL: ${request.goal}\n\nYOUR STEP: ${request.instruction}\n\nReply with JSON matching:\n${ARTIFACT_FORMATS[request.produces]}`,
      },
    ];

    const result = await model.generateStructured(
      { system, messages, schema: PAYLOAD_SCHEMA, maxOutputTokens: this.maxOutputTokens },
      {
        timeoutMs: this.timeoutMs,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );

    return { payload: result, modelId: model.id, calls: 1 };
  }

  /** The compiled context for this step, when the node names a recipe. */
  private async compile(request: AgentWorkRequest): Promise<string | null> {
    if (request.contextRecipe === undefined || request.targetId === undefined) return null;
    const compiler = new ContextCompiler(this.repo);
    const compiled = await compiler.compile({
      recipe: request.contextRecipe,
      targetId: request.targetId,
      instruction: request.instruction,
    });
    return renderContextPackage(compiled);
  }
}
