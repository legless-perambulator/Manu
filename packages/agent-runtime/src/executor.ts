import { AgentError, ToolError } from "./errors";
import { checkPermission, type PermissionGrant } from "./permissions";
import type { AgentStore } from "./ports";
import {
  summarizeArguments,
  summarizeResult,
  type ActivityStatus,
  type AgentActivityEvent,
} from "./activity";
import { collectEvidence, type EvidenceRef } from "./evidence";
import type { RegisteredTool, ToolContext, ToolRegistry } from "./tool";

export interface ToolCallOutcome {
  readonly ok: boolean;
  /** The validated output when `ok`, otherwise undefined. */
  readonly output?: unknown;
  /** A message safe to hand back to the model when the call failed. */
  readonly error?: string;
  readonly event: AgentActivityEvent;
  /**
   * Citable identifiers this call returned.
   *
   * Extracted here rather than by the caller because this is the only place
   * that has seen the *validated* output — a result that failed its own schema
   * grounds nothing (MANU-007). Empty for every failed call, which is the
   * point: a tool that errored produced no evidence.
   */
  readonly evidence: readonly EvidenceRef[];
}

export interface ToolExecutorOptions {
  readonly registry: ToolRegistry;
  readonly grant: PermissionGrant;
  readonly store: AgentStore;
  readonly now?: () => string;
}

/**
 * Runs tool calls on an agent's behalf.
 *
 * This is the chokepoint that makes the tool system trustworthy. In order, each
 * call is: resolved against the registry, permission-checked, argument-validated
 * against the tool's input schema, executed, output-validated against the output
 * schema, and logged. A model that asks for an unregistered tool, a forbidden
 * tool or malformed arguments never reaches a handler.
 *
 * Failures are returned rather than thrown, because a failed tool call is
 * ordinary agent business: the model is told what went wrong and can try
 * something else. Only cancellation aborts the run.
 */
export class ToolExecutor {
  private readonly registry: ToolRegistry;
  private readonly grant: PermissionGrant;
  private readonly store: AgentStore;
  private readonly now: () => string;

  constructor(options: ToolExecutorOptions) {
    this.registry = options.registry;
    this.grant = options.grant;
    this.store = options.store;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private async log(
    taskId: string,
    tool: string,
    argumentsSummary: string,
    resultSummary: string,
    status: ActivityStatus,
    durationMs: number,
    references: readonly string[] = [],
  ): Promise<AgentActivityEvent> {
    return this.store.appendActivity({
      taskId,
      timestamp: this.now(),
      tool,
      argumentsSummary,
      resultSummary,
      status,
      durationMs,
      ...(references.length > 0 ? { references } : {}),
    });
  }

  /** Tool definitions the model may be offered for this grant. */
  describeAvailableTools(): ReturnType<ToolRegistry["describe"]> {
    const permitted = this.registry
      .list()
      .filter((tool) => checkPermission(tool, this.grant).allowed)
      .map((tool) => tool.name);
    return this.registry.describe(permitted);
  }

  async execute(
    taskId: string,
    toolName: string,
    rawInput: unknown,
    options: { signal?: AbortSignal } = {},
  ): Promise<ToolCallOutcome> {
    const startedAt = Date.now();
    const argsSummary = summarizeArguments(rawInput);
    // Read the flag fresh each time: it can flip while a handler is running.
    const aborted = (): boolean => options.signal?.aborted === true;
    const fail = async (status: ActivityStatus, message: string): Promise<ToolCallOutcome> => ({
      ok: false,
      error: message,
      event: await this.log(taskId, toolName, argsSummary, message, status, Date.now() - startedAt),
      evidence: [],
    });

    if (aborted()) {
      return fail("cancelled", "The task was cancelled.");
    }

    let tool: RegisteredTool;
    try {
      tool = this.registry.get(toolName);
    } catch (cause) {
      return fail("failed", cause instanceof Error ? cause.message : `Unknown tool "${toolName}".`);
    }

    const decision = checkPermission(tool, this.grant);
    if (!decision.allowed) {
      return fail("denied", decision.reason);
    }

    let input: unknown;
    try {
      input = tool.inputSchema.parse(rawInput);
    } catch (cause) {
      return fail("failed", cause instanceof Error ? cause.message : "Invalid tool arguments.");
    }

    const context: ToolContext = {
      taskId,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    };

    let output: unknown;
    try {
      output = await tool.handler(input, context);
    } catch (cause) {
      if (cause instanceof ToolError || cause instanceof AgentError) {
        return fail("failed", cause.message);
      }
      return fail("failed", cause instanceof Error ? cause.message : "The tool failed.");
    }

    if (aborted()) {
      return fail("cancelled", "The task was cancelled.");
    }

    let validated: unknown;
    try {
      validated = tool.outputSchema.parse(output);
    } catch (cause) {
      return fail(
        "failed",
        `Tool "${toolName}" returned output that failed its own schema: ${
          cause instanceof Error ? cause.message : "invalid output"
        }`,
      );
    }

    const evidence = collectEvidence(validated);
    return {
      ok: true,
      output: validated,
      event: await this.log(
        taskId,
        toolName,
        argsSummary,
        summarizeResult(validated),
        "ok",
        Date.now() - startedAt,
        evidence.map((ref) => ref.reference),
      ),
      evidence,
    };
  }
}
