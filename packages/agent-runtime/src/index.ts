export { AgentError, ToolError } from "./errors";
export type { AgentErrorCode } from "./errors";

export { objectSchema, emptySchema } from "./schema";
export type { ToolSchema, FieldSpec, FieldType } from "./schema";

export { READ_ONLY_PERMISSIONS, READ_ONLY_GRANT, isMutating, checkPermission } from "./permissions";
export type { AgentPermission, PermissionGrant, PermissionDecision } from "./permissions";

export { ToolRegistry, describeTool, isReadOnly, eraseTool } from "./tool";
export type { RegisteredTool } from "./tool";
export type { Tool, ToolContext } from "./tool";

export { createTask, transition, canTransition, isTerminal, TERMINAL_STATUSES } from "./task";
export type { AgentTask, TaskStatus, ApprovalPolicy, CreateTaskInput } from "./task";

export { summarizeArguments, summarizeResult, describeActivity } from "./activity";
export type { AgentActivityEvent, ActivityStatus } from "./activity";

export type { ProjectAccess, AgentStore } from "./ports";

export { createProjectTools, READ_ONLY_TOOL_NAMES } from "./tools/project-tools";
export { safeToolPath, safeListPrefix } from "./tools/paths";

export { ToolExecutor } from "./executor";
export type { ToolCallOutcome, ToolExecutorOptions } from "./executor";

export { AGENT_ANSWER_SCHEMA, ANSWER_FORMAT_INSTRUCTIONS } from "./answer";
export type { AgentAnswer, Finding } from "./answer";

export { InvestigationAgent } from "./investigator";
export type { AgentRunResult, InvestigationAgentOptions, RunOptions } from "./investigator";

export { INVESTIGATOR_AGENT } from "./agent";
export type { AgentDescriptor } from "./agent";
