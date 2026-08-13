import { describe, expect, it } from "vitest";
import { ToolExecutor } from "../executor";
import { checkPermission } from "../permissions";
import type { AgentStore } from "../ports";
import { objectSchema } from "../schema";
import { ToolRegistry, type RegisteredTool } from "../tool";
import {
  AGENTS,
  SPECIALIST_IDS,
  agentById,
  canEdit,
  grantFor,
  recommendSpecialist,
} from "./registry";

/**
 * The claim this phase has to earn is that specialists differ because their
 * tools, permissions, context and output differ — not because they were handed
 * different role prompts. These tests are that claim, checked.
 */
describe("specialists differ in configuration, not in prompt", () => {
  it("registers every declared specialist exactly once", () => {
    expect(AGENTS.map((a) => a.id).sort()).toEqual([...SPECIALIST_IDS].sort());
    expect(new Set(AGENTS.map((a) => a.id)).size).toBe(AGENTS.length);
  });

  it("gives no two specialists the same tool surface", () => {
    const surfaces = AGENTS.map((a) => [...a.tools].sort().join(","));
    expect(new Set(surfaces).size).toBe(AGENTS.length);
  });

  it("gives no two specialists the same output shape", () => {
    expect(new Set(AGENTS.map((a) => a.outputShape)).size).toBe(AGENTS.length);
  });

  it("varies the context recipe by the kind of work", () => {
    // Structural specialists read a chapter; scene specialists read a scene;
    // the copy editor needs no story context at all.
    expect(agentById("story_architect").contextRecipe).toBe("chapter_inspection");
    expect(agentById("developmental_editor").contextRecipe).toBe("chapter_inspection");
    expect(agentById("scene_director").contextRecipe).toBe("scene_inspection");
    expect(agentById("drafter").contextRecipe).toBe("scene_rewrite");
    expect(agentById("copy_editor").contextRecipe).toBeNull();
  });

  it("varies the model class by the kind of work", () => {
    expect(agentById("story_architect").modelClass).toBe("reasoning");
    expect(agentById("drafter").modelClass).toBe("drafting");
    expect(agentById("copy_editor").modelClass).toBe("fast");
  });

  it("says what each specialist does not do", () => {
    for (const agent of AGENTS) {
      expect(agent.outOfScope.length).toBeGreaterThan(0);
      expect(agent.responsibilities.length).toBeGreaterThan(0);
    }
  });
});

describe("the runtime enforces the differences", () => {
  const refactorTool = { name: "analyse_story_refactor", permission: "read_canon" } as const;
  const buildTool = { name: "run_story_build", permission: "read_canon" } as const;

  it("denies the Copy Editor the refactor analyser", () => {
    const copy = agentById("copy_editor");
    expect(copy.tools).not.toContain("analyse_story_refactor");

    // Not merely absent from a list: the executor's own check refuses it.
    const decision = checkPermission(refactorTool, grantFor(copy));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toMatch(/not in this task's allowed tools/i);
    }
  });

  it("denies the Copy Editor the Story Build too", () => {
    expect(checkPermission(buildTool, grantFor(agentById("copy_editor"))).allowed).toBe(false);
  });

  it("allows the Story Architect exactly what the Copy Editor is denied", () => {
    expect(checkPermission(refactorTool, grantFor(agentById("story_architect"))).allowed).toBe(
      true,
    );
  });

  it("gives the Continuity Editor the checking surface and nobody else all of it", () => {
    const continuity = agentById("continuity_editor");
    for (const tool of ["run_story_build", "run_story_tests", "run_story_debug"]) {
      expect(continuity.tools).toContain(tool);
    }
    const othersWithAll = AGENTS.filter(
      (a) =>
        a.id !== "continuity_editor" &&
        ["run_story_build", "run_story_tests", "run_story_debug"].every((t) => a.tools.includes(t)),
    );
    expect(othersWithAll).toHaveLength(0);
  });

  it("lets only the specialists that write hold edit_manuscript", () => {
    const writers = AGENTS.filter(canEdit)
      .map((a) => a.id)
      .sort();
    expect(writers).toEqual(["copy_editor", "dialogue_editor", "drafter", "prose_editor"]);
  });

  it("keeps every read-only specialist genuinely read-only", () => {
    for (const agent of AGENTS.filter((a) => !canEdit(a))) {
      expect(agent.permissions).not.toContain("edit_manuscript");
      expect(agent.permissions).not.toContain("delete_entities");
      expect(agent.permissions).not.toContain("apply_refactors");
    }
  });

  it("grants no specialist a destructive permission", () => {
    // Nothing in this registry may delete entities or apply a refactor: those
    // stay with the writer (docs/STORY_REFACTOR.md).
    for (const agent of AGENTS) {
      expect(agent.permissions).not.toContain("delete_entities");
      expect(agent.permissions).not.toContain("apply_refactors");
    }
  });

  it("never grants a tool outside the specialist's own list", () => {
    for (const agent of AGENTS) {
      const grant = grantFor(agent);
      const foreign = { name: "get_scenes_by_location", permission: "read_canon" } as const;
      const expected = agent.tools.includes(foreign.name);
      expect(checkPermission(foreign, grant).allowed).toBe(expected);
    }
  });
});

describe("the model sees a different toolbox per specialist", () => {
  // Every tool any specialist names, stubbed. The handlers are never reached:
  // what is under test is which of them are offered at all.
  const stub = (name: string): RegisteredTool => ({
    name,
    description: name,
    inputSchema: objectSchema<Record<string, never>>(name, {}),
    outputSchema: objectSchema<Record<string, never>>(`${name}_result`, {}),
    permission: "read_canon",
    handler: () => Promise.resolve({}),
  });
  const registry = new ToolRegistry().register(
    ...[...new Set(AGENTS.flatMap((a) => a.tools))].map(stub),
  );
  const store = {
    appendActivity: (event: unknown) => Promise.resolve({ ...(event as object), id: "ACT_0001" }),
  } as unknown as AgentStore;

  it("offers each specialist exactly its own tools and no others", () => {
    for (const agent of AGENTS) {
      const executor = new ToolExecutor({ registry, grant: grantFor(agent), store });
      const offered = executor
        .describeAvailableTools()
        .map((tool) => tool.name)
        .sort();
      expect(offered).toEqual([...agent.tools].sort());
    }
  });

  it("never even shows the Copy Editor the tools the Story Architect works with", () => {
    const copy = new ToolExecutor({
      registry,
      grant: grantFor(agentById("copy_editor")),
      store,
    }).describeAvailableTools();
    expect(copy.map((t) => t.name)).not.toContain("analyse_story_refactor");
    expect(copy).toHaveLength(3);
  });
});

describe("shared canon", () => {
  it("no specialist may create a branch, so none can fork canon behind the writer", () => {
    for (const agent of AGENTS) {
      expect(agent.permissions).not.toContain("create_branches");
      expect(agent.tools).not.toContain("create_branch");
      expect(agent.tools).not.toContain("switch_branch");
    }
  });
});

describe("recommending a specialist", () => {
  it("routes a request to the specialist whose work it is", () => {
    expect(recommendSpecialist("there are typos in chapter four")?.id).toBe("copy_editor");
    expect(recommendSpecialist("this dialogue explains its own subtext")?.id).toBe(
      "dialogue_editor",
    );
    expect(recommendSpecialist("the timeline contradicts itself")?.id).toBe("continuity_editor");
    expect(recommendSpecialist("why would Marcus do that, it is out of character")?.id).toBe(
      "character_editor",
    );
    expect(recommendSpecialist("the setup in act one never pays off")?.id).toBe("story_architect");
  });

  it("recommends nobody rather than guessing", () => {
    expect(recommendSpecialist("hello")).toBeNull();
    expect(recommendSpecialist("")).toBeNull();
  });

  it("hands off to specialists that exist", () => {
    for (const agent of AGENTS) {
      for (const id of agent.handsOffTo) {
        expect(() => agentById(id)).not.toThrow();
        expect(id).not.toBe(agent.id);
      }
    }
  });
});
