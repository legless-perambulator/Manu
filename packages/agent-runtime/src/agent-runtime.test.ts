import { describe, expect, it } from "vitest";
import { MockLanguageModel, ModelError, parseModelJson } from "@jellytind/model-router";
import type {
  GenerateRequest,
  GenerateResult,
  LanguageModel,
  ModelCapabilities,
  RequestOptions,
  StreamEvent,
  StructuredRequest,
  ToolCall,
  ToolCallRequest,
  ToolCallResult,
} from "@jellytind/model-router";
import type {
  Chapter,
  Character,
  Location,
  PlotThread,
  Project,
  Relationship,
  Scene,
} from "@jellytind/domain";
import { AGENT_ANSWER_SCHEMA } from "./answer";
import { AgentError } from "./errors";
import { ToolExecutor } from "./executor";
import { InvestigationAgent } from "./investigator";
import { checkPermission, READ_ONLY_GRANT } from "./permissions";
import type { AgentStore, ProjectAccess } from "./ports";
import { objectSchema } from "./schema";
import { canTransition, createTask, transition, type AgentTask } from "./task";
import { ToolRegistry, isReadOnly, type Tool } from "./tool";
import { createProjectTools, READ_ONLY_TOOL_NAMES } from "./tools/project-tools";
import { safeToolPath } from "./tools/paths";
import { summarizeArguments, summarizeResult, type AgentActivityEvent } from "./activity";

// ── Fixtures ────────────────────────────────────────────────────────────────

const MARA = "CHAR_0001";
const ELIAS = "CHAR_0002";
const SCENE_A = "SCENE_0001";
const SCENE_B = "SCENE_0002";

const scene = (id: string, title: string, characterIds: string[]): Scene =>
  ({
    id,
    title,
    chapterId: "CHAPTER_0001",
    characterIds,
    plotThreadIds: ["THREAD_0001"],
    objectIds: [],
    purpose: ["establish the rift"],
    status: "drafted",
  }) as unknown as Scene;

const FILES: Record<string, string> = {
  "manuscript/CHAPTER_0001.md": "line one\nline two\nline three\nline four",
  "characters/CHAR_0001.md": "# Mara\nShe keeps her own counsel.",
};

const ENTITIES: Record<string, unknown> = {
  [MARA]: {
    id: MARA,
    name: "Mara",
    aliases: [],
    description: "",
    role: "protagonist",
    notes: "",
    status: "active",
    filePath: "characters/CHAR_0001.md",
  },
  [ELIAS]: {
    id: ELIAS,
    name: "Elias",
    aliases: [],
    description: "",
    role: "foil",
    notes: "",
    status: "active",
    filePath: "characters/CHAR_0002.md",
  },
  [SCENE_A]: scene(SCENE_A, "The Rift", [MARA, ELIAS]),
  [SCENE_B]: scene(SCENE_B, "After", [MARA]),
  CHAPTER_0001: {
    id: "CHAPTER_0001",
    title: "Openings",
    order: 0,
    filePath: "manuscript/CHAPTER_0001.md",
    status: "drafted",
  },
  LOC_0001: {
    id: "LOC_0001",
    name: "Blackthorn Manor",
    aliases: [],
    description: "",
    notes: "",
    filePath: "world/locations/LOC_0001.md",
  },
  THREAD_0001: {
    id: "THREAD_0001",
    name: "The vault",
    description: "",
    status: "active",
    relatedSceneIds: [SCENE_A],
  },
  REL_0001: {
    id: "REL_0001",
    characterAId: MARA,
    characterBId: ELIAS,
    type: "rival",
    description: "Wary allies.",
  },
};

function fixtureAccess(): ProjectAccess {
  const scenes = [ENTITIES[SCENE_A] as Scene, ENTITIES[SCENE_B] as Scene];
  return {
    project: {
      id: "PROJ_test",
      title: "Test Novel",
      rootPath: "/tmp/x",
      createdAt: "",
      updatedAt: "",
      schemaVersion: 1,
    } as Project,
    listProjectFiles: (prefix) =>
      Promise.resolve(
        [...Object.keys(FILES), ".writer/project.json"].filter(
          (p) => prefix === undefined || p.startsWith(prefix),
        ),
      ),
    readProjectFile: (path) => Promise.resolve(FILES[path] ?? null),
    searchText: () =>
      Promise.resolve([
        { id: SCENE_A, kind: "entity", title: "The Rift", excerpt: "Mara and Elias", score: 1 },
      ] as never),
    getEntity: <T>(id: string) => Promise.resolve((ENTITIES[id] ?? null) as T | null),
    listEntitySummaries: () => Promise.resolve([{ id: MARA, kind: "character", name: "Mara" }]),
    listChapters: () => Promise.resolve([ENTITIES.CHAPTER_0001 as Chapter]),
    listScenes: () => Promise.resolve(scenes),
    listCharacters: () =>
      Promise.resolve([ENTITIES[MARA] as Character, ENTITIES[ELIAS] as Character]),
    listLocations: () => Promise.resolve([ENTITIES.LOC_0001 as Location]),
    listPlotThreads: () => Promise.resolve([ENTITIES.THREAD_0001 as PlotThread]),
    listRelationships: () => Promise.resolve([ENTITIES.REL_0001 as Relationship]),
    getScenesByCharacter: (id) =>
      Promise.resolve(scenes.filter((s) => s.characterIds.includes(id))),
    getScenesByLocation: () => Promise.resolve([]),
    getScenesByPlotThread: () => Promise.resolve([scenes[0] as Scene]),
  };
}

/** In-memory {@link AgentStore} so runtime tests need no filesystem. */
class MemoryAgentStore implements AgentStore {
  readonly tasks: AgentTask[] = [];
  readonly events: AgentActivityEvent[] = [];
  private seq = 0;

  listTasks(): Promise<AgentTask[]> {
    return Promise.resolve([...this.tasks]);
  }
  getTask(id: string): Promise<AgentTask | null> {
    return Promise.resolve(this.tasks.find((t) => t.id === id) ?? null);
  }
  nextTaskId(): Promise<string> {
    this.seq += 1;
    return Promise.resolve(`TASK_${this.seq}`);
  }
  saveTask(task: AgentTask): Promise<AgentTask> {
    const i = this.tasks.findIndex((t) => t.id === task.id);
    if (i === -1) this.tasks.push(task);
    else this.tasks[i] = task;
    return Promise.resolve(task);
  }
  appendActivity(event: Omit<AgentActivityEvent, "id">): Promise<AgentActivityEvent> {
    const stored = { ...event, id: `ACT_${this.events.length + 1}` };
    this.events.push(stored);
    return Promise.resolve(stored);
  }
  listActivity(taskId?: string): Promise<AgentActivityEvent[]> {
    return Promise.resolve(
      taskId === undefined ? [...this.events] : this.events.filter((e) => e.taskId === taskId),
    );
  }
}

/** A model driven by a fixed script, for exercising the agent loop offline. */
class ScriptedModel implements LanguageModel {
  readonly id = "scripted:test";
  readonly capabilities: ModelCapabilities = {
    streaming: false,
    structuredOutput: true,
    tools: true,
  };
  turn = 0;

  constructor(
    private readonly script: ReadonlyArray<readonly ToolCall[]>,
    private readonly answerJson: string,
    private readonly beforeTurn?: (turn: number) => void,
  ) {}

  runWithTools(_request: ToolCallRequest, _options?: RequestOptions): Promise<ToolCallResult> {
    this.beforeTurn?.(this.turn);
    const toolCalls = this.script[this.turn] ?? [];
    this.turn += 1;
    return Promise.resolve({
      text: toolCalls.length > 0 ? "Checking the project." : "Done investigating.",
      toolCalls,
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: toolCalls.length > 0 ? "tool_use" : "stop",
    });
  }

  generateStructured<T>(request: StructuredRequest<T>, _options?: RequestOptions): Promise<T> {
    return Promise.resolve(parseModelJson(request.schema, this.answerJson));
  }

  generateText(_r: GenerateRequest, _o?: RequestOptions): Promise<GenerateResult> {
    return Promise.reject(new ModelError("unsupported", "not used"));
  }
  streamText(_r: GenerateRequest, _o?: RequestOptions): AsyncIterable<StreamEvent> {
    throw new ModelError("unsupported", "not used");
  }
}

const ANSWER_JSON = JSON.stringify({
  summary: "Mara appears in two scenes.",
  findings: [{ statement: "Mara and Elias share SCENE_0001.", sources: [SCENE_A] }],
  interpretation: "Their wariness seems to soften.",
  uncertainties: ["No scene records the cause."],
});

function buildRuntime(access = fixtureAccess()) {
  const registry = new ToolRegistry().register(...createProjectTools(access));
  const store = new MemoryAgentStore();
  const executor = new ToolExecutor({ registry, grant: READ_ONLY_GRANT, store });
  return { registry, store, executor };
}

const newTask = (overrides: Partial<Parameters<typeof createTask>[0]> = {}): AgentTask =>
  createTask({
    id: "TASK_0001",
    goal: "Find every scene containing Mara.",
    now: "2026-01-01T00:00:00.000Z",
    allowedTools: READ_ONLY_TOOL_NAMES,
    ...overrides,
  });

// ── Tool registration ───────────────────────────────────────────────────────

describe("ToolRegistry", () => {
  const dummy: Tool<{ id: string }, { ok: boolean }> = {
    name: "dummy",
    description: "A tool.",
    permission: "read_canon",
    inputSchema: objectSchema("In", { id: { type: "string", description: "id" } }),
    outputSchema: objectSchema("Out", { ok: { type: "boolean", description: "ok" } }),
    handler: () => Promise.resolve({ ok: true }),
  };

  it("registers, finds and describes tools", () => {
    const registry = new ToolRegistry().add(dummy);
    expect(registry.has("dummy")).toBe(true);
    expect(registry.list()).toHaveLength(1);
    const [described] = registry.describe();
    expect(described?.name).toBe("dummy");
    expect(described?.inputSchema).toMatchObject({ type: "object", required: ["id"] });
  });

  it("rejects duplicate tool names", () => {
    const registry = new ToolRegistry().add(dummy);
    expect(() => registry.add(dummy)).toThrow(AgentError);
  });

  it("throws a typed error for unknown tools", () => {
    expect(() => new ToolRegistry().get("nope")).toThrowError(/No tool named/);
    expect(new ToolRegistry().has("nope")).toBe(false);
  });

  it("registers all thirteen read-only project tools", () => {
    const { registry } = buildRuntime();
    expect(
      registry
        .list()
        .map((t) => t.name)
        .sort(),
    ).toEqual([...READ_ONLY_TOOL_NAMES].sort());
    expect(registry.list().every(isReadOnly)).toBe(true);
  });
});

// ── Schema validation ───────────────────────────────────────────────────────

describe("tool schemas", () => {
  const schema = objectSchema<{ id: string; limit?: number }>("Q", {
    id: { type: "string", description: "id" },
    limit: { type: "number", description: "n", optional: true },
  });

  it("accepts valid input and drops undeclared keys", () => {
    expect(schema.parse({ id: "CHAR_0001", limit: 5, sneaky: "path/../etc" })).toEqual({
      id: "CHAR_0001",
      limit: 5,
    });
  });

  it("rejects missing required fields and wrong types", () => {
    expect(() => schema.parse({})).toThrowError(/"id" is required/);
    expect(() => schema.parse({ id: 7 })).toThrowError(/must be of type string/);
    expect(() => schema.parse({ id: "x", limit: "many" })).toThrowError(/must be of type number/);
    expect(() => schema.parse("not an object")).toThrowError(/expected an object/);
  });

  it("publishes a JSON schema for the model", () => {
    expect(schema.jsonSchema).toMatchObject({
      type: "object",
      required: ["id"],
      additionalProperties: false,
    });
  });
});

// ── Permissions ─────────────────────────────────────────────────────────────

describe("permissions", () => {
  const readTool = { name: "get_scene", permission: "read_canon" } as const;
  const writeTool = { name: "write_scene", permission: "edit_manuscript" } as const;

  it("allows a read tool under the read-only grant and denies a write tool", () => {
    expect(checkPermission(readTool, READ_ONLY_GRANT).allowed).toBe(true);
    const denied = checkPermission(writeTool, READ_ONLY_GRANT);
    expect(denied.allowed).toBe(false);
    expect(denied.allowed === false && denied.reason).toMatch(/edit_manuscript/);
  });

  it("enforces the task's tool allow-list independently of permissions", () => {
    const grant = { permissions: ["read_canon"] as const, allowedTools: ["get_character"] };
    const denied = checkPermission(readTool, grant);
    expect(denied.allowed).toBe(false);
    expect(denied.allowed === false && denied.reason).toMatch(/not in this task's allowed tools/);
  });

  it("blocks a forbidden tool before its handler can run", async () => {
    const access = fixtureAccess();
    const registry = new ToolRegistry().register(...createProjectTools(access));
    const store = new MemoryAgentStore();
    const executor = new ToolExecutor({
      registry,
      grant: { permissions: ["read_canon"], allowedTools: ["get_scene"] },
      store,
    });
    const outcome = await executor.execute("TASK_0001", "read_file", {
      path: "manuscript/CHAPTER_0001.md",
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.event.status).toBe("denied");
    expect(store.events).toHaveLength(1);
  });
});

// ── Bad arguments & tool failures ───────────────────────────────────────────

describe("tool execution", () => {
  it("rejects malformed arguments without calling the handler", async () => {
    const { executor, store } = buildRuntime();
    const outcome = await executor.execute("TASK_0001", "get_scene", { wrong: true });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/"id" is required/);
    expect(store.events[0]?.status).toBe("failed");
  });

  it("rejects an ID of the wrong kind", async () => {
    const { executor } = buildRuntime();
    const outcome = await executor.execute("TASK_0001", "get_scene", { id: MARA });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/is a character ID/);
  });

  it("reports unknown tools as a recoverable failure, not a crash", async () => {
    const { executor } = buildRuntime();
    const outcome = await executor.execute("TASK_0001", "delete_everything", {});
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/No tool named/);
  });

  it("retrieves real project data through typed tools", async () => {
    const { executor } = buildRuntime();
    const scenes = await executor.execute("TASK_0001", "get_scenes_by_character", { id: MARA });
    expect(scenes.ok).toBe(true);
    expect((scenes.output as { scenes: Scene[] }).scenes).toHaveLength(2);

    const character = await executor.execute("TASK_0001", "get_character", { id: MARA });
    expect((character.output as { relationships: Relationship[] }).relationships).toHaveLength(1);

    const range = await executor.execute("TASK_0001", "read_range", {
      path: "manuscript/CHAPTER_0001.md",
      startLine: 2,
      endLine: 3,
    });
    expect((range.output as { content: string }).content).toBe("line two\nline three");
  });

  it("logs every call with argument and result summaries", async () => {
    const { executor, store } = buildRuntime();
    await executor.execute("TASK_0001", "get_scene", { id: SCENE_A });
    const [event] = store.events;
    expect(event?.tool).toBe("get_scene");
    expect(event?.argumentsSummary).toBe("id=SCENE_0001");
    expect(event?.status).toBe("ok");
    expect(event?.resultSummary).toContain("scene");
  });
});

// ── Path traversal prevention ───────────────────────────────────────────────

describe("project traversal prevention", () => {
  it("rejects traversal, absolute paths and NUL bytes", () => {
    for (const bad of ["../secrets", "a/../../b", "/etc/passwd", "C:/x", "a\0b"]) {
      expect(() => safeToolPath("read_file", bad)).toThrowError(/read_file|path/i);
    }
    expect(safeToolPath("read_file", "manuscript/./CHAPTER_0001.md")).toBe(
      "manuscript/CHAPTER_0001.md",
    );
  });

  it("refuses internal .writer state", () => {
    expect(() => safeToolPath("read_file", ".writer/project.json")).toThrowError(/internal/);
    expect(() => safeToolPath("read_file", "manuscript/../.writer/agents/tasks.json")).toThrowError(
      /internal/,
    );
  });

  it("blocks escaping paths at the tool boundary", async () => {
    const { executor } = buildRuntime();
    const outcome = await executor.execute("TASK_0001", "read_file", { path: "../../etc/passwd" });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/traverses above the project root/);
  });

  it("omits internal state from file listings", async () => {
    const { executor } = buildRuntime();
    const outcome = await executor.execute("TASK_0001", "list_project_files", {});
    const { files } = outcome.output as { files: string[] };
    expect(files).toContain("manuscript/CHAPTER_0001.md");
    expect(files.some((f) => f.startsWith(".writer"))).toBe(false);
  });
});

// ── Task state ──────────────────────────────────────────────────────────────

describe("AgentTask state", () => {
  it("starts pending with the requested scope and tools", () => {
    const task = newTask({ scope: [MARA] });
    expect(task.status).toBe("pending");
    expect(task.scope).toEqual([MARA]);
    expect(task.allowedTools).toEqual(READ_ONLY_TOOL_NAMES);
    expect(task.approvalPolicy).toBe("approve_every_edit");
  });

  it("requires a goal", () => {
    expect(() => newTask({ goal: "   " })).toThrow(AgentError);
  });

  it("permits only legal transitions", () => {
    expect(canTransition("pending", "running")).toBe(true);
    expect(canTransition("running", "awaiting_approval")).toBe(true);
    expect(canTransition("awaiting_approval", "running")).toBe(true);
    expect(canTransition("completed", "running")).toBe(false);
    expect(canTransition("cancelled", "completed")).toBe(false);
  });

  it("records failure reasons and refuses to restart a finished task", () => {
    const running = transition(newTask(), "running", { now: "t1" });
    const failed = transition(running, "failed", { now: "t2", failureReason: "provider down" });
    expect(failed.failureReason).toBe("provider down");
    expect(failed.updatedAt).toBe("t2");
    expect(() => transition(failed, "running", { now: "t3" })).toThrowError(
      /cannot become running/,
    );
  });
});

// ── Activity summaries ──────────────────────────────────────────────────────

describe("activity summaries", () => {
  it("summarises arguments and results without copying content", () => {
    expect(summarizeArguments({ id: SCENE_A, limit: 5 })).toBe("id=SCENE_0001, limit=5");
    expect(summarizeArguments({})).toBe("no arguments");
    expect(summarizeResult({ scenes: [1, 2, 3] })).toBe("3 scenes");
    expect(summarizeResult({ content: "a".repeat(500) })).toBe("content: 500 chars");
  });
});

// ── The agent loop ──────────────────────────────────────────────────────────

describe("InvestigationAgent", () => {
  it("uses tools, then answers from what it retrieved", async () => {
    const { executor, store } = buildRuntime();
    const model = new ScriptedModel(
      [
        [{ id: "t1", name: "get_scenes_by_character", input: { id: MARA } }],
        [{ id: "t2", name: "get_scene", input: { id: SCENE_A } }],
        [],
      ],
      ANSWER_JSON,
    );
    const agent = new InvestigationAgent({ model, executor, store });
    const lines: string[] = [];

    const result = await agent.run(newTask(), {
      onActivity: (_event, line) => lines.push(line),
    });

    expect(result.task.status).toBe("completed");
    expect(result.events.map((e) => e.tool)).toEqual(["get_scenes_by_character", "get_scene"]);
    expect(lines[0]).toContain("get_scenes_by_character id=CHAR_0001");
    expect(result.answer?.findings[0]?.sources).toEqual([SCENE_A]);
    expect(result.answer?.interpretation).toBe("Their wariness seems to soften.");
    expect(store.events).toHaveLength(2);
  });

  it("separates retrieved findings from interpretation", () => {
    const answer = AGENT_ANSWER_SCHEMA.parse(JSON.parse(ANSWER_JSON));
    expect(answer.findings).toHaveLength(1);
    expect(answer.uncertainties).toEqual(["No scene records the cause."]);
    expect(() => AGENT_ANSWER_SCHEMA.parse({ summary: "x" })).toThrow(AgentError);
    expect(() => AGENT_ANSWER_SCHEMA.parse({ summary: "x", findings: [{}] })).toThrow(AgentError);
  });

  it("cancels mid-run and leaves the task cancelled", async () => {
    const { executor, store } = buildRuntime();
    const controller = new AbortController();
    const model = new ScriptedModel(
      [[{ id: "t1", name: "get_scene", input: { id: SCENE_A } }], []],
      ANSWER_JSON,
      (turn) => {
        if (turn === 1) controller.abort();
      },
    );
    const agent = new InvestigationAgent({ model, executor, store });

    const result = await agent.run(newTask(), { signal: controller.signal });

    expect(result.task.status).toBe("cancelled");
    expect(result.answer).toBeUndefined();
    expect(store.tasks[0]?.status).toBe("cancelled");
  });

  it("does not start when the signal is already aborted", async () => {
    const { executor, store } = buildRuntime();
    const controller = new AbortController();
    controller.abort();
    const model = new ScriptedModel([[]], ANSWER_JSON);
    const result = await new InvestigationAgent({ model, executor, store }).run(newTask(), {
      signal: controller.signal,
    });
    expect(result.task.status).toBe("cancelled");
    expect(store.events).toHaveLength(0);
  });

  it("marks the task failed when the provider fails", async () => {
    const { executor, store } = buildRuntime();
    const model = new MockLanguageModel({ failWith: "rate_limit" });
    const agent = new InvestigationAgent({ model, executor, store });

    await expect(agent.run(newTask())).rejects.toMatchObject({ agentCode: "provider_failed" });
    expect(store.tasks[0]?.status).toBe("failed");
    expect(store.tasks[0]?.failureReason).toMatch(/rate_limit/);
  });

  it("refuses to run on a model without tool support", async () => {
    const { executor, store } = buildRuntime();
    const model = new MockLanguageModel({ capabilities: { tools: false } });
    await expect(
      new InvestigationAgent({ model, executor, store }).run(newTask()),
    ).rejects.toThrowError(/does not support tool calling/);
  });

  it("stops at the step ceiling instead of looping forever", async () => {
    const { executor, store } = buildRuntime();
    const looping = new ScriptedModel([], ANSWER_JSON);
    // An empty script yields no tool calls, so extend it to always ask again.
    const model = new Proxy(looping, {
      get(target, prop, receiver) {
        if (prop === "runWithTools") {
          return () =>
            Promise.resolve({
              text: "again",
              toolCalls: [{ id: "t", name: "get_scene", input: { id: SCENE_A } }],
              usage: { inputTokens: 1, outputTokens: 1 },
              stopReason: "tool_use" as const,
            });
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });

    const result = await new InvestigationAgent({ model, executor, store, maxSteps: 3 }).run(
      newTask(),
    );
    expect(result.steps).toBe(3);
    expect(result.events).toHaveLength(3);
    expect(result.task.status).toBe("completed");
  });
});
