import { AppError } from "@jellytind/shared";

/**
 * Typed failure categories for agent operations. Callers switch on the code
 * rather than parsing messages, and the UI can explain what happened without
 * knowing anything about the model or the provider (docs/AGENT_RUNTIME.md).
 */
export type AgentErrorCode =
  | "unknown_tool"
  | "unknown_agent"
  | "duplicate_tool"
  | "invalid_arguments"
  | "invalid_output"
  | "permission_denied"
  | "out_of_scope"
  | "path_escape"
  | "tool_failed"
  | "invalid_transition"
  | "cancelled"
  | "provider_failed"
  | "no_answer";

export class AgentError extends AppError {
  readonly agentCode: AgentErrorCode;

  constructor(
    agentCode: AgentErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(`agent_${agentCode}`, message, options);
    this.agentCode = agentCode;
  }
}

/**
 * A tool-level failure. Kept as a distinct class because tool failures are
 * routinely reported *back to the model* as a tool result so the agent can
 * recover, whereas other agent errors abort the run.
 */
export class ToolError extends AgentError {
  readonly toolName: string;

  constructor(
    agentCode: AgentErrorCode,
    toolName: string,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(agentCode, message, {
      ...options,
      details: { ...options?.details, tool: toolName },
    });
    this.toolName = toolName;
  }
}
