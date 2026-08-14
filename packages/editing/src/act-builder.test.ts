import { describe, expect, it } from "vitest";
import type { PermissionGrant } from "@jellytind/agent-runtime";
import { InMemoryProjectStore } from "@jellytind/persistence";
import {
  MockLanguageModel,
  ModelError,
  type GenerateRequest,
  type LanguageModel,
  type RequestOptions,
  type StructuredRequest,
} from "@jellytind/model-router";
import { StoryRepository, openBranch } from "@jellytind/story-repository";
import type { ActPlan, ActThreadGoal, PlannedScene } from "@jellytind/domain";
import { emptyPlannedScene } from "@jellytind/domain";
import { ActBuilder } from "./act-builder";
import { EditError } from "./types";

const GRANT: PermissionGrant = {
  permissions: [
    "read_manuscript",
    "read_canon",
    "edit_manuscript",
    "edit_story_state",
    "edit_plans",
  ],
};

/** The scripted-model pattern from the chapter-builder suite. */
class ScriptedModel implements LanguageModel {
  readonly id = "mock:scripted";
  readonly capabilities = { streaming: true, structuredOutput: true, tools: true };
  readonly requests: string[] = [];
  private readonly fallback = new MockLanguageModel({ structured: { text: "…", rationale: "" } });

  constructor(private readonly respond: (prompt: string, calls: number) => unknown) {}

  generateText(request: GenerateRequest, options?: RequestOptions) {
    return this.fallback.generateText(request, options);
  }
  streamText(request: GenerateRequest, options?: RequestOptions) {
    return this.fallback.streamText(request, options);
  }
  runWithTools(request: never, options?: RequestOptions) {
    return this.fallback.runWithTools(request, options);
  }
  generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
    const prompt = request.messages.map((m) => String(m.content)).join("\n");
    this.requests.push(prompt);
    return Promise.resolve(request.schema.parse(this.respond(prompt, this.requests.length)));
  }
}

function draftsByScene(prompt: string): unknown {
  const scene =
    /Write the prose for (SCENE_\d+)/.exec(prompt)?.[1] ?? /SCENE_\d+/.exec(prompt)?.[0] ?? "?";
  return {
    text: `Prose for ${scene}. The chapter moved the act forward, sentence by sentence, from the state the previous chapters actually left.`,
    rationale: "drafted",
    warnings: [],
  };
}

function coverageAllMet(prompt: string): unknown {
  const beats = [...prompt.matchAll(/^- (.+)$/gm)].map((m) => m[1] ?? "");
  return { beats: beats.map((beat) => ({ beat, met: true, note: "shown" })) };
}

const NO_TRANSITIONS = { transitions: [] };

/** A fixed structured plan proposal, for the planning model. */
function planProposal(): unknown {
  return {
    objective: "proposed by the architect",
    scenes: [
      {
        title: "Proposed scene",
        characterIds: [],
        objectIds: [],
        beats: ["The proposed beat happens on the page"],
        revelations: [],
        knowledgeChanges: [],
        plotThreadIds: [],
        setupIds: [],
        payoffSetupIds: [],
        requiredFactIds: [],
      },
    ],
    forbiddenFacts: [],
    constraints: [],
    notes: [],
  };
}

/**
 * The §19 fixture: an act of chapters (one scene each), two plot threads, a
 * relationship, a knowledge constraint and a setup/payoff pair, with an
 * approved act plan carrying goals of every kind.
 */
async function actTwo(chapterCount = 5) {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "The Vault" });
  const mara = await repo.addCharacter({ name: "Mara", role: "protagonist" });
  const elias = await repo.addCharacter({ name: "Elias", role: "foil" });
  const manor = await repo.addLocation({ name: "Blackthorn Manor" });
  const rel = await repo.addRelationship({
    characterAId: mara.id,
    characterBId: elias.id,
    type: "allies",
  });
  const photograph = await repo.addPlotThread({ name: "The missing photograph" });
  const vault = await repo.addPlotThread({ name: "The vault investigation" });
  const keyFact = await repo.addFact({
    statement: "The cellar key opens the vault",
    objectiveTruth: true,
  });
  const killerFact = await repo.addFact({
    statement: "The killer is Marcus",
    objectiveTruth: true,
  });

  const titles = ["Arrival", "Pressure", "Discovery", "Fracture", "Collapse"].slice(
    0,
    chapterCount,
  );
  const chapters = [];
  const scenes = [];
  for (const [index, title] of titles.entries()) {
    const chapter = await repo.addChapter({ title, status: "outline" });
    chapters.push(chapter);
    scenes.push(
      await repo.addScene({
        title: `${title} scene`,
        chapterId: chapter.id,
        pov: mara.id,
        locationId: manor.id,
        characterIds: [mara.id, elias.id],
        // The photograph thread is touched in chapters 1 and 3 — the "advances
        // twice" goal is a count of exactly this.
        plotThreadIds: index === 0 || index === 2 ? [photograph.id] : [vault.id],
        purpose: [`${title} happens on the page`],
        status: "planned",
      }),
    );
  }
  const keySetup = await repo.addSetup({
    description: "The cellar key",
    setupSceneIds: [scenes[0]?.id as (typeof scenes)[0]["id"]],
    payoffSceneIds: chapterCount >= 5 ? [scenes[4]?.id as (typeof scenes)[0]["id"]] : [],
  });

  const actId = await repo.actPlans.nextActId();
  await repo.saveActPlan({
    id: `PLANFOR_${actId}`,
    actId,
    title: "Act II",
    status: "draft",
    objective: "Everything gets worse",
    targetClosingState: "The investigation is public and trust has collapsed",
    chapters: chapters.map((chapter, index) => ({
      chapterId: chapter.id as string,
      role: index === 0 ? "setup" : index === titles.length - 1 ? "collapse" : "escalation",
    })),
    plotThreadGoals: [
      {
        threadId: photograph.id as string,
        intent: "the missing photograph thread advances twice",
        minAdvances: 2,
      } satisfies ActThreadGoal,
    ],
    characterArcGoals: [
      {
        characterId: mara.id as string,
        movement: "Mara learns what the key opens",
        factId: keyFact.id as string,
        target: "known",
      },
      // Intent only — no deterministic hook. The engine must report this as
      // the author's judgement to make, never decide it.
      {
        characterId: elias.id as string,
        movement: "Elias grows increasingly suspicious",
      },
    ],
    relationshipGoals: [
      {
        relationshipId: rel.id as string,
        intent: "trust between Mara and Elias falls significantly",
        dimension: "trust",
        direction: "falls",
      },
    ],
    requiredSetupIds: [],
    requiredPayoffIds: chapterCount >= 5 ? [keySetup.id as string] : [],
    forbiddenFacts: [
      { factId: killerFact.id as string, reason: "the reader must not know the killer yet" },
    ],
    constraints: [],
    notes: [],
    storyTestIds: [],
    source: "author",
  });
  await repo.approveActPlan(actId);

  return {
    store,
    repo,
    actId,
    chapters,
    scenes,
    mara,
    elias,
    manor,
    rel,
    photograph,
    vault,
    keyFact,
    killerFact,
    keySetup,
  };
}

/** A builder wired for hands-off runs. */
function autoActBuilder(
  repo: StoryRepository,
  options: {
    analysis?: ScriptedModel | false;
    planning?: boolean;
    drafting?: ScriptedModel;
    onProgress?: (build: { id: string; chapters: readonly { status: string }[] }) => void;
  } = {},
) {
  const drafting = options.drafting ?? new ScriptedModel(draftsByScene);
  const analysis =
    options.analysis === false
      ? undefined
      : (options.analysis ??
        new ScriptedModel((prompt) =>
          prompt.includes('"beats"') ? coverageAllMet(prompt) : NO_TRANSITIONS,
        ));
  const planning = options.planning === true ? new ScriptedModel(() => planProposal()) : undefined;
  const builder = new ActBuilder({
    repo,
    models: {
      drafting,
      ...(analysis !== undefined ? { analysis } : {}),
      ...(planning !== undefined ? { planning } : {}),
    },
    grant: GRANT,
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
  });
  return { builder, drafting, analysis, planning };
}

/** An approved chapter plan attached to an existing scene. */
async function approveChapterPlanFor(
  repo: StoryRepository,
  chapterId: string,
  sceneId: string,
  title: string,
  shape: Partial<PlannedScene>,
) {
  const scene: PlannedScene = {
    ...emptyPlannedScene("s1", title),
    sceneId,
    beats: [`${title} happens on the page`],
    ...shape,
  };
  await repo.saveChapterPlan({
    id: `PLANFOR_${chapterId}`,
    chapterId,
    status: "draft",
    scenes: [scene],
    activePlotThreadIds: [],
    requiredSetupIds: [],
    requiredPayoffIds: [],
    characterArcMovement: [],
    forbiddenFacts: [],
    constraints: [],
    notes: [],
    source: "author",
  });
  return repo.approveChapterPlan(chapterId);
}

describe("an act is not a for-loop over chapters", () => {
  it("builds the act chapter by chapter, evaluating the act between chapters", async () => {
    const { repo, actId } = await actTwo(2);
    const { builder } = autoActBuilder(repo);
    const done = await builder.start({ actId, approvalPolicy: "auto_until_error" });

    expect(done.status).toBe("completed");
    expect(done.chapters).toHaveLength(2);
    expect(done.chapters.every((chapter) => chapter.status === "completed")).toBe(true);
    // A child chapter build per chapter, each its own audited pipeline.
    const children = await repo.chapterBuilds.list();
    expect(children).toHaveLength(2);
    // Opening state was inspected, deterministically, before anything ran.
    expect(done.openingNotes.length).toBeGreaterThan(0);
    expect(done.openingNotes.some((note) => note.includes("thread"))).toBe(true);
    // The act evaluated its goals — and kept the report.
    expect(done.goalReport).toBeDefined();
    expect(done.goalReport?.results.length).toBeGreaterThan(0);
    // Chapter checkpoints and the act-level one.
    expect(done.checkpointId).toBeDefined();
    expect(done.chapters.every((chapter) => chapter.checkpointId !== undefined)).toBe(true);
    // Usage rolled up from the children (§18).
    expect(done.usage.calls).toBeGreaterThanOrEqual(2);
    // The compiler and the story tests ran at the end.
    expect(done.finalBuildId).toBeDefined();
  });

  it("refuses to start from a draft act plan — approval is the writer's", async () => {
    const { repo } = await actTwo(2);
    const draftActId = await repo.actPlans.nextActId();
    await repo.saveActPlan({
      id: `PLANFOR_${draftActId}`,
      actId: draftActId,
      title: "Act III",
      status: "draft",
      chapters: [],
      plotThreadGoals: [],
      characterArcGoals: [],
      relationshipGoals: [],
      requiredSetupIds: [],
      requiredPayoffIds: [],
      forbiddenFacts: [],
      constraints: [],
      notes: [],
      storyTestIds: [],
      source: "author",
    });
    const { builder } = autoActBuilder(repo);
    await expect(builder.start({ actId: draftActId })).rejects.toMatchObject({
      editCode: "unknown_target",
    });
  });

  it("refuses to start without the edit_manuscript permission", async () => {
    const { repo, actId } = await actTwo(2);
    const builder = new ActBuilder({
      repo,
      models: { drafting: new ScriptedModel(draftsByScene) },
      grant: { permissions: ["read_manuscript"] },
    });
    await expect(builder.start({ actId })).rejects.toMatchObject({
      editCode: "permission_denied",
    });
  });
});

describe("approval modes (§11)", () => {
  it("every_chapter pauses after each chapter and once more at the end", async () => {
    const { repo, actId } = await actTwo(2);
    const { builder } = autoActBuilder(repo);
    let build = await builder.start({ actId, approvalPolicy: "every_chapter" });

    expect(build.status).toBe("awaiting_approval");
    expect(build.pending?.kind).toBe("chapter_review");
    expect(build.pending?.question).toContain("Arrival");

    build = await builder.approve(build.id);
    expect(build.pending?.kind).toBe("chapter_review");
    expect(build.pending?.question).toContain("Pressure");

    build = await builder.approve(build.id);
    expect(build.pending?.kind).toBe("final");
    expect(build.pending?.question).toContain("Accept the built Act II");

    build = await builder.approve(build.id);
    expect(build.status).toBe("completed");
  });

  it("plan_and_final runs the chapters hands-off and gates only the finish", async () => {
    const { repo, actId } = await actTwo(2);
    const { builder } = autoActBuilder(repo);
    let build = await builder.start({ actId, approvalPolicy: "plan_and_final" });
    expect(build.status).toBe("awaiting_approval");
    expect(build.pending?.kind).toBe("final");
    expect(build.chapters.every((chapter) => chapter.status === "completed")).toBe(true);
    build = await builder.approve(build.id);
    expect(build.status).toBe("completed");
  });
});

describe("chapter plans inside an act (§5, §16)", () => {
  it("consumes an approved chapter plan directly, pinning its version", async () => {
    const { repo, actId, chapters, scenes, mara } = await actTwo(2);
    const approved = await approveChapterPlanFor(
      repo,
      chapters[0]?.id as string,
      scenes[0]?.id as string,
      "Arrival",
      { pov: mara.id as string, characterIds: [mara.id as string] },
    );
    const { builder } = autoActBuilder(repo);
    const done = await builder.start({ actId, approvalPolicy: "auto_until_error" });
    expect(done.status).toBe("completed");
    expect(done.chapters[0]?.planId).toBe(approved.id);
    expect(done.chapters[0]?.planVersion).toBe(approved.approvedVersion);
  });

  it("a draft chapter plan gates; the writer's yes at the gate is the approval", async () => {
    const { repo, actId, chapters, scenes } = await actTwo(2);
    const chapterId = chapters[0]?.id as string;
    await repo.saveChapterPlan({
      id: `PLANFOR_${chapterId}`,
      chapterId,
      status: "draft",
      scenes: [
        {
          ...emptyPlannedScene("s1", "Arrival"),
          sceneId: scenes[0]?.id as string,
          beats: ["Arrival happens on the page"],
        },
      ],
      activePlotThreadIds: [],
      requiredSetupIds: [],
      requiredPayoffIds: [],
      characterArcMovement: [],
      forbiddenFacts: [],
      constraints: [],
      notes: [],
      source: "author",
    });
    const { builder } = autoActBuilder(repo);
    let build = await builder.start({ actId, approvalPolicy: "auto_until_error" });
    expect(build.status).toBe("awaiting_approval");
    expect(build.pending?.kind).toBe("chapter_plan");

    build = await builder.approve(build.id);
    expect(build.status).toBe("completed");
    expect((await repo.plans.get(chapterId))?.status).toBe("approved");
  });

  it("declining a draft plan builds from the scene records and leaves the draft a draft", async () => {
    const { repo, actId, chapters, scenes } = await actTwo(2);
    const chapterId = chapters[0]?.id as string;
    await repo.saveChapterPlan({
      id: `PLANFOR_${chapterId}`,
      chapterId,
      status: "draft",
      scenes: [
        {
          ...emptyPlannedScene("s1", "Arrival"),
          sceneId: scenes[0]?.id as string,
          beats: ["Arrival happens on the page"],
        },
      ],
      activePlotThreadIds: [],
      requiredSetupIds: [],
      requiredPayoffIds: [],
      characterArcMovement: [],
      forbiddenFacts: [],
      constraints: [],
      notes: [],
      source: "author",
    });
    const { builder } = autoActBuilder(repo);
    let build = await builder.start({ actId, approvalPolicy: "auto_until_error" });
    build = await builder.rejectPending(build.id, "not this shape");
    expect(build.status).toBe("completed");
    expect((await repo.plans.get(chapterId))?.status).toBe("draft");
    expect(
      build.diagnostics.some((d) =>
        d.message.includes("building from the chapter's scene records"),
      ),
    ).toBe(true);
  });

  it("generateMissingPlans proposes a draft for review — never an approval", async () => {
    const { repo, actId } = await actTwo(2);
    const { builder } = autoActBuilder(repo, { planning: true });
    const build = await builder.start({
      actId,
      approvalPolicy: "auto_until_error",
      generateMissingPlans: true,
    });
    expect(build.status).toBe("awaiting_approval");
    expect(build.pending?.kind).toBe("chapter_plan");
    const proposed = await repo.plans.get(build.pending?.chapterId as string);
    expect(proposed?.status).toBe("draft");
    expect(proposed?.source).toBe("model");
  });
});

describe("failure pauses the act at the chapter (§17)", () => {
  it("a failed chapter build pauses the act; resume retries it, not Chapter 1", async () => {
    const { repo, actId, scenes } = await actTwo(2);
    const second = scenes[1]?.id as string;
    let healthy = false;
    const drafting = new ScriptedModel((prompt) => {
      if (!healthy && prompt.includes(`Write the prose for ${second}`)) {
        throw new ModelError("provider_error", "socket dropped");
      }
      return draftsByScene(prompt);
    });
    const { builder } = autoActBuilder(repo, { drafting });

    const paused = await builder.start({ actId, approvalPolicy: "auto_until_error" });
    expect(paused.status).toBe("paused");
    expect(paused.chapters[0]?.status).toBe("completed");
    expect(paused.chapters[1]?.status).toBe("failed");
    expect(paused.chapters[1]?.reason).toContain("socket dropped");
    expect(paused.diagnostics.some((d) => d.severity === "error")).toBe(true);

    healthy = true;
    const resumed = await builder.resume(paused.id);
    expect(resumed.status).toBe("completed");
    expect(resumed.resumeCount).toBe(1);
    // Chapter 1 was never rebuilt: still exactly one child build per chapter.
    expect(await repo.chapterBuilds.list()).toHaveLength(2);
  });

  it("cancelling keeps completed chapters and is final", async () => {
    const { repo, actId, chapters } = await actTwo(2);
    let calls = 0;
    const { builder } = autoActBuilder(repo, {
      onProgress: (build) => {
        if (build.chapters.filter((c) => c.status === "completed").length >= 1 && calls === 0) {
          calls += 1;
          builder.requestPause(build.id);
        }
      },
    });
    const paused = await builder.start({ actId, approvalPolicy: "auto_until_error" });
    expect(paused.status).toBe("paused");
    const fileBefore = await repo.readProjectFile(chapters[0]?.filePath as string);
    expect(fileBefore).toContain("Prose for");

    const cancelled = await builder.cancel(paused.id);
    expect(cancelled.status).toBe("cancelled");
    expect(await repo.readProjectFile(chapters[0]?.filePath as string)).toBe(fileBefore);
    await expect(builder.resume(cancelled.id)).rejects.toBeInstanceOf(EditError);
  });
});

describe("restart recovery (§12)", () => {
  it("close Manu mid-act, reopen, resume at the next chapter — nothing rebuilt", async () => {
    const { store, repo, actId, scenes } = await actTwo(3);
    const { builder } = autoActBuilder(repo);
    const gated = await builder.start({ actId, approvalPolicy: "every_chapter" });
    expect(gated.pending?.kind).toBe("chapter_review");

    // "Restart": a fresh repository over the same files, a fresh builder.
    const reopened = await openBranch(store);
    const fresh = autoActBuilder(reopened);
    const held = await fresh.builder.get(gated.id);
    expect(held?.status).toBe("awaiting_approval");

    let build = await fresh.builder.approve(gated.id);
    while (build.status === "awaiting_approval") {
      build = await fresh.builder.approve(build.id);
    }
    expect(build.status).toBe("completed");
    // The fresh process drafted only the remaining chapters.
    const first = scenes[0]?.id as string;
    expect(fresh.drafting.requests.some((r) => r.includes(`Write the prose for ${first}`))).toBe(
      false,
    );
  });
});

describe("replanning the remaining act (§14)", () => {
  it("proposes fresh draft plans for unbuilt chapters only", async () => {
    const { repo, actId, chapters } = await actTwo(3);
    let asked = false;
    const { builder } = autoActBuilder(repo, {
      planning: true,
      onProgress: (build) => {
        if (build.chapters.filter((c) => c.status === "completed").length >= 1 && !asked) {
          asked = true;
          builder.requestPause(build.id);
        }
      },
    });
    const paused = await builder.start({ actId, approvalPolicy: "auto_until_error" });
    expect(paused.status).toBe("paused");

    const { proposedChapterIds } = await builder.replanRemaining(paused.id, {
      instruction: "Tighten the escalation.",
    });
    const remaining = paused.chapters.filter((c) => c.status === "pending");
    expect(proposedChapterIds).toEqual(remaining.map((c) => c.chapterId));
    for (const chapterId of proposedChapterIds) {
      const plan = await repo.plans.get(chapterId);
      expect(plan?.status).toBe("draft");
      expect(plan?.source).toBe("model");
    }
    // The completed chapter was not touched: it never had a plan, still none.
    expect(await repo.plans.get(chapters[0]?.id as string)).toBeNull();
  });
});

describe("act goals and act-scoped story tests (§3, §8–10)", () => {
  it("reports goal progress deterministically, and semantic intent honestly", async () => {
    const { repo, actId, photograph, rel, mara, keyFact } = await actTwo(5);
    const plan = (await repo.actPlans.get(actId)) as ActPlan;
    const report = await repo.evaluateActGoals(plan);

    const thread = report.results.find((r) => r.kind === "thread");
    expect(thread?.method).toBe("deterministic");
    expect(thread?.refId).toBe(photograph.id as string);
    // Scenes in chapters 1 and 3 touch the thread: "advances twice" holds.
    expect(thread?.status).toBe("satisfied");

    const arc = report.results.find((r) => r.kind === "arc");
    expect(arc?.status).toBe("unsatisfied"); // Mara does not know the key fact yet.
    const payoff = report.results.find((r) => r.kind === "payoff");
    expect(payoff?.status).toBe("satisfied"); // recorded payoff scene is in the act
    const forbidden = report.results.find((r) => r.kind === "forbidden_fact");
    expect(forbidden?.status).toBe("satisfied"); // nobody knows the killer

    // The relationship goal tracks a dimension nothing has recorded — the
    // record cannot show a fall, and says so.
    const relationship = report.results.find((r) => r.kind === "relationship");
    expect(relationship?.refId).toBe(rel.id as string);
    expect(relationship?.status).toBe("unsatisfied");
    expect(relationship?.evidence).toContain("no recorded change");

    // Teach Mara the fact; the arc goal flips — state, not judgement.
    const lastScene = (await repo.listScenes()).at(-1);
    await repo.addStateTransitions([
      {
        sceneId: lastScene?.id as string,
        kind: "knowledge_changed",
        subjectId: mara.id as string,
        value: keyFact.id as string,
        knowledgeState: "known",
      },
    ]);
    const after = await repo.evaluateActGoals(plan);
    expect(after.results.find((r) => r.kind === "arc")?.status).toBe("satisfied");
  });

  it("runs act-relevant story tests at the finish and reports their failures (§9)", async () => {
    const { repo, actId, chapters, scenes, elias, killerFact } = await actTwo(2);
    await repo.addStoryTest({
      name: "The killer stays hidden",
      assertion: {
        kind: "character_does_not_know_fact",
        characterId: elias.id,
        factId: killerFact.id,
      },
      scope: {
        kind: "between",
        anchorId: chapters[0]?.id as (typeof chapters)[0]["id"],
        untilId: chapters[1]?.id as (typeof chapters)[0]["id"],
      },
      severity: "warning",
    });
    // Break the promise deliberately: Elias learns the killer in scene 1.
    await repo.addStateTransitions([
      {
        sceneId: scenes[0]?.id as string,
        kind: "knowledge_changed",
        subjectId: elias.id as string,
        value: killerFact.id as string,
        knowledgeState: "known",
      },
    ]);
    const { builder } = autoActBuilder(repo);
    const done = await builder.start({ actId, approvalPolicy: "auto_until_error" });
    expect(done.status).toBe("completed");
    expect(done.actTestFailures).toBe(1);
    expect(
      done.diagnostics.some(
        (d) => d.severity === "error" && d.message.includes("act story test failed"),
      ),
    ).toBe(true);
    // The violated act constraint is also an act_validation error (§10).
    expect(
      done.diagnostics.some((d) => d.step === "act_validation" && d.severity === "error"),
    ).toBe(true);
    // And the questions only a reader can settle are labelled, not verdicts.
    expect(done.diagnostics.some((d) => d.severity === "semantic_concern")).toBe(true);
  });
});

describe("the acceptance scenario (§19)", () => {
  it("plan, build, deviate, detect, adjust, pause, restart, resume, edit, finish", async () => {
    const fixture = await actTwo(5);
    const { store, repo, actId, chapters, scenes, mara, elias, manor, keyFact, killerFact } =
      fixture;

    // §19.14's test, written before anything is built.
    await repo.addStoryTest({
      name: "The killer stays hidden through Act II",
      assertion: {
        kind: "character_does_not_know_fact",
        characterId: elias.id,
        factId: killerFact.id,
      },
      scope: {
        kind: "between",
        anchorId: chapters[0]?.id as (typeof chapters)[0]["id"],
        untilId: chapters[4]?.id as (typeof chapters)[0]["id"],
      },
      severity: "warning",
    });

    // Chapter 2's approved plan promises: Mara learns what the key opens.
    await approveChapterPlanFor(
      repo,
      chapters[1]?.id as string,
      scenes[1]?.id as string,
      "Pressure",
      {
        knowledgeChanges: [
          { characterId: mara.id as string, factId: keyFact.id as string, to: "known" },
        ],
        characterIds: [mara.id as string, elias.id as string],
      },
    );
    // Chapter 3's approved plan depends on it: Mara reveals it to Elias.
    await approveChapterPlanFor(
      repo,
      chapters[2]?.id as string,
      scenes[2]?.id as string,
      "Discovery",
      {
        characterIds: [mara.id as string, elias.id as string],
        plotThreadIds: [fixture.photograph.id as string],
        knowledgeChanges: [
          {
            characterId: elias.id as string,
            factId: keyFact.id as string,
            to: "known",
            sourceEntityId: mara.id as string,
          },
        ],
      },
    );

    // §19.1: the approved act plan exists.
    expect((await repo.actPlans.get(actId))?.status).toBe("approved");

    const first = scenes[0]?.id as string;
    const drafting = new ScriptedModel(draftsByScene);
    const analysis = new ScriptedModel((prompt) => {
      if (prompt.includes('"beats"')) return coverageAllMet(prompt);
      // Chapter 1's scene moves Mara to the manor — objective, high confidence.
      if (prompt.includes(`state changes ${first}`)) {
        return {
          transitions: [
            {
              kind: "character_location",
              subjectId: mara.id as string,
              value: manor.id as string,
              confidence: 0.95,
              evidence: "Mara crossed the threshold",
            },
          ],
        };
      }
      // Chapter 2 DELIBERATELY DEVIATES (§19.4): its plan promised Mara would
      // learn the key fact; extraction finds no such thing in the prose.
      return NO_TRANSITIONS;
    });
    const builder = new ActBuilder({
      repo,
      models: { drafting, analysis },
      grant: GRANT,
    });

    // §19.2–5: chapters 1–2 build; after Chapter 2, Manu detects that
    // Chapter 3's approved plan no longer holds — the promised knowledge never
    // arrived — and pauses rather than building from a stale plan.
    const paused = await builder.start({
      actId,
      approvalPolicy: "auto_until_error",
      autonomy: "pause",
      autoConfirmObjective: true,
    });
    expect(paused.status).toBe("paused");
    expect(paused.chapters[0]?.status).toBe("completed");
    expect(paused.chapters[1]?.status).toBe("completed");
    expect(paused.chapters[2]?.status).toBe("pending");
    expect(paused.chapters[2]?.planStale).toBe(true);
    expect(
      paused.diagnostics.some(
        (d) => d.step === "adapt_future_plans" && d.message.includes("no longer holds"),
      ),
    ).toBe(true);

    // §19.3: state propagated — Chapter 1's confirmed transition is what the
    // world looks like entering Chapter 2.
    const stateBefore = await repo.getCharacterState(mara.id, {
      sceneId: scenes[1]?.id as string,
      position: "before",
    });
    expect(stateBefore.locationId).toBe(manor.id as string);

    // §19.6: the remaining plan is adjusted — the writer revises Chapter 3's
    // plan to stop depending on the knowledge Chapter 2 never delivered.
    await approveChapterPlanFor(
      repo,
      chapters[2]?.id as string,
      scenes[2]?.id as string,
      "Discovery",
      {
        characterIds: [mara.id as string, elias.id as string],
        plotThreadIds: [fixture.photograph.id as string],
      },
    );

    // §19.10: the writer edits a completed chapter by hand while paused.
    const chapterOnePath = chapters[0]?.filePath as string;
    const held = (await repo.readProjectFile(chapterOnePath)) ?? "";
    await repo.writeProjectFile(
      chapterOnePath,
      held.replace("Prose for", "Mara never rang the bell. Prose for"),
    );

    // §19.7–9: Manu "restarts" — a new repository over the same store, a new
    // builder with no memory — and the build resumes at Chapter 3.
    const reopened = await openBranch(store);
    const freshDrafting = new ScriptedModel(draftsByScene);
    const freshAnalysis = new ScriptedModel((prompt) =>
      prompt.includes('"beats"') ? coverageAllMet(prompt) : NO_TRANSITIONS,
    );
    const fresh = new ActBuilder({
      repo: reopened,
      models: { drafting: freshDrafting, analysis: freshAnalysis },
      grant: GRANT,
    });
    const resumed = await fresh.resume(paused.id);

    // §19.12: the act completes; chapters 1–2 were never rebuilt.
    expect(resumed.status).toBe("completed");
    expect(resumed.resumeCount).toBe(1);
    expect(resumed.chapters.every((chapter) => chapter.status === "completed")).toBe(true);
    expect(freshDrafting.requests.some((r) => r.includes(`Write the prose for ${first}`))).toBe(
      false,
    );

    // §19.11: later chapters worked from the latest canonical project — the
    // human edit is still exactly where the writer put it.
    const finalFile = (await reopened.readProjectFile(chapterOnePath)) ?? "";
    expect(finalFile).toContain("Mara never rang the bell.");

    // §19.13–14: the Story Compiler ran, and the act's story tests ran clean.
    expect(resumed.finalBuildId).toBeDefined();
    expect(resumed.actTestFailures).toBe(0);

    // The goal report tracks the act plan's outcomes (§3, §7–8).
    const report = resumed.goalReport;
    expect(report).toBeDefined();
    expect(report?.results.find((r) => r.kind === "thread")?.status).toBe("satisfied");
    expect(report?.results.find((r) => r.kind === "forbidden_fact")?.status).toBe("satisfied");
    expect(report?.results.find((r) => r.kind === "payoff")?.status).toBe("satisfied");

    // §19.15: the record is intact — per-chapter checkpoints exist, and every
    // committed scene's change set is in ordinary history.
    expect(resumed.chapters.every((chapter) => chapter.checkpointId !== undefined)).toBe(true);
    const history = await reopened.listChangeSets();
    for (const chapter of resumed.chapters) {
      const child = await reopened.chapterBuilds.get(chapter.chapterBuildId as string);
      for (const scene of child?.scenes ?? []) {
        expect(history.some((change) => change.id === scene.changeSetId)).toBe(true);
      }
    }
  });

  it("propose autonomy arrives at the stale chapter with a drafted replacement", async () => {
    const { repo, actId, chapters, scenes, mara, elias, keyFact } = await actTwo(3);
    await approveChapterPlanFor(
      repo,
      chapters[1]?.id as string,
      scenes[1]?.id as string,
      "Pressure",
      {
        knowledgeChanges: [
          { characterId: mara.id as string, factId: keyFact.id as string, to: "known" },
        ],
      },
    );
    await approveChapterPlanFor(
      repo,
      chapters[2]?.id as string,
      scenes[2]?.id as string,
      "Discovery",
      {
        knowledgeChanges: [
          {
            characterId: elias.id as string,
            factId: keyFact.id as string,
            to: "known",
            sourceEntityId: mara.id as string,
          },
        ],
      },
    );
    const { builder } = autoActBuilder(repo, { planning: true });
    const paused = await builder.start({
      actId,
      approvalPolicy: "auto_until_error",
      autonomy: "propose",
    });
    // The deviation was detected AND an updated draft was proposed for review.
    expect(paused.status).toBe("paused");
    expect(paused.chapters[2]?.planStale).toBe(true);
    const proposed = await repo.plans.get(chapters[2]?.id as string);
    expect(proposed?.status).toBe("draft");
    expect(proposed?.source).toBe("model");
    expect(
      paused.diagnostics.some((d) => d.message.includes("updated drafts are ready for review")),
    ).toBe(true);
  });
});
