import { AppError } from "@jellytind/shared";

/**
 * A typed agent tool. Agents never generate free-form file writes; they act
 * through tools with typed inputs and outputs, so every action is auditable and
 * the harness can enforce permissions and validation (MASTER_BUILD.md §6,
 * docs/AGENT_TOOLS.md).
 *
 * `readOnly` lets the runtime separate side-effect-free reads from mutations
 * (mutations route through the mutation/versioning layer). Actual tool
 * implementations arrive with their subsystems; this is the shared contract.
 */
export interface Tool<Input = unknown, Output = unknown> {
  readonly name: string;
  readonly description: string;
  /** True if the tool has no side effects (safe to run without approval). */
  readonly readOnly: boolean;
  execute(input: Input): Promise<Output>;
}

export class ToolError extends AppError {
  constructor(code: string, message: string) {
    super(code, message);
  }
}

/** Registry of tools available to an agent, keyed by unique tool name. */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    if (this.tools.has(tool.name)) {
      throw new ToolError("duplicate_tool", `A tool named "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): Tool {
    const tool = this.tools.get(name);
    if (tool === undefined) {
      throw new ToolError("unknown_tool", `No tool named "${name}" is registered.`);
    }
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }
}
