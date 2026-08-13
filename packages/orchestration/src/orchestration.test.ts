import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { StoryRepository } from "@jellytind/story-repository";
import type { WorkflowRun } from "@jellytind/domain";
import { flattenNodes } from "@jellytind/domain";
import { parseArtifact } from "./artifacts";
import { detectDisagreements, mergeReviews, openDisagreements } from "./conflicts";
import { CONDITIONS, validateWorkflowGraph, conditionMap, walkNodes } from "./graph";
import { addCost, describeCost, planCost, route, EMPTY_COST } from "./routing";
import { WorkflowRunner } from "./runner";
import {
  CHAPTER_REVIEW_WORKFLOW,
  CHAPTER_WORKFLOW,
  defineWorkflow,
  workflowById,
} from "./workflows";
import { OrchestrationError, type AgentWorkExecutor, type AgentWorkRequest } from "./types";

/** A project with a chapter to develop and two people in it. */
async function novel() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "The Cellar Door" });

  const mara = await repo.addCharacter({ name: "Mara" });
  const elias = await repo.addCharacter({ name: "Elias" });
  const one = await repo.addChapter({ title: "Openings" });
  const seventeen = await repo.addChapter({ title: "The Cellar" });

  await repo.addScene({
    title: "The hall",
    chapterId: one.id,
    pov: mara.id,
    characterIds: [mara.id, elias.id],
    purpose: ["establish the rift"],
  });
  await repo.writeProjectFile(
    one.filePath,
    `---\nid: ${one.id}\ntitle: ${one.title}\n---\n\nThe hall was colder than she remembered.\n`,
  );
  await repo.writeProjectFile(
    seventeen.filePath,
    `---\nid: ${seventeen.id}\ntitle: ${seventeen.title}\n---\n\n`,
  );

  return { repo, store, mara, elias, one, seventeen };
}

const ROUTING = {
  models: {
    premium_reasoning: "reasoning-model",
    premium_prose: "prose-model",
    cheap_analysis: "small-model",
  },
} as const;

/**
 * A scripted executor.
 *
 * The runner is what is under test, so the specialists are scripted: each
 * returns a payload for its node. Nothing here talks to a provider, which is
 * also how a workflow behaves in a project with no model — except that there,
 * every agent step is skipped instead.
 */
function scripted(
  overrides: Partial<Record<string, unknown>> = {},
  onCall?: (request: AgentWorkRequest) => void,
): AgentWorkExecutor {
  return {
    run(request) {
      onCall?.(request);
      if (Object.prototype.hasOwnProperty.call(overrides, request.nodeId)) {
        const value = overrides[request.nodeId];
        if (value instanceof Error) return Promise.reject(value);
        return Promise.resolve({
          payload: value,
          modelId: "scripted",
          inputTokens: 100,
          outputTokens: 50,
        });
      }
      return Promise.resolve({
        payload: DEFAULT_PAYLOADS[request.produces],
        modelId: "scripted",
        inputTokens: 100,
        outputTokens: 50,
      });
    },
  };
}

const DEFAULT_PAYLOADS: Record<string, unknown> = {
  chapter_brief: {
    chapterId: "CHAPTER_0002",
    premise: "Mara opens the cellar and finds the seal broken from the inside.",
    mustAchieve: ["pay off the brass key", "break the siblings' truce"],
    constraints: ["Elias must not admit anything yet"],
    threads: ["THREAD_0001"],
    risks: ["the reveal lands too early"],
  },
  scene_plan: {
    chapterId: "CHAPTER_0002",
    scenes: [
      {
        title: "The stairs",
        objective: "Get Mara to the cellar door alone",
        conflict: "Elias tries to stop her without saying why",
        beats: ["she takes the key", "he blocks the stair", "she goes anyway"],
        reversal: "he steps aside",
        characterIds: ["CHAR_0001"],
      },
    ],
  },
  draft: {
    chapterId: "CHAPTER_0002",
    prose: "The cellar door stood open, and the cold came up the stairs to meet her.",
  },
  character_notes: {
    notes: [
      {
        target: "SCENE_0002",
        stance: "keep",
        statement: "The hesitation on the stair is the only place Elias shows doubt.",
      },
    ],
  },
  continuity_report: {
    notes: [
      {
        target: "SCENE_0002",
        stance: "flag",
        statement: "Mara should not know the seal is broken yet.",
      },
    ],
  },
  prose_notes: {
    notes: [
      {
        target: "SCENE_0002",
        stance: "cut",
        statement: "The hesitation repeats the paragraph above it.",
      },
    ],
  },
  revision_proposal: {
    changes: [{ target: "SCENE_0002", statement: "Move the reveal one scene later." }],
  },
};

const runnerFor = (
  repo: StoryRepository,
  executor: AgentWorkExecutor | null = null,
  routing: { models: Record<string, string> } = { models: { ...ROUTING.models } },
) => new WorkflowRunner({ repo, runs: repo.workflowRuns, routing, executor });

const statusOf = (run: WorkflowRun, id: string) =>
  flattenNodes(run.nodes).find((node) => node.id === id)?.status;

// ── The graph ───────────────────────────────────────────────────────────────

describe("a workflow is a checked graph, not a prompt chain", () => {
  it("derives the specialists and routing classes from its nodes", () => {
    expect(CHAPTER_WORKFLOW.agents).toContain("story_architect");
    expect(CHAPTER_WORKFLOW.agents).toContain("drafter");
    expect(CHAPTER_WORKFLOW.routingClasses).toContain("premium_prose");
    expect(walkNodes(CHAPTER_WORKFLOW.nodes).length).toBeGreaterThan(CHAPTER_WORKFLOW.nodes.length);
  });

  it("refuses a node that reads an artifact nobody produces", () => {
    expect(() =>
      defineWorkflow({
        id: "broken",
        name: "Broken",
        description: "",
        nodes: [
          {
            kind: "agent",
            id: "draft",
            title: "Draft",
            agent: "drafter",
            instruction: "write",
            reads: ["scene_plan"],
            produces: "draft",
            routingClass: "premium_prose",
          },
        ],
      }),
    ).toThrowError(/reads scene_plan, which no earlier node produces/);
  });

  it("refuses to let a specialist without edit_manuscript produce a draft", () => {
    expect(() =>
      defineWorkflow({
        id: "wrong_agent",
        name: "Wrong",
        description: "",
        nodes: [
          {
            kind: "agent",
            id: "draft",
            title: "Draft",
            agent: "story_architect",
            instruction: "write",
            reads: [],
            produces: "draft",
            routingClass: "premium_prose",
          },
        ],
      }),
    ).toThrowError(/Story Architect does not hold edit_manuscript/);
  });

  it("refuses to write to the manuscript with no checkpoint or approval before it", () => {
    const draftNode = {
      kind: "agent" as const,
      id: "draft",
      title: "Draft",
      agent: "drafter" as const,
      instruction: "write",
      reads: [],
      produces: "draft" as const,
      routingClass: "premium_prose" as const,
    };
    expect(() =>
      defineWorkflow({
        id: "unsafe",
        name: "Unsafe",
        description: "",
        nodes: [draftNode, { kind: "apply", id: "apply", title: "Write", reads: ["draft"] }],
      }),
    ).toThrowError(/no checkpoint before it/);

    expect(() =>
      defineWorkflow({
        id: "unsafe2",
        name: "Unsafe",
        description: "",
        nodes: [
          draftNode,
          { kind: "checkpoint", id: "cp", title: "Checkpoint", label: "before" },
          { kind: "apply", id: "apply", title: "Write", reads: ["draft"] },
        ],
      }),
    ).toThrowError(/no approval gate before it/);
  });

  it("refuses parallel branches that depend on each other", () => {
    expect(() =>
      validateWorkflowGraph(
        {
          id: "x",
          name: "X",
          description: "",
          inputs: [],
          nodes: [
            {
              kind: "parallel",
              id: "review",
              title: "Review",
              branches: [
                {
                  kind: "agent",
                  id: "a",
                  title: "A",
                  agent: "character_editor",
                  instruction: "",
                  reads: [],
                  produces: "character_notes",
                  routingClass: "cheap_analysis",
                },
                {
                  kind: "agent",
                  id: "b",
                  title: "B",
                  agent: "prose_editor",
                  instruction: "",
                  reads: ["character_notes"],
                  produces: "prose_notes",
                  routingClass: "cheap_analysis",
                },
              ],
            },
          ],
        },
        conditionMap(),
      ),
    ).toThrowError(/Parallel branches must be independent/);
  });

  it("refuses a condition it does not have", () => {
    expect(() =>
      defineWorkflow({
        id: "guarded",
        name: "Guarded",
        description: "",
        nodes: [
          {
            kind: "conditional",
            id: "maybe",
            title: "Maybe",
            when: "the_vibes_are_off",
            children: [{ kind: "build", id: "build", title: "Build", produces: "build_result" }],
          },
        ],
      }),
    ).toThrowError(/not a condition Manu has/);
  });

  it("names every condition exactly once", () => {
    expect(new Set(CONDITIONS.map((c) => c.id)).size).toBe(CONDITIONS.length);
  });
});

// ── Handoffs ────────────────────────────────────────────────────────────────

describe("handoffs are structured artifacts", () => {
  it("validates a payload before it can become one", () => {
    expect(() => parseArtifact("scene_plan", { chapterId: "CHAPTER_0002" })).toThrowError(
      /"scenes" must list at least one scene/,
    );
    expect(() => parseArtifact("draft", { chapterId: "CHAPTER_0002", prose: "  " })).toThrowError(
      /"prose" is required/,
    );
  });

  it("keeps a malformed response out of the run entirely", async () => {
    const { repo } = await novel();
    const run = await runnerFor(repo, scripted({ architect: { premise: "no chapter id" } })).start(
      CHAPTER_WORKFLOW,
      "Develop and draft Chapter 17",
      { chapterId: "CHAPTER_0002" },
    );

    expect(run.status).toBe("failed");
    expect(run.failureReason).toMatch(/chapterId" is required/);
    expect(run.artifacts).toHaveLength(0);
  });

  it("counts words for itself rather than trusting what it was told", () => {
    const draft = parseArtifact("draft", {
      chapterId: "CHAPTER_0002",
      prose: "one two three",
      wordCount: 900,
    }) as { wordCount: number };
    expect(draft.wordCount).toBe(3);
  });
});

// ── Disagreement ────────────────────────────────────────────────────────────

describe("when specialists disagree", () => {
  it("finds it structurally: same target, different stance", () => {
    const found = detectDisagreements([
      { agent: "character_editor", notes: [{ target: "SCENE_1", stance: "keep", statement: "a" }] },
      { agent: "prose_editor", notes: [{ target: "SCENE_1", stance: "cut", statement: "b" }] },
      {
        agent: "continuity_editor",
        notes: [{ target: "SCENE_2", stance: "flag", statement: "c" }],
      },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.target).toBe("SCENE_1");
    expect(found[0]?.positions.map((p) => p.agent)).toEqual(["character_editor", "prose_editor"]);
  });

  it("treats agreement as agreement, however many agents hold it", () => {
    expect(
      detectDisagreements([
        { agent: "a", notes: [{ target: "SCENE_1", stance: "revise", statement: "x" }] },
        { agent: "b", notes: [{ target: "SCENE_1", stance: "revise", statement: "y" }] },
      ]),
    ).toEqual([]);
  });

  it("keeps every note when merging — nothing is reconciled away", () => {
    const merged = mergeReviews([
      {
        id: "1",
        kind: "character_notes",
        nodeId: "a",
        producedBy: "character_editor",
        createdAt: "",
        payload: { notes: [{ target: "S", stance: "keep", statement: "keep it" }] },
      },
      {
        id: "2",
        kind: "prose_notes",
        nodeId: "b",
        producedBy: "prose_editor",
        createdAt: "",
        payload: { notes: [{ target: "S", stance: "cut", statement: "cut it" }] },
      },
    ]);
    expect(merged.notes).toHaveLength(2);
    expect(merged.disagreements).toHaveLength(1);
    expect(merged.byAgent).toEqual({ character_editor: 1, prose_editor: 1 });
  });

  it("will not let the writer approve past an unsettled disagreement", async () => {
    const { repo } = await novel();
    const runner = runnerFor(repo, scripted());
    let run = await runner.start(CHAPTER_WORKFLOW, "Develop and draft Chapter 17", {
      chapterId: "CHAPTER_0002",
    });
    run = await runner.approve(run.id, CHAPTER_WORKFLOW, { approved: true });

    expect(run.status).toBe("awaiting_approval");
    expect(run.pending?.nodeId).toBe("approve_draft");
    expect(run.pending?.disagreements.length).toBeGreaterThan(0);

    await expect(runner.approve(run.id, CHAPTER_WORKFLOW, { approved: true })).rejects.toThrowError(
      /Settle them before approving/,
    );
  });

  it("records which position the writer chose, keeping the other", async () => {
    const { repo } = await novel();
    const runner = runnerFor(repo, scripted());
    let run = await runner.start(CHAPTER_WORKFLOW, "Chapter 17", { chapterId: "CHAPTER_0002" });
    run = await runner.approve(run.id, CHAPTER_WORKFLOW, { approved: true });
    run = await runner.approve(run.id, CHAPTER_WORKFLOW, {
      approved: true,
      resolutions: [{ target: "SCENE_0002", chose: "character_editor", note: "the doubt stays" }],
    });

    const settled = run.disagreements[0];
    expect(settled?.resolution?.chose).toBe("character_editor");
    expect(settled?.positions).toHaveLength(3);
    expect(openDisagreements(run.disagreements)).toEqual([]);
  });
});

// ── The acceptance scenario ─────────────────────────────────────────────────

describe("develop and draft a chapter", () => {
  it("completes the whole pipeline with one project state, an audit trail, checkpoints and approvals", async () => {
    const { repo, seventeen } = await novel();
    const lines: string[] = [];
    const runner = runnerFor(repo, scripted());

    let run = await runner.start(
      CHAPTER_WORKFLOW,
      "Develop and draft Chapter 17",
      { chapterId: seventeen.id },
      { onProgress: (event) => lines.push(event.line) },
    );

    // It stops at the plan, before a word is written.
    expect(run.status).toBe("awaiting_approval");
    expect(run.pending?.nodeId).toBe("approve_plan");
    expect(statusOf(run, "draft")).toBe("pending");
    expect(lines.some((line) => line === "✓ Story Architect produced a chapter brief")).toBe(true);

    run = await runner.approve(run.id, CHAPTER_WORKFLOW, { approved: true });

    // …and again before it writes.
    expect(run.status).toBe("awaiting_approval");
    expect(run.pending?.nodeId).toBe("approve_draft");
    expect(run.checkpoints).toHaveLength(1);
    expect(await repo.readProjectFile(seventeen.filePath)).not.toMatch(/cellar door stood open/);

    run = await runner.approve(run.id, CHAPTER_WORKFLOW, {
      approved: true,
      resolutions: [{ target: "SCENE_0002", chose: "character_editor" }],
    });

    expect(run.status).toBe("completed");

    // One project state: the draft reached the manuscript, once, as a change set.
    expect(await repo.readProjectFile(seventeen.filePath)).toMatch(/cellar door stood open/);
    expect(run.changeSets).toHaveLength(1);
    const changes = await repo.listChangeSets();
    expect(changes.some((change) => change.id === run.changeSets[0])).toBe(true);

    // Checkpoints: the whole thing is revertible.
    const checkpoints = await repo.listCheckpoints();
    expect(checkpoints.some((checkpoint) => checkpoint.id === run.checkpoints[0])).toBe(true);

    // Structured handoffs, one per producing step.
    expect(run.artifacts.map((artifact) => artifact.kind)).toEqual([
      "chapter_brief",
      "scene_plan",
      "draft",
      "character_notes",
      "continuity_report",
      "prose_notes",
      "merged_review",
      "build_result",
    ]);

    // An audit trail in the ordinary agent activity log.
    const taskId = run.inputs.taskId as string;
    const activity = await repo.agents.listActivity(taskId);
    expect(activity.length).toBeGreaterThanOrEqual(run.nodes.length - 1);
    expect(activity.some((event) => event.tool === "chapter_development.apply")).toBe(true);
    expect((await repo.agents.getTask(taskId))?.status).toBe("completed");
  });

  it("runs the three reviews in parallel and records each", async () => {
    const { repo, seventeen } = await novel();
    const runner = runnerFor(repo, scripted());
    let run = await runner.start(CHAPTER_WORKFLOW, "Chapter 17", { chapterId: seventeen.id });
    run = await runner.approve(run.id, CHAPTER_WORKFLOW, { approved: true });

    const review = run.nodes.find((node) => node.id === "review");
    expect(review?.children?.map((child) => child.id)).toEqual([
      "character_review",
      "continuity_review",
      "prose_review",
    ]);
    expect(review?.children?.every((child) => child.status === "ok")).toBe(true);
    expect(review?.summary).toBe("3 of 3 analyses ran");
  });

  it("writes nothing when the writer declines", async () => {
    const { repo, seventeen } = await novel();
    const before = await repo.readProjectFile(seventeen.filePath);
    const runner = runnerFor(repo, scripted());
    let run = await runner.start(CHAPTER_WORKFLOW, "Chapter 17", { chapterId: seventeen.id });
    run = await runner.approve(run.id, CHAPTER_WORKFLOW, {
      approved: false,
      note: "the premise is wrong",
    });

    expect(run.status).toBe("rejected");
    expect(run.changeSets).toEqual([]);
    expect(await repo.readProjectFile(seventeen.filePath)).toBe(before);
    expect(statusOf(run, "approve_plan")).toBe("skipped");
    expect(statusOf(run, "draft")).toBe("pending");
  });

  it("skips the guarded diagnosis when the build is clean", async () => {
    const { repo, seventeen } = await novel();
    const runner = runnerFor(repo, scripted());
    let run = await runner.start(CHAPTER_WORKFLOW, "Chapter 17", { chapterId: seventeen.id });
    run = await runner.approve(run.id, CHAPTER_WORKFLOW, { approved: true });
    run = await runner.approve(run.id, CHAPTER_WORKFLOW, {
      approved: true,
      resolutions: [{ target: "SCENE_0002", chose: "prose_editor" }],
    });

    expect(statusOf(run, "diagnose")).toBe("skipped");
    expect(flattenNodes(run.nodes).find((node) => node.id === "diagnose")?.reason).toMatch(
      /"build_has_errors" did not hold/,
    );
  });
});

// ── Failure, retry and resumption ───────────────────────────────────────────

describe("failure", () => {
  it("retries a step that declares attempts, and says how many it took", async () => {
    const { repo, seventeen } = await novel();
    let attempts = 0;
    const executor: AgentWorkExecutor = {
      run(request) {
        if (request.nodeId === "draft") {
          attempts += 1;
          if (attempts === 1) return Promise.reject(new Error("the provider hung up"));
        }
        return Promise.resolve({
          payload: DEFAULT_PAYLOADS[request.produces],
          modelId: "scripted",
        });
      },
    };

    const runner = runnerFor(repo, executor);
    let run = await runner.start(CHAPTER_WORKFLOW, "Chapter 17", { chapterId: seventeen.id });
    run = await runner.approve(run.id, CHAPTER_WORKFLOW, { approved: true });

    expect(attempts).toBe(2);
    expect(statusOf(run, "draft")).toBe("ok");
    expect(flattenNodes(run.nodes).find((node) => node.id === "draft")?.attempts).toBe(2);
  });

  it("keeps everything earlier steps produced, and resumes from the one that failed", async () => {
    const { repo, seventeen, store } = await novel();
    const failing = runnerFor(repo, scripted({ draft: new Error("the provider hung up") }));
    let run = await failing.start(CHAPTER_WORKFLOW, "Chapter 17", { chapterId: seventeen.id });
    run = await failing.approve(run.id, CHAPTER_WORKFLOW, { approved: true });

    expect(run.status).toBe("failed");
    expect(statusOf(run, "draft")).toBe("failed");
    expect(run.artifacts.map((artifact) => artifact.kind)).toEqual(["chapter_brief", "scene_plan"]);

    // A new repository over the same files: the app was closed and reopened.
    const reopened = await StoryRepository.openProject({ store });
    const resumed = await runnerFor(reopened, scripted()).resume(run.id, CHAPTER_WORKFLOW);

    expect(resumed.status).toBe("awaiting_approval");
    expect(resumed.pending?.nodeId).toBe("approve_draft");
    expect(resumed.resumeCount).toBe(2);
    // The brief was not produced a second time.
    expect(resumed.artifacts.filter((a) => a.kind === "chapter_brief")).toHaveLength(1);
  });

  it("will not resume a run that is waiting for the writer", async () => {
    const { repo, seventeen } = await novel();
    const runner = runnerFor(repo, scripted());
    const run = await runner.start(CHAPTER_WORKFLOW, "Chapter 17", { chapterId: seventeen.id });
    await expect(runner.resume(run.id, CHAPTER_WORKFLOW)).rejects.toThrowError(
      /waiting for your approval/,
    );
  });

  it("needs its declared input before anything runs", async () => {
    const { repo } = await novel();
    await expect(
      runnerFor(repo, scripted()).start(CHAPTER_WORKFLOW, "Chapter 17"),
    ).rejects.toThrowError(/needs Chapter/);
  });
});

// ── No model configured ─────────────────────────────────────────────────────

describe("with no model configured", () => {
  it("skips every agent step with a stated reason and still runs the deterministic ones", async () => {
    const { repo, seventeen } = await novel();
    const runner = runnerFor(repo, null);
    let run = await runner.start(CHAPTER_REVIEW_WORKFLOW, "Review 17", { chapterId: seventeen.id });

    expect(statusOf(run, "build")).toBe("ok");
    expect(statusOf(run, "brief")).toBe("skipped");
    expect(flattenNodes(run.nodes).find((node) => node.id === "brief")?.reason).toMatch(
      /no agent executor is configured/,
    );
    expect(run.status).toBe("awaiting_approval");

    run = await runner.approve(run.id, CHAPTER_REVIEW_WORKFLOW, { approved: true });
    expect(run.status).toBe("completed");
    expect(run.cost.calls).toBe(0);
  });

  it("skips a step whose routing class has no model, naming the class", async () => {
    const { repo, seventeen } = await novel();
    const runner = runnerFor(repo, scripted(), {
      models: { premium_reasoning: "reasoning-model" },
    });
    const run = await runner.start(CHAPTER_REVIEW_WORKFLOW, "Review 17", {
      chapterId: seventeen.id,
    });

    expect(statusOf(run, "brief")).toBe("ok");
    expect(statusOf(run, "character_review")).toBe("skipped");
    expect(flattenNodes(run.nodes).find((node) => node.id === "character_review")?.reason).toMatch(
      /no model is configured for cheap analysis/,
    );
  });
});

// ── Cost ────────────────────────────────────────────────────────────────────

describe("cost is counted, never invented", () => {
  it("plans what a workflow will ask for before it runs", () => {
    const plan = planCost(CHAPTER_WORKFLOW);
    expect(plan.premium_prose).toBe(1);
    expect(plan.cheap_analysis).toBe(3);
    expect(plan.premium_reasoning).toBe(3);
  });

  it("records calls and tokens per class, and no money", async () => {
    const { repo, seventeen } = await novel();
    const runner = runnerFor(repo, scripted());
    let run = await runner.start(CHAPTER_WORKFLOW, "Chapter 17", { chapterId: seventeen.id });
    run = await runner.approve(run.id, CHAPTER_WORKFLOW, { approved: true });

    expect(run.cost.byClass.premium_prose?.calls).toBe(1);
    expect(run.cost.byClass.cheap_analysis?.calls).toBe(3);
    expect(run.cost.inputTokens).toBe(600);
    expect(describeCost(run.cost)).toMatch(/6 model call\(s\)/);
    expect(describeCost(run.cost)).not.toMatch(/[$£€]/);
  });

  it("routes a class to a model, and says so when it cannot", () => {
    expect(route({ models: { premium_prose: "p" } }, "premium_prose").modelId).toBe("p");
    expect(route({ models: {} }, "premium_prose").unavailable).toMatch(/premium prose/);
    // Metadata is answered by the project, so it is never unavailable.
    expect(route({ models: {} }, "local_metadata").unavailable).toBeUndefined();
  });

  it("adds usage without losing what was already counted", () => {
    const once = addCost(EMPTY_COST, "cheap_analysis", { inputTokens: 10, outputTokens: 5 });
    const twice = addCost(once, "cheap_analysis", { inputTokens: 10, outputTokens: 5 });
    expect(twice.byClass.cheap_analysis).toEqual({ calls: 2, inputTokens: 20, outputTokens: 10 });
  });
});

// ── Registry ────────────────────────────────────────────────────────────────

describe("the workflow registry", () => {
  it("finds a workflow by id and refuses one it does not have", () => {
    expect(workflowById("chapter_development").name).toBe("Chapter Development");
    expect(() => workflowById("write_my_book")).toThrowError(/No workflow with id/);
  });

  it("carries a machine-readable code on every failure", () => {
    expect(new OrchestrationError("unknown_workflow", "nope").code).toBe("unknown_workflow");
  });
});
