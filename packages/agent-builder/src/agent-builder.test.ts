import { describe, expect, it } from "vitest";
import {
  BUILD_TOOL_NAMES,
  DEBUG_TOOL_NAMES,
  PLAN_TOOL_NAMES,
  READ_ONLY_TOOL_NAMES,
  REFACTOR_TOOL_NAMES,
  RESEARCH_TOOL_NAMES,
  SPECIALIST_IDS,
  TEST_TOOL_NAMES,
} from "@jellytind/agent-runtime";
import { CORE_CATALOG, toolCatalog } from "./catalog";
import { permissionSummary, validateAgent, validateFlow, type ValidationContext } from "./validate";
import { BuilderStore } from "./store";
import { exportAgentPackage, exportFlowPackage, importPackage, parseAgentDefinition } from "./pack";
import { testAgent } from "./sandbox";
import { FlowRunner, type FlowRunPorts } from "./flow-runner";
import { FLOW_TEMPLATES } from "./templates";
import {
  BUILDER_VERSION,
  type AgentInvoker,
  type CustomAgentDefinition,
  type FileStorePort,
  type FlowDefinition,
} from "./types";

/** Phase 43: custom agents and flows, built entirely through the product API. */

function memoryFiles(): FileStorePort & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    readProjectFile: (path) => Promise.resolve(map.get(path) ?? null),
    writeProjectFile: (path, contents) => {
      map.set(path, contents);
      return Promise.resolve();
    },
    listProjectFiles: (prefix) =>
      Promise.resolve(
        [...map.keys()].filter((path) => prefix === undefined || path.startsWith(prefix)),
      ),
  };
}

const CONTEXT: ValidationContext = {
  catalog: CORE_CATALOG,
  availableModels: ["local-drafting-model"],
  availableAgents: [...SPECIALIST_IDS, "noir-dialogue-editor"],
};

/** Built the way the UI builds it: a plain definition, validated, then saved. */
const NOIR_EDITOR: CustomAgentDefinition = {
  id: "noir-dialogue-editor",
  name: "Noir Dialogue Editor",
  purpose: "Tighten dialogue into a hard-boiled register without losing each voice.",
  instructions:
    "Review dialogue for noir register: clipped rhythm, subtext over statement. Propose specific replacements and say why each earns its place.",
  permissions: ["read_manuscript", "read_canon"],
  tools: ["search_project", "read_file", "get_character", "get_chapter"],
  model: { kind: "class", modelClass: "drafting" },
  context: { currentChapter: true, charactersPresent: true, authorVoice: true },
  output: { kind: "proposals" },
  commandAlias: "noir-dialogue",
  scope: "project",
  revision: 1,
  metadata: {
    author: "A. Writer",
    description: "Hard-boiled dialogue editor.",
    compatibility: { app: "manu", builder: BUILDER_VERSION },
  },
};

const NOIR_PASS: FlowDefinition = {
  id: "noir-dialogue-pass",
  name: "Noir Dialogue Pass",
  description: "Search a chapter's dialogue, edit it in noir register, apply what you approve.",
  inputs: [{ key: "chapter", label: "Chapter", entityKind: "chapter", required: true }],
  steps: [
    {
      kind: "search_project",
      id: "s1",
      title: "Search dialogue in the chapter",
      query: "{input.chapter}",
    },
    {
      kind: "run_agent",
      id: "s2",
      title: "Noir Dialogue Editor review",
      agent: "noir-dialogue-editor",
      instruction: "Review the dialogue found and note where the register slackens.",
      retry: { maxAttempts: 2 },
    },
    {
      kind: "run_agent",
      id: "s3",
      title: "Compare against Character Voice",
      agent: "dialogue_editor",
      instruction: "Compare the noted lines against each character's established voice.",
    },
    {
      kind: "run_agent",
      id: "s4",
      title: "Propose edits",
      agent: "noir-dialogue-editor",
      instruction: "Propose the specific edits, one per line, honouring each character's voice.",
    },
    {
      kind: "request_approval",
      id: "s5",
      title: "Author approval",
      question: "Apply the accepted noir edits?",
    },
    { kind: "apply_staged_changes", id: "s6", title: "Stage accepted edits" },
    { kind: "run_story_build", id: "s7", title: "Run Story Build" },
    { kind: "generate_report", id: "s8", title: "Report" },
  ],
  output: "diff",
  commandAlias: "noir-dialogue-pass",
  scope: "project",
  revision: 1,
  metadata: { compatibility: { app: "manu", builder: BUILDER_VERSION } },
};

function fakeInvoker(): AgentInvoker & { calls: number; failuresLeft: number } {
  let proposalSeq = 0;
  const invoker = {
    calls: 0,
    failuresLeft: 0,
    invoke(request: Parameters<AgentInvoker["invoke"]>[0]) {
      invoker.calls += 1;
      if (invoker.failuresLeft > 0) {
        invoker.failuresLeft -= 1;
        return Promise.reject(new Error("provider hiccup"));
      }
      const who = request.definition?.name ?? request.specialist ?? "agent";
      return Promise.resolve({
        notes: [`${who}: ${request.instruction.slice(0, 40)}`],
        ...(request.wantsProposals
          ? {
              proposals: [
                {
                  id: `P${String((proposalSeq += 1))}`,
                  find: "“We should go,” she said sadly.",
                  replace: "“We're leaving.”",
                  reason: "Noir register: state less, mean more.",
                },
              ],
            }
          : {}),
        modelId: "local-drafting-model",
      });
    },
  };
  return invoker;
}

function ports(
  files: FileStorePort,
  invoker: AgentInvoker | null,
  options: {
    buildErrors?: number;
    applied?: Array<{ id: string }>;
    resolve?: (id: string) => CustomAgentDefinition | null;
  } = {},
): FlowRunPorts {
  return {
    files,
    invoker,
    resolveAgent: options.resolve ?? ((id) => (id === NOIR_EDITOR.id ? NOIR_EDITOR : null)),
    searchProject: (query) =>
      Promise.resolve([`“We should go,” she said sadly. (${query}, Scene 3)`]),
    runStoryBuild: () =>
      Promise.resolve({
        errors: options.buildErrors ?? 0,
        warnings: 1,
        lines: ["Build finished."],
      }),
    applyEdits: (edits) => {
      options.applied?.push(...edits.map((held) => ({ id: held.id })));
      return Promise.resolve({ changeSetId: "CHG_0009", applied: edits.length });
    },
  };
}

describe("the tool catalog (§4)", () => {
  it("names only tools that actually exist in the runtime", () => {
    const real = new Set<string>([
      ...READ_ONLY_TOOL_NAMES,
      ...BUILD_TOOL_NAMES,
      ...PLAN_TOOL_NAMES,
      ...RESEARCH_TOOL_NAMES,
      ...TEST_TOOL_NAMES,
      ...DEBUG_TOOL_NAMES,
      ...REFACTOR_TOOL_NAMES,
      "list_branches",
      "compare_branches",
    ]);
    for (const group of CORE_CATALOG) {
      for (const tool of group.tools) expect(real.has(tool.name), tool.name).toBe(true);
    }
  });

  it("groups semantically and folds plugin tools in behind their permission (§23)", () => {
    expect(CORE_CATALOG.length).toBeGreaterThan(3);
    const catalog = toolCatalog([
      {
        name: "writing_statistics",
        title: "Writing statistics",
        pluginId: "com.manu.ws",
        pluginName: "Writing Statistics",
      },
    ]);
    const group = catalog.find((held) => held.id === "plugin:com.manu.ws");
    expect(group?.tools[0]?.name).toBe("plugin:com.manu.ws:writing_statistics");
    expect(group?.tools[0]?.permission).toBe("use_external_services");
  });
});

describe("validation before activation (§24)", () => {
  it("accepts the Noir Dialogue Editor", () => {
    expect(validateAgent(NOIR_EDITOR, CONTEXT)).toEqual([]);
  });

  it("names a missing tool, a permission mismatch and an unusable pin", () => {
    const broken: CustomAgentDefinition = {
      ...NOIR_EDITOR,
      tools: [...NOIR_EDITOR.tools, "does_not_exist", "create_research_item"],
      model: { kind: "pinned", modelId: "gpt-imaginary" },
    };
    const problems = validateAgent(broken, CONTEXT);
    expect(problems.some((held) => held.includes("does_not_exist"))).toBe(true);
    expect(problems.some((held) => held.includes("run research"))).toBe(true);
    expect(problems.some((held) => held.includes("gpt-imaginary"))).toBe(true);
  });

  it("flags a mutating permission no chosen tool uses", () => {
    const wide: CustomAgentDefinition = {
      ...NOIR_EDITOR,
      permissions: [...NOIR_EDITOR.permissions, "delete_entities"],
    };
    expect(validateAgent(wide, CONTEXT).some((held) => held.includes("delete entities"))).toBe(
      true,
    );
  });

  it("accepts the Noir Dialogue Pass and every shipped template", () => {
    expect(validateFlow(NOIR_PASS, CONTEXT)).toEqual([]);
    for (const template of FLOW_TEMPLATES) {
      expect(validateFlow(template, CONTEXT), template.id).toEqual([]);
    }
  });

  it("refuses a missing agent, a mutating tool, a nested branch and apply-without-approval", () => {
    const broken: FlowDefinition = {
      ...NOIR_PASS,
      steps: [
        { kind: "run_agent", id: "a", title: "Ghost", agent: "nobody", instruction: "x" },
        { kind: "run_tool", id: "b", title: "Sneaky write", tool: "create_scene_plan" },
        { kind: "apply_staged_changes", id: "c", title: "Apply early" },
        {
          kind: "branch",
          id: "d",
          title: "Nested",
          condition: { measure: "findings", comparison: "greater_than", value: 0 },
          then: [
            {
              kind: "branch",
              id: "e",
              title: "Inner",
              condition: { measure: "findings", comparison: "equals", value: 0 },
              then: [],
              otherwise: [],
            },
          ],
          otherwise: [],
        },
      ],
    };
    const problems = validateFlow(broken, CONTEXT);
    expect(problems.some((held) => held.includes("nobody"))).toBe(true);
    expect(problems.some((held) => held.includes("Apply staged changes"))).toBe(true);
    expect(problems.some((held) => held.includes("no approval gate"))).toBe(true);
    expect(problems.some((held) => held.includes("nests a branch"))).toBe(true);
  });
});

describe("the permission summary (§5)", () => {
  it("states can and cannot in prose", () => {
    const summary = permissionSummary(NOIR_EDITOR, CORE_CATALOG);
    expect(summary.can).toContain("Read the manuscript");
    expect(summary.can.some((held) => held.includes("never applied by itself"))).toBe(true);
    expect(summary.cannot).toContain("Modify the manuscript");
    expect(summary.cannot).toContain("Delete anything from the story record");
    expect(summary.cannot).toContain("Run Story Refactor changes");
  });
});

describe("scoped storage with revisions (§9, §25)", () => {
  it("saves, reloads, bumps revisions and keeps history", async () => {
    const files = memoryFiles();
    const store = new BuilderStore(files, "project");
    const first = await store.saveAgent(NOIR_EDITOR);
    expect(first.revision).toBe(1);
    const second = await store.saveAgent({ ...first, instructions: "Sharper still." });
    expect(second.revision).toBe(2);
    expect(await store.history("agents", NOIR_EDITOR.id)).toEqual([1]);
    const old = await store.revision("agents", NOIR_EDITOR.id, 1);
    expect(old).toContain("earns its place");

    await store.saveFlow(NOIR_PASS);
    const loaded = await store.load();
    expect(loaded.agents[0]?.instructions).toBe("Sharper still.");
    expect(loaded.flows[0]?.id).toBe("noir-dialogue-pass");
    expect(loaded.problems).toEqual([]);
  });

  it("reports an unreadable file instead of dropping it silently", async () => {
    const files = memoryFiles();
    files.map.set(".writer/studio/agents/broken.json", "{nope");
    const loaded = await new BuilderStore(files, "project").load();
    expect(loaded.problems[0]?.reason).toContain("not valid JSON");
  });

  it("removal renames rather than destroys", async () => {
    const files = memoryFiles();
    const store = new BuilderStore(files, "project");
    await store.saveAgent(NOIR_EDITOR);
    await store.remove("agents", NOIR_EDITOR.id);
    expect(files.map.get(`.writer/studio/agents/${NOIR_EDITOR.id}.json.removed`)).toContain(
      "Noir Dialogue Editor",
    );
    expect((await store.load()).agents).toHaveLength(0);
  });
});

describe("shareable packages (§10, §26)", () => {
  it("round-trips an agent and a flow with marketplace metadata", () => {
    const packed = exportAgentPackage(NOIR_EDITOR);
    const parsed = JSON.parse(packed) as Record<string, unknown>;
    expect(parsed["kind"]).toBe("manu-agent");
    expect(parsed["version"]).toBe(1);
    expect(parsed["permissions"]).toEqual(["read_manuscript", "read_canon"]);
    const back = importPackage(packed);
    expect(back.agent?.name).toBe("Noir Dialogue Editor");
    expect(back.agent?.tools).toEqual(NOIR_EDITOR.tools);

    const flowPack = JSON.parse(exportFlowPackage(NOIR_PASS)) as Record<string, unknown>;
    expect((flowPack["dependencies"] as { agents: string[] }).agents).toContain(
      "noir-dialogue-editor",
    );
    const flowBack = importPackage(exportFlowPackage(NOIR_PASS));
    expect(flowBack.flow?.steps).toHaveLength(8);
  });

  it("refuses anything that looks like a credential (§10)", () => {
    expect(() => importPackage('{"apiKey": "abc"}')).toThrow(/credential/);
    expect(() =>
      importPackage(
        `{"definition": {"id": "x", "name": "X", "note": "sk-abcdefghijklmnopqrstuvwx"}}`,
      ),
    ).toThrow(/credential/);
    expect(() =>
      parseAgentDefinition('{"id": "x", "name": "X", "token": "y"}', "file", "project"),
    ).toThrow(/credential/);
  });
});

describe("the test sandbox (§8)", () => {
  const project = {
    chapters: () =>
      Promise.resolve([{ title: "Chapter Three", text: "“We should go,” she said sadly." }]),
    characters: () => Promise.resolve(["Mara", "Elias"]),
    authorVoice: () => Promise.resolve("Spare. Concrete nouns."),
  };

  it("shows context, tools, result and proposed mutations without applying anything", async () => {
    const invoker = fakeInvoker();
    const result = await testAgent(NOIR_EDITOR, { project, invoker });
    expect(result.contextUsed).toEqual([
      "Current chapter: Chapter Three",
      "Characters present",
      "Author Voice",
    ]);
    expect(result.toolsAllowed).toEqual(NOIR_EDITOR.tools);
    expect(result.notes).toHaveLength(1);
    expect(result.proposedMutations).toHaveLength(1);
    expect(result.skipped).toBeUndefined();
  });

  it("skips with a stated reason when no model is configured", async () => {
    const result = await testAgent(NOIR_EDITOR, { project, invoker: null });
    expect(result.skipped).toContain("not passed");
    expect(result.proposedMutations).toEqual([]);
  });
});

describe("the flow runner (§12–§18)", () => {
  it("retries a model step within bounds, never beyond (§16)", async () => {
    const files = memoryFiles();
    const invoker = fakeInvoker();
    invoker.failuresLeft = 1;
    const runner = new FlowRunner(ports(files, invoker));
    const run = await runner.start(
      { ...NOIR_PASS, steps: NOIR_PASS.steps.slice(0, 2), output: "report" },
      { chapter: "Chapter Three" },
    );
    expect(run.status).toBe("finished");
    expect(run.steps[1]?.attempts).toBe(2);

    invoker.failuresLeft = 99;
    const failed = await runner.start(
      { ...NOIR_PASS, steps: NOIR_PASS.steps.slice(0, 2), output: "report" },
      { chapter: "Chapter Three" },
    );
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("after 2 attempt(s)");
  });

  it("branches on deterministic measures (§14)", async () => {
    const template = FLOW_TEMPLATES.find((held) => held.id === "continuity-pass");
    if (template === undefined) throw new Error("template missing");
    const clean = await new FlowRunner(ports(memoryFiles(), fakeInvoker())).start(template, {});
    expect(clean.steps.some((held) => held.id === "diagnose")).toBe(false);
    expect(clean.status).toBe("finished");

    const dirty = await new FlowRunner(
      ports(memoryFiles(), fakeInvoker(), { buildErrors: 2 }),
    ).start(template, {});
    expect(dirty.steps.find((held) => held.id === "diagnose")?.status).toBe("done");
  });

  it("skips agent steps with a stated reason when no model is configured", async () => {
    const run = await new FlowRunner(ports(memoryFiles(), null)).start(
      { ...NOIR_PASS, steps: NOIR_PASS.steps.slice(0, 2), output: "report" },
      { chapter: "Chapter Three" },
    );
    expect(run.status).toBe("finished");
    expect(run.steps[1]?.status).toBe("skipped");
    expect(run.steps[1]?.summary).toContain("not passed");
  });

  it("refuses to apply staged changes without an approval gate, even at runtime", async () => {
    const rogue: FlowDefinition = {
      ...NOIR_PASS,
      steps: [{ kind: "apply_staged_changes", id: "x", title: "Apply" }],
    };
    const run = await new FlowRunner(ports(memoryFiles(), fakeInvoker())).start(rogue, {
      chapter: "Chapter Three",
    });
    expect(run.status).toBe("failed");
    expect(run.error).toContain("no approval");
  });

  it("a rejected gate applies nothing", async () => {
    const files = memoryFiles();
    const applied: Array<{ id: string }> = [];
    const runner = new FlowRunner(ports(files, fakeInvoker(), { applied }));
    const paused = await runner.start(NOIR_PASS, { chapter: "Chapter Three" });
    expect(paused.status).toBe("awaiting_approval");
    const rejected = await runner.reject(paused.id);
    expect(rejected.status).toBe("rejected");
    expect(applied).toHaveLength(0);
  });
});

describe("§27 — the acceptance scenario", () => {
  it("runs the Noir Dialogue Pass end to end, honouring permissions, approval and restarts", async () => {
    const files = memoryFiles();
    const store = new BuilderStore(files, "project");

    // 1. The writer creates the agent and the skill through the product —
    //    validated, then saved. No source code anywhere.
    expect(validateAgent(NOIR_EDITOR, CONTEXT)).toEqual([]);
    expect(validateFlow(NOIR_PASS, CONTEXT)).toEqual([]);
    const savedAgent = await store.saveAgent(NOIR_EDITOR);
    const savedFlow = await store.saveFlow(NOIR_PASS);

    // 2. The run: search → custom agent → voice comparison → proposals →
    //    approval gate. The run pauses; nothing has been applied.
    const applied: Array<{ id: string }> = [];
    const invoker = fakeInvoker();
    const runner = new FlowRunner(
      ports(files, invoker, {
        applied,
        resolve: (id) => (id === savedAgent.id ? savedAgent : null),
      }),
    );
    const paused = await runner.start(savedFlow, { chapter: "Chapter Three" });
    expect(paused.status).toBe("awaiting_approval");
    expect(paused.approval?.question).toContain("noir edits");
    expect(paused.proposals.length).toBeGreaterThanOrEqual(2);
    expect(applied).toHaveLength(0); // Permissions honoured: nothing wrote.

    // 3. Restart persistence: a fresh runner over the same project files —
    //    as after closing and reopening Manu — resumes from disk alone.
    const reopened = new FlowRunner(
      ports(files, invoker, {
        applied,
        resolve: (id) => (id === savedAgent.id ? savedAgent : null),
      }),
    );
    const reloaded = await reopened.get(paused.id);
    expect(reloaded.status).toBe("awaiting_approval");
    expect(reloaded.flowRevision).toBe(savedFlow.revision);
    expect(reloaded.agentsUsed).toEqual([{ id: savedAgent.id, revision: savedAgent.revision }]);

    // 4. The writer accepts one proposal of the staged set; only that one is
    //    applied, then the Story Build re-runs and the report lands.
    const first = reloaded.proposals[0];
    if (first === undefined) throw new Error("no proposals staged");
    const finished = await reopened.approve(paused.id, [first.id]);
    expect(finished.status).toBe("finished");
    expect(applied.map((held) => held.id)).toEqual([first.id]);
    expect(finished.changeSetId).toBe("CHG_0009");
    expect(finished.steps.find((held) => held.id === "s7")?.summary).toContain("Story Build");
    expect(finished.report?.lines.length).toBeGreaterThan(0);

    // 5. Export/import: the agent travels as a package, no credentials in it.
    const packed = exportAgentPackage(savedAgent);
    expect(packed).not.toMatch(/sk-|api[_-]?key|token/i);
    const imported = importPackage(packed);
    expect(imported.agent?.instructions).toBe(savedAgent.instructions);
  });
});
