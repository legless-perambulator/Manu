import { describe, expect, it } from "vitest";
import { ModelError, parseModelJson } from "@jellytind/model-router";
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
import type { Chapter, Character, Location, PlotThread, Project, Scene } from "@jellytind/domain";
import { AGENT_ANSWER_SCHEMA, groundAnswer, repairInstructions } from "./answer";
import { EvidenceLedger, collectEvidence, isWellFormedReference } from "./evidence";
import { ToolExecutor } from "./executor";
import { InvestigationAgent } from "./investigator";
import { READ_ONLY_GRANT } from "./permissions";
import type { AgentStore, ProjectAccess } from "./ports";
import { createTask, type AgentTask } from "./task";
import { ToolRegistry } from "./tool";
import { createProjectTools } from "./tools/project-tools";
import type { AgentActivityEvent } from "./activity";

/**
 * Citation grounding (MANU-007).
 *
 * The audit's exact test case: "a test where a scripted model fabricates a
 * source ID and the runtime must reject it." These are that test, plus the
 * cases around it — because the interesting failures are the near misses, not
 * the obvious ones.
 */

const MARA = "CHAR_0001";
const SCENE_A = "SCENE_0001";
const SCENE_B = "SCENE_0002";
const CHAPTER = "CHAPTER_0001";
const CHAPTER_PATH = "manuscript/CHAPTER_0001.md";

const scene = (id: string): Scene =>
  ({
    id,
    title: id,
    chapterId: CHAPTER,
    characterIds: [MARA],
    plotThreadIds: [],
    objectIds: [],
    purpose: [],
    status: "drafted",
  }) as unknown as Scene;

const ENTITIES: Record<string, unknown> = {
  [MARA]: {
    id: MARA,
    name: "Mara",
    aliases: [],
    description: "",
    role: "",
    notes: "",
    status: "active",
    filePath: "characters/CHAR_0001.md",
  },
  [SCENE_A]: scene(SCENE_A),
  [SCENE_B]: scene(SCENE_B),
  [CHAPTER]: {
    id: CHAPTER,
    title: "Openings",
    order: 0,
    filePath: CHAPTER_PATH,
    status: "drafted",
  },
};

function access(): ProjectAccess {
  const scenes = [ENTITIES[SCENE_A] as Scene, ENTITIES[SCENE_B] as Scene];
  return {
    project: {
      id: "PROJ_test",
      title: "Test",
      rootPath: "/tmp/x",
      createdAt: "",
      updatedAt: "",
      schemaVersion: 1,
    } as Project,
    listProjectFiles: () => Promise.resolve([CHAPTER_PATH]),
    readProjectFile: () => Promise.resolve("Mara waited."),
    searchText: () => Promise.resolve([]),
    getEntity: <T>(id: string) => Promise.resolve((ENTITIES[id] ?? null) as T | null),
    listEntitySummaries: () => Promise.resolve([]),
    listChapters: () => Promise.resolve([ENTITIES[CHAPTER] as Chapter]),
    listScenes: () => Promise.resolve(scenes),
    listCharacters: () => Promise.resolve([ENTITIES[MARA] as Character]),
    listLocations: () => Promise.resolve([] as Location[]),
    listPlotThreads: () => Promise.resolve([] as PlotThread[]),
    listRelationships: () => Promise.resolve([]),
    getScenesByCharacter: () => Promise.resolve(scenes),
    getScenesByLocation: () => Promise.resolve([]),
    getScenesByPlotThread: () => Promise.resolve([]),
  };
}

class MemoryStore implements AgentStore {
  readonly tasks: AgentTask[] = [];
  readonly events: AgentActivityEvent[] = [];
  listTasks(): Promise<AgentTask[]> {
    return Promise.resolve([...this.tasks]);
  }
  getTask(id: string): Promise<AgentTask | null> {
    return Promise.resolve(this.tasks.find((t) => t.id === id) ?? null);
  }
  nextTaskId(): Promise<string> {
    return Promise.resolve(`TASK_${String(this.tasks.length + 1)}`);
  }
  saveTask(task: AgentTask): Promise<AgentTask> {
    const i = this.tasks.findIndex((t) => t.id === task.id);
    if (i === -1) this.tasks.push(task);
    else this.tasks[i] = task;
    return Promise.resolve(task);
  }
  appendActivity(event: Omit<AgentActivityEvent, "id">): Promise<AgentActivityEvent> {
    const stored = { ...event, id: `ACT_${String(this.events.length + 1)}` };
    this.events.push(stored);
    return Promise.resolve(stored);
  }
  listActivity(): Promise<AgentActivityEvent[]> {
    return Promise.resolve([...this.events]);
  }
}

/** A model that runs a fixed tool script and then returns answers in order. */
class ScriptedModel implements LanguageModel {
  readonly id = "scripted:grounding";
  readonly capabilities: ModelCapabilities = {
    streaming: false,
    structuredOutput: true,
    tools: true,
  };
  turn = 0;
  structuredCalls: StructuredRequest<unknown>[] = [];

  constructor(
    private readonly script: ReadonlyArray<readonly ToolCall[]>,
    private readonly answers: readonly string[],
  ) {}

  runWithTools(_r: ToolCallRequest, _o?: RequestOptions): Promise<ToolCallResult> {
    const toolCalls = this.script[this.turn] ?? [];
    this.turn += 1;
    return Promise.resolve({
      text: "",
      toolCalls,
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: toolCalls.length > 0 ? "tool_use" : "stop",
    });
  }

  generateStructured<T>(request: StructuredRequest<T>, _o?: RequestOptions): Promise<T> {
    const index = Math.min(this.structuredCalls.length, this.answers.length - 1);
    this.structuredCalls.push(request as StructuredRequest<unknown>);
    return Promise.resolve(parseModelJson(request.schema, this.answers[index] as string));
  }

  generateText(_r: GenerateRequest, _o?: RequestOptions): Promise<GenerateResult> {
    return Promise.reject(new ModelError("unsupported", "not used"));
  }
  streamText(_r: GenerateRequest, _o?: RequestOptions): AsyncIterable<StreamEvent> {
    throw new ModelError("unsupported", "not used");
  }
}

const answerWith = (findings: Array<{ statement: string; sources: string[] }>): string =>
  JSON.stringify({
    summary: "A summary.",
    findings,
    interpretation: "A reading.",
    uncertainties: [],
  });

function runtime() {
  const store = new MemoryStore();
  const executor = new ToolExecutor({
    registry: new ToolRegistry().register(...createProjectTools(access())),
    grant: READ_ONLY_GRANT,
    store,
  });
  return { store, executor };
}

const newTask = (): AgentTask =>
  createTask({
    id: "TASK_0001",
    goal: "Where does Mara appear?",
    now: "2026-01-01T00:00:00.000Z",
    allowedTools: ["get_scene", "get_scenes_by_character", "read_file"],
    approvalPolicy: "approve_every_edit",
  });

// ── Extraction ──────────────────────────────────────────────────────────────

describe("collectEvidence", () => {
  it("finds entity IDs and file paths anywhere in a tool result", () => {
    const refs = collectEvidence({
      scenes: [{ id: SCENE_A, chapterId: CHAPTER }],
      character: { id: MARA, filePath: "characters/CHAR_0001.md" },
    });
    const references = refs.map((r) => r.reference);
    expect(references).toContain(SCENE_A);
    expect(references).toContain(CHAPTER);
    expect(references).toContain(MARA);
    expect(references).toContain("characters/CHAR_0001.md");
    expect(refs.find((r) => r.reference === SCENE_A)?.entityKind).toBe("scene");
  });

  it("grounds an ID that appeared inside retrieved prose", () => {
    // The agent genuinely received this text. Refusing to let it cite what the
    // text says would be its own kind of dishonesty.
    const refs = collectEvidence({ content: "See SCENE_0007 for the reveal." });
    expect(refs.map((r) => r.reference)).toContain("SCENE_0007");
  });

  it("does not invent references from ordinary prose", () => {
    const refs = collectEvidence({ content: "Mara went to the vault. It was dark." });
    expect(refs).toEqual([]);
  });

  it("ignores tokens shaped like IDs but of no known kind", () => {
    expect(collectEvidence({ note: "WIDGET_0001 and HTTP_404" })).toEqual([]);
  });

  it("terminates on a deeply nested or cyclic-looking structure", () => {
    let deep: unknown = { id: SCENE_A };
    for (let i = 0; i < 40; i += 1) deep = { nested: deep };
    expect(() => collectEvidence(deep)).not.toThrow();
  });
});

describe("isWellFormedReference", () => {
  it("separates a plausible reference from prose", () => {
    expect(isWellFormedReference(SCENE_A)).toBe(true);
    expect(isWellFormedReference("SCENE_0099")).toBe(true);
    expect(isWellFormedReference(CHAPTER_PATH)).toBe(true);
    expect(isWellFormedReference("the vault scene")).toBe(false);
    expect(isWellFormedReference("")).toBe(false);
  });
});

// ── The ledger ──────────────────────────────────────────────────────────────

describe("EvidenceLedger", () => {
  const ledger = () => new EvidenceLedger(() => "2026-01-01T00:00:00.000Z");

  it("mints one handle per reference, keeping the first retrieval", () => {
    const l = ledger();
    l.absorb("ACT_1", "get_scene", collectEvidence({ id: SCENE_A }));
    l.absorb("ACT_2", "get_scenes_by_character", collectEvidence({ scenes: [{ id: SCENE_A }] }));
    expect(l.size).toBe(1);
    expect(l.resolve(SCENE_A)?.toolCallId).toBe("ACT_1");
    expect(l.resolve(SCENE_A)?.id).toBe("EV_0001");
  });

  it("tells the three verdicts apart", () => {
    const l = ledger();
    l.absorb("ACT_1", "get_scene", collectEvidence({ id: SCENE_A }));
    expect(l.verdict(SCENE_A)).toBe("verified");
    // Well formed, never retrieved: the model invented a plausible ID.
    expect(l.verdict("SCENE_0099")).toBe("unknown");
    // Not a reference at all: the model misunderstood the field.
    expect(l.verdict("the vault scene")).toBe("malformed");
  });
});

// ── Grounding ───────────────────────────────────────────────────────────────

describe("groundAnswer", () => {
  function ledgerWith(...refs: string[]): EvidenceLedger {
    const l = new EvidenceLedger(() => "2026-01-01T00:00:00.000Z");
    l.absorb(
      "ACT_1",
      "get_scene",
      refs.map((reference) => ({ kind: "entity" as const, reference })),
    );
    return l;
  }

  it("marks a finding grounded when every source resolves", () => {
    const answer = AGENT_ANSWER_SCHEMA.parse(
      JSON.parse(answerWith([{ statement: "Mara is in it.", sources: [SCENE_A] }])),
    );
    const report = groundAnswer(answer, ledgerWith(SCENE_A));
    expect(report.problems).toEqual([]);
    expect(report.answer.findings[0]?.grounded).toBe(true);
    expect(report.answer.findings[0]?.evidence).toEqual(["EV_0001"]);
    expect(report.groundedFindings).toBe(1);
  });

  it("keeps a fabricated citation visible rather than deleting the finding", () => {
    // Deleting it would hide that the model made something up, which is exactly
    // what a reader needs to know.
    const answer = AGENT_ANSWER_SCHEMA.parse(
      JSON.parse(answerWith([{ statement: "Mara dies.", sources: ["SCENE_0099"] }])),
    );
    const report = groundAnswer(answer, ledgerWith(SCENE_A));
    expect(report.answer.findings).toHaveLength(1);
    expect(report.answer.findings[0]?.grounded).toBe(false);
    expect(report.answer.findings[0]?.unverified).toEqual(["SCENE_0099"]);
    expect(report.problems[0]?.verdict).toBe("unknown");
  });

  it("treats a partially fabricated citation as ungrounded", () => {
    // One real source does not launder an invented one.
    const answer = AGENT_ANSWER_SCHEMA.parse(
      JSON.parse(answerWith([{ statement: "Both.", sources: [SCENE_A, "SCENE_0099"] }])),
    );
    const report = groundAnswer(answer, ledgerWith(SCENE_A));
    expect(report.answer.findings[0]?.grounded).toBe(false);
    expect(report.answer.findings[0]?.evidence).toEqual(["EV_0001"]);
  });

  it("counts an uncited finding as ungrounded", () => {
    const answer = AGENT_ANSWER_SCHEMA.parse(
      JSON.parse(answerWith([{ statement: "It feels tense.", sources: [] }])),
    );
    const report = groundAnswer(answer, ledgerWith(SCENE_A));
    expect(report.uncited).toEqual([0]);
    expect(report.answer.findings[0]?.grounded).toBe(false);
    // Not a *problem* — nothing was fabricated. Just not project canon.
    expect(report.problems).toEqual([]);
  });

  it("distinguishes a malformed citation from an unknown one", () => {
    const answer = AGENT_ANSWER_SCHEMA.parse(
      JSON.parse(
        answerWith([
          { statement: "a", sources: ["the vault scene"] },
          { statement: "b", sources: ["SCENE_0099"] },
        ]),
      ),
    );
    const report = groundAnswer(answer, ledgerWith(SCENE_A));
    expect(report.problems.map((p) => p.verdict)).toEqual(["malformed", "unknown"]);
  });

  it("names the rejected sources and the permitted ones in a repair prompt", () => {
    const report = groundAnswer(
      AGENT_ANSWER_SCHEMA.parse(
        JSON.parse(answerWith([{ statement: "Mara dies.", sources: ["SCENE_0099"] }])),
      ),
      ledgerWith(SCENE_A),
    );
    const prompt = repairInstructions(report.problems, [SCENE_A]);
    expect(prompt).toContain("SCENE_0099");
    expect(prompt).toContain("never returned by any tool");
    expect(prompt).toContain(SCENE_A);
    expect(prompt).toContain("uncertainties");
  });
});

// ── End to end through the agent ────────────────────────────────────────────

describe("InvestigationAgent grounding", () => {
  it("accepts citations the tools actually returned", async () => {
    const { executor, store } = runtime();
    const model = new ScriptedModel(
      [[{ id: "t1", name: "get_scene", input: { id: SCENE_A } }], []],
      [answerWith([{ statement: "Mara is in it.", sources: [SCENE_A] }])],
    );

    const result = await new InvestigationAgent({ model, executor, store }).run(newTask());

    expect(result.answer?.findings[0]?.grounded).toBe(true);
    expect(result.evidence.map((h) => h.reference)).toContain(SCENE_A);
    expect(result.grounding?.problems).toEqual([]);
    // One structured call: nothing needed repairing.
    expect(model.structuredCalls).toHaveLength(1);
  });

  it("rejects a fabricated source ID and asks once for a repair", async () => {
    const { executor, store } = runtime();
    const model = new ScriptedModel(
      [[{ id: "t1", name: "get_scene", input: { id: SCENE_A } }], []],
      [
        answerWith([{ statement: "Mara dies in the vault.", sources: ["SCENE_0099"] }]),
        answerWith([{ statement: "Mara appears here.", sources: [SCENE_A] }]),
      ],
    );

    const result = await new InvestigationAgent({ model, executor, store }).run(newTask());

    expect(model.structuredCalls).toHaveLength(2);
    expect(result.answer?.findings[0]?.grounded).toBe(true);
    expect(result.answer?.findings[0]?.statement).toBe("Mara appears here.");
    expect(result.grounding?.problems).toEqual([]);
  });

  it("marks the claim unverified when the model fabricates twice", async () => {
    const { executor, store } = runtime();
    const model = new ScriptedModel(
      [[{ id: "t1", name: "get_scene", input: { id: SCENE_A } }], []],
      [answerWith([{ statement: "Mara dies in the vault.", sources: ["SCENE_0099"] }])],
    );

    const result = await new InvestigationAgent({ model, executor, store }).run(newTask());

    // Bounded: asked once, not argued with forever.
    expect(model.structuredCalls).toHaveLength(2);
    expect(result.answer?.findings[0]?.grounded).toBe(false);
    expect(result.answer?.findings[0]?.unverified).toEqual(["SCENE_0099"]);
    expect(result.grounding?.groundedFindings).toBe(0);
    expect(result.grounding?.totalFindings).toBe(1);
  });

  it("keeps the better of the two attempts", async () => {
    const { executor, store } = runtime();
    const model = new ScriptedModel(
      [[{ id: "t1", name: "get_scene", input: { id: SCENE_A } }], []],
      [
        answerWith([{ statement: "One bad source.", sources: ["SCENE_0099"] }]),
        // A retry that invents *more* is not an improvement and is discarded.
        answerWith([{ statement: "Two bad sources.", sources: ["SCENE_0098", "SCENE_0097"] }]),
      ],
    );

    const result = await new InvestigationAgent({ model, executor, store }).run(newTask());

    expect(result.answer?.findings[0]?.statement).toBe("One bad source.");
    expect(result.grounding?.problems).toHaveLength(1);
  });

  it("grounds nothing from a tool call that failed", async () => {
    const { executor, store } = runtime();
    const model = new ScriptedModel(
      // SCENE_0404 does not exist, so the tool errors and returns no evidence —
      // but the ID still appeared in the *arguments*, which must not count.
      [[{ id: "t1", name: "get_scene", input: { id: "SCENE_0404" } }], []],
      [answerWith([{ statement: "Invented.", sources: ["SCENE_0404"] }])],
    );

    const result = await new InvestigationAgent({ model, executor, store }).run(newTask());

    expect(result.evidence).toEqual([]);
    expect(result.answer?.findings[0]?.grounded).toBe(false);
  });

  it("lets an answer cite a file path it read", async () => {
    const { executor, store } = runtime();
    const model = new ScriptedModel(
      [[{ id: "t1", name: "read_file", input: { path: CHAPTER_PATH } }], []],
      [answerWith([{ statement: "Mara waited.", sources: [CHAPTER_PATH] }])],
    );

    const result = await new InvestigationAgent({ model, executor, store }).run(newTask());

    expect(result.answer?.findings[0]?.grounded).toBe(true);
    expect(result.evidence.some((h) => h.kind === "file")).toBe(true);
  });
});
