import type { ToolDefinition } from "@jellytind/model-router";
import { AgentError } from "./errors";
import { isMutating, type AgentPermission } from "./permissions";
import type { ToolSchema } from "./schema";

/** Per-call context handed to a tool handler. */
export interface ToolContext {
  /** The task this call belongs to, for attribution in the activity log. */
  readonly taskId: string;
  /** Cancellation: long reads should abort when this fires. */
  readonly signal?: AbortSignal;
}

/**
 * A typed agent tool.
 *
 * Agents never generate free-form file writes; they act through tools whose
 * inputs and outputs are schema-validated, whose permission is declared, and
 * whose every call is logged — so each action is auditable and the harness can
 * enforce what an agent may do (MASTER_BUILD.md §6, docs/AGENT_TOOLS.md).
 */
export interface Tool<Input = unknown, Output = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolSchema<Input>;
  readonly outputSchema: ToolSchema<Output>;
  readonly permission: AgentPermission;
  handler(input: Input, context: ToolContext): Promise<Output>;
}

/**
 * A tool with its input/output types erased, as held by the registry.
 *
 * Tools of different shapes have to live in one collection, and the executor
 * validates every value through the schemas anyway — so the registry stores the
 * erased form and {@link eraseTool} performs the one narrow cast, rather than
 * letting `any` leak through the whole runtime.
 */
export interface RegisteredTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolSchema<unknown>;
  readonly outputSchema: ToolSchema<unknown>;
  readonly permission: AgentPermission;
  handler(input: unknown, context: ToolContext): Promise<unknown>;
}

/** Erase a typed tool for registration. The handler cast is safe because the
 * executor parses input through `inputSchema` before ever calling it. */
export function eraseTool<Input, Output>(tool: Tool<Input, Output>): RegisteredTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as ToolSchema<unknown>,
    outputSchema: tool.outputSchema as ToolSchema<unknown>,
    permission: tool.permission,
    handler: (input, context) => tool.handler(input as Input, context),
  };
}

/**
 * True when a tool cannot change project state. Derived from `permission` so
 * read/write classification has exactly one source of truth and a tool cannot
 * declare itself read-only while holding a write permission.
 */
export function isReadOnly(tool: { readonly permission: AgentPermission }): boolean {
  return !isMutating(tool.permission);
}

/** Describe a tool to a model in provider-independent terms. */
export function describeTool(tool: RegisteredTool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema.jsonSchema,
  };
}

/** Registry of tools available to an agent, keyed by unique tool name. */
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(...tools: readonly RegisteredTool[]): this {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        throw new AgentError(
          "duplicate_tool",
          `A tool named "${tool.name}" is already registered.`,
          { details: { tool: tool.name } },
        );
      }
      this.tools.set(tool.name, tool);
    }
    return this;
  }

  /** Register a typed tool, erasing its types. */
  add<Input, Output>(tool: Tool<Input, Output>): this {
    return this.register(eraseTool(tool));
  }

  get(name: string): RegisteredTool {
    const tool = this.tools.get(name);
    if (tool === undefined) {
      throw new AgentError("unknown_tool", `No tool named "${name}" is registered.`, {
        details: { tool: name },
      });
    }
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  /** Only the tools a set of names covers, in registration order. */
  select(names: readonly string[]): RegisteredTool[] {
    return this.list().filter((tool) => names.includes(tool.name));
  }

  /** Provider-independent definitions for the given tools (or all of them). */
  describe(names?: readonly string[]): ToolDefinition[] {
    return (names === undefined ? this.list() : this.select(names)).map(describeTool);
  }
}
