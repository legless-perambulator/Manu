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
import { BookBuilder } from "./book-builder";
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

class ScriptedModel implements LanguageModel {
  readonly capabilities = { streaming: true, structuredOutput: true, tools: true };
  readonly requests: string[] = [];
  private readonly fallback = new MockLanguageModel({ structured: { text: "…", rationale: "" } });

  constructor(
    private readonly respond: (prompt: string, calls: number) => unknown,
    readonly id: string = "mock:scripted",
  ) {}

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
    text: `Prose for ${scene}. The book grew by one scene, drafted from the manuscript as it actually stands.`,
    rationale: "drafted",
    warnings: [],
  };
}

function coverageAllMet(prompt: string): unknown {
  const beats = [...prompt.matchAll(/^- (.+)$/gm)].map((m) => m[1] ?? "");
  return { beats: beats.map((beat) => ({ beat, met: true, note: "shown" })) };
}

const NO_TRANSITIONS = { transitions: [] };

/**
 * The §29 fixture book: acts × chapters × scenes, with threads spanning acts,
 * a relationship, facts, a setup/payoff pair, approved act plans and an
 * approved book plan carrying goals of every kind.
 */
async function fixtureBook(acts = 2, chaptersPerAct = 2, scenesPerChapter = 2) {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "The Black Thorn" });
  const mara = await repo.addCharacter({ name: "Mara", role: "protagonist" });
  const elias = await repo.addCharacter({ name: "Elias", role: "foil" });
  const manor = await repo.addLocation({ name: "Blackthorn Manor" });
  const rel = await repo.addRelationship({
    characterAId: mara.id,
    characterBId: elias.id,
    type: "allies",
  });
  const murder = await repo.addPlotThread({ name: "The murder" });
  const photograph = await repo.addPlotThread({ name: "The missing photograph" });
  const killerFact = await repo.addFact({
    statement: "The killer is Marcus",
    objectiveTruth: true,
  });
  const keyFact = await repo.addFact({
    statement: "The cellar key opens the vault",
    objectiveTruth: true,
  });

  const chapters = [];
  const scenes = [];
  const actChapterIds: string[][] = [];
  let sceneIndex = 0;
  for (let a = 0; a < acts; a += 1) {
    const ids: string[] = [];
    for (let c = 0; c < chaptersPerAct; c += 1) {
      const chapter = await repo.addChapter({
        title: `Act ${String(a + 1)} Chapter ${String(c + 1)}`,
        status: "outline",
      });
      chapters.push(chapter);
      ids.push(chapter.id as string);
      for (let s = 0; s < scenesPerChapter; s += 1) {
        // The murder thread runs through every chapter; the photograph is
        // touched once in the first act and once in the last, so the
        // book-wide "advances twice" goal only holds when both acts exist.
        const isFirstBookScene = sceneIndex === 0;
        const isFirstSceneOfLastAct = a === acts - 1 && c === 0 && s === 0;
        scenes.push(
          await repo.addScene({
            title: `${chapter.title} scene ${String(s + 1)}`,
            chapterId: chapter.id,
            pov: mara.id,
            locationId: manor.id,
            characterIds: [mara.id, elias.id],
            plotThreadIds:
              isFirstBookScene || isFirstSceneOfLastAct ? [murder.id, photograph.id] : [murder.id],
            purpose: [`${chapter.title} scene ${String(s + 1)} happens on the page`],
            status: "planned",
          }),
        );
        sceneIndex += 1;
      }
    }
    actChapterIds.push(ids);
  }
  const keySetup = await repo.addSetup({
    description: "The cellar key",
    setupSceneIds: [scenes[0]?.id as (typeof scenes)[0]["id"]],
    payoffSceneIds: [scenes[scenes.length - 1]?.id as (typeof scenes)[0]["id"]],
  });

  const actIds: string[] = [];
  for (let a = 0; a < acts; a += 1) {
    const actId = await repo.actPlans.nextActId();
    actIds.push(actId);
    await repo.saveActPlan({
      id: `PLANFOR_${actId}`,
      actId,
      title: `Act ${["I", "II", "III", "IV"][a] ?? String(a + 1)}`,
      status: "draft",
      chapters: (actChapterIds[a] ?? []).map((chapterId) => ({ chapterId })),
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
    await repo.approveActPlan(actId);
  }

  await repo.saveBookPlan({
    id: "BOOKPLAN",
    projectId: repo.getManifest().id as string,
    status: "draft",
    premise: "A locked manor, a missing photograph, a murder nobody will name.",
    storyGoal: "The truth surfaces and costs everyone something.",
    targetWords: 400,
    acts: actIds.map((actId, index) => ({
      actId,
      intent: index === 0 ? "everything is planted" : "everything comes due",
    })),
    majorPlotThreads: [
      {
        threadId: photograph.id as string,
        intent: "the photograph thread is touched in both halves of the book",
        minAdvances: 2,
      },
    ],
    characterArcGoals: [
      {
        characterId: mara.id as string,
        movement: "Mara learns what the key opens",
        factId: keyFact.id as string,
        target: "known",
      },
      { characterId: elias.id as string, movement: "Elias moves from guarded to trusting" },
    ],
    relationshipArcGoals: [
      { relationshipId: rel.id as string, intent: "the alliance is tested and survives" },
    ],
    mysteryIds: [],
    themes: ["what secrecy costs"],
    promises: ["the cellar key matters"],
    constraints: [],
    notes: [],
    storyTestIds: [],
    source: "author",
  });
  await repo.approveBookPlan();

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
      untilId: chapters[chapters.length - 1]?.id as (typeof chapters)[0]["id"],
    },
    severity: "warning",
  });

  return {
    store,
    repo,
    actIds,
    chapters,
    scenes,
    mara,
    elias,
    manor,
    rel,
    murder,
    photograph,
    killerFact,
    keyFact,
    keySetup,
  };
}

function autoBookBuilder(
  repo: StoryRepository,
  options: {
    drafting?: ScriptedModel;
    analysis?: ScriptedModel | false;
    onProgress?: (build: { id: string; acts: readonly { status: string }[] }) => void;
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
  const builder = new BookBuilder({
    repo,
    models: { drafting, ...(analysis !== undefined ? { analysis } : {}) },
    grant: GRANT,
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
  });
  return { builder, drafting, analysis };
}

describe("the hierarchy, not a prompt (§3, §5, §32)", () => {
  it("builds the fixture book act by act, chapter by chapter, scene by scene", async () => {
    const { repo, chapters, scenes } = await fixtureBook();
    const { builder, drafting } = autoBookBuilder(repo);
    const done = await builder.start({ approvalPolicy: "auto_until_error" });

    expect(done.status).toBe("completed");
    expect(done.acts).toHaveLength(2);
    expect(done.acts.every((act) => act.status === "completed")).toBe(true);

    // One child act build per act, one chapter build per chapter — the
    // hierarchy is real, not a flattened outline.
    expect(await repo.actBuilds.list()).toHaveLength(2);
    expect(await repo.chapterBuilds.list()).toHaveLength(4);

    // Every scene drafted exactly once, in its own bounded call.
    for (const scene of scenes) {
      const drafts = drafting.requests.filter((r) =>
        r.includes(`Write the prose for ${String(scene.id)}`),
      );
      expect(drafts).toHaveLength(1);
    }
    for (const chapter of chapters) {
      const file = (await repo.readProjectFile(chapter.filePath)) ?? "";
      expect(file).toContain("Prose for SCENE_");
    }

    // The report (§24): a draft build, said so, with real numbers.
    const report = done.report;
    expect(report?.label).toBe("Draft build complete");
    expect(report?.words ?? 0).toBeGreaterThan(0);
    expect(report?.actsCompleted).toBe(2);
    expect(report?.chaptersCompleted).toBe(4);
    expect(report?.scenes).toBe(8);
    expect(report?.compilerErrors).toBe(0);
    expect(report?.testsTotal ?? 0).toBeGreaterThan(0);

    // Book goals evaluated from canonical state: the photograph thread was
    // touched in both halves, so the deterministic goal holds.
    expect(done.goalReport?.results.find((r) => r.kind === "thread")?.status).toBe("satisfied");
    // Intent-only goals stay the writer's call, labelled as such.
    expect(done.diagnostics.some((d) => d.severity === "semantic_concern")).toBe(true);

    // Usage rolled up from every layer (§27); checkpoints at every act.
    expect(done.usage.calls).toBeGreaterThanOrEqual(8);
    expect(done.checkpointId).toBeDefined();
    expect(done.acts.every((act) => act.checkpointId !== undefined)).toBe(true);
  });

  it("refuses a draft book plan, a second live build, and a missing permission", async () => {
    const { repo } = await fixtureBook(1, 1, 1);
    // Un-approve by saving a new draft version.
    const plan = await repo.bookPlan.get();
    if (plan !== null) {
      const { version: _v, revisions: _r, createdAt: _c, updatedAt: _u, ...rest } = plan;
      await repo.saveBookPlan({ ...rest, status: "draft" });
    }
    const { builder } = autoBookBuilder(repo);
    await expect(builder.start()).rejects.toMatchObject({ editCode: "unknown_target" });

    await repo.approveBookPlan();
    const denied = new BookBuilder({
      repo,
      models: { drafting: new ScriptedModel(draftsByScene) },
      grant: { permissions: ["read_manuscript"] },
    });
    await expect(denied.start()).rejects.toMatchObject({ editCode: "permission_denied" });

    let paused = false;
    const { builder: pausing } = autoBookBuilder(repo, {
      onProgress: (b) => {
        if (!paused) {
          paused = true;
          pausing.requestPause(b.id);
        }
      },
    });
    const held = await pausing.start({ approvalPolicy: "auto_until_error" });
    expect(held.status).toBe("paused");
    await expect(pausing.start()).rejects.toMatchObject({ editCode: "unknown_target" });
  });
});

describe("approval policies fan out across the hierarchy (§10)", () => {
  it("every_act gates after each act and once at the end", async () => {
    const { repo } = await fixtureBook();
    const { builder } = autoBookBuilder(repo);
    let build = await builder.start({ approvalPolicy: "every_act" });

    expect(build.status).toBe("awaiting_approval");
    expect(build.pending?.kind).toBe("act_review");
    expect(build.pending?.question).toContain("Act I");

    build = await builder.approve(build.id);
    expect(build.pending?.kind).toBe("act_review");
    expect(build.pending?.question).toContain("Act II");

    build = await builder.approve(build.id);
    expect(build.pending?.kind).toBe("final");
    expect(build.pending?.question).toContain("Accept the draft build");

    build = await builder.approve(build.id);
    expect(build.status).toBe("completed");
  });

  it("every_scene forwards each held scene up through act to book, and back down", async () => {
    const { repo, chapters } = await fixtureBook(1, 1, 2);
    const { builder } = autoBookBuilder(repo);
    let build = await builder.start({ approvalPolicy: "every_scene" });

    // First forwarded gate: the chapter's own plan gate, two layers down.
    expect(build.status).toBe("awaiting_approval");
    expect(build.pending?.kind).toBe("act_gate");
    expect(build.pending?.question).toContain("scenes");

    build = await builder.approve(build.id);
    // Scene 1 drafted and held. Nothing has landed in the manuscript.
    expect(build.pending?.kind).toBe("act_gate");
    expect(build.pending?.question).toContain("Keep the drafted");
    const fileBefore = (await repo.readProjectFile(chapters[0]?.filePath as string)) ?? "";
    expect(fileBefore).not.toContain("Prose for");

    build = await builder.approve(build.id);
    // The approval travelled book → act → chapter: scene 1 committed.
    const fileAfter = (await repo.readProjectFile(chapters[0]?.filePath as string)) ?? "";
    expect(fileAfter).toContain("Prose for");

    let gates = 0;
    while (build.status === "awaiting_approval" && gates < 10) {
      gates += 1;
      build = await builder.approve(build.id);
    }
    expect(build.status).toBe("completed");
  });

  it("declining a forwarded scene gate discards the held draft down the chain", async () => {
    const { repo, chapters } = await fixtureBook(1, 1, 2);
    const { builder } = autoBookBuilder(repo);
    let build = await builder.start({ approvalPolicy: "every_scene" });
    build = await builder.approve(build.id); // plan gate → scene 1 held
    expect(build.pending?.question).toContain("Keep the drafted");

    build = await builder.rejectPending(build.id, "not this one");
    // The chapter discarded the draft and paused; the book paused with it.
    expect(build.status).toBe("paused");
    const file = (await repo.readProjectFile(chapters[0]?.filePath as string)) ?? "";
    expect(file).not.toContain("Prose for");

    // Resume redrafts the scene and raises the gate again.
    build = await builder.resume(build.id);
    expect(build.status).toBe("awaiting_approval");
    expect(build.pending?.question).toContain("Keep the drafted");
  });
});

describe("quality gates and bounded repair (§18–19)", () => {
  it("a hard story test failing between acts pauses the build at the gate", async () => {
    const { repo, scenes, elias, killerFact } = await fixtureBook();
    let asked = false;
    const { builder } = autoBookBuilder(repo, {
      onProgress: (b) => {
        if (!asked && b.acts.filter((a) => a.status === "completed").length >= 1) {
          asked = true;
          builder.requestPause(b.id);
        }
      },
    });
    const paused = await builder.start({ approvalPolicy: "auto_until_error" });
    expect(paused.status).toBe("paused");

    // While paused, the story breaks its own hard promise: an error-severity
    // test now fails against recorded state.
    await repo.addStoryTest({
      name: "Elias must never learn the killer",
      assertion: {
        kind: "character_does_not_know_fact",
        characterId: elias.id,
        factId: killerFact.id,
      },
      severity: "error",
    });
    await repo.addStateTransitions([
      {
        sceneId: scenes[0]?.id as string,
        kind: "knowledge_changed",
        subjectId: elias.id as string,
        value: killerFact.id as string,
        knowledgeState: "known",
      },
    ]);

    const gated = await builder.resume(paused.id);
    expect(gated.status).toBe("paused");
    expect(
      gated.diagnostics.some((d) => d.severity === "error" && d.message.includes("quality gate")),
    ).toBe(true);

    // Withdraw the offending state; the build resumes and completes.
    const stored = (await repo.listStateTransitions()).filter(
      (t) => t.kind === "knowledge_changed" && t.subjectId === (elias.id as string),
    );
    for (const t of stored) await repo.setTransitionStatus(t.id as string, "rejected");
    const done = await builder.resume(gated.id);
    expect(done.status).toBe("completed");
  });

  it("passes the scene repair bound down to every chapter build", async () => {
    const { repo } = await fixtureBook(1, 1, 1);
    const { builder } = autoBookBuilder(repo);
    const done = await builder.start({
      approvalPolicy: "auto_until_error",
      gates: { maxSceneRepairs: 3 },
    });
    expect(done.status).toBe("completed");
    const children = await repo.chapterBuilds.list();
    const child = await repo.chapterBuilds.get(children[0]?.id as string);
    expect(child?.maxRevisions).toBe(3);
  });
});

describe("the acceptance scenario (§33)", () => {
  it("launch, build, pause, restart, resume, edit, fail, retry, finish, report", async () => {
    const fixture = await fixtureBook();
    const { store, repo, chapters, scenes, mara, manor } = fixture;
    const first = scenes[0]?.id as string;

    // §33.1: the approved plan hierarchy exists.
    expect((await repo.bookPlan.get())?.status).toBe("approved");

    const analysis = new ScriptedModel((prompt) => {
      if (prompt.includes('"beats"')) return coverageAllMet(prompt);
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
      return NO_TRANSITIONS;
    });
    let stopAfterActOne = true;
    const { builder } = autoBookBuilder(repo, {
      analysis,
      onProgress: (b) => {
        if (stopAfterActOne && b.acts.filter((a) => a.status === "completed").length >= 1) {
          stopAfterActOne = false;
          builder.requestPause(b.id);
        }
      },
    });

    // §33.2–5: the build launches, Act I builds, and the pause lands.
    const paused = await builder.start({
      approvalPolicy: "auto_until_error",
      autoConfirmObjective: true,
    });
    expect(paused.status).toBe("paused");
    expect(paused.acts[0]?.status).toBe("completed");
    expect(paused.acts[1]?.status).toBe("pending");

    // §33.4: state propagated through canonical Story State (§7).
    const state = await repo.getCharacterState(mara.id, {
      sceneId: scenes[1]?.id as string,
      position: "before",
    });
    expect(state.locationId).toBe(manor.id as string);

    // §33.8: the writer rewrites a completed chapter by hand while paused.
    const chapterOnePath = chapters[0]?.filePath as string;
    const held = (await repo.readProjectFile(chapterOnePath)) ?? "";
    await repo.writeProjectFile(
      chapterOnePath,
      held.replace("Prose for", "Nobody had rung the bell in years. Prose for"),
    );

    // §33.6–7: Manu restarts — a fresh repository over the same files, a
    // fresh builder with no memory — and §33.10: the provider fails on the
    // first Act II scene.
    const reopened = await openBranch(store);
    let healthy = false;
    const failingDrafting = new ScriptedModel((prompt) => {
      if (!healthy && prompt.includes("Act 2")) {
        throw new ModelError("provider_error", "rate limited");
      }
      return draftsByScene(prompt);
    });
    const fresh = new BookBuilder({
      repo: reopened,
      models: {
        drafting: failingDrafting,
        analysis: new ScriptedModel((prompt) =>
          prompt.includes('"beats"') ? coverageAllMet(prompt) : NO_TRANSITIONS,
        ),
      },
      grant: GRANT,
    });

    // §33.11: the failure pauses the build safely — preserved state, no
    // corruption, the diagnosis on the record (§14).
    const failed = await fresh.resume(paused.id);
    expect(failed.status).toBe("paused");
    expect(failed.acts[1]?.status).toBe("failed");
    expect(failed.acts[1]?.reason).toContain("rate limited");
    // §33.9: nothing about Act I was disturbed — including the human edit.
    expect(await reopened.readProjectFile(chapterOnePath)).toContain(
      "Nobody had rung the bell in years.",
    );

    // §33.12–13: retry; Act II completes.
    healthy = true;
    const done = await fresh.resume(failed.id);
    expect(done.status).toBe("completed");
    expect(done.acts.every((act) => act.status === "completed")).toBe(true);
    expect(done.resumeCount).toBe(2);

    // §28: no duplicate scenes, no lost work — each scene's prose exactly once.
    for (const chapter of chapters) {
      const file = (await reopened.readProjectFile(chapter.filePath)) ?? "";
      for (const scene of scenes.filter((s) => s.chapterId === chapter.id)) {
        const occurrences = file.split(`Prose for ${String(scene.id)}.`).length - 1;
        expect(occurrences).toBe(1);
      }
    }
    expect(await reopened.readProjectFile(chapterOnePath)).toContain(
      "Nobody had rung the bell in years.",
    );

    // §33.14–16: compiler, story tests, and the complete report.
    expect(done.finalBuildId).toBeDefined();
    const report = done.report;
    expect(report?.label).toBe("Draft build complete");
    expect(report?.actsCompleted).toBe(2);
    expect(report?.chaptersCompleted).toBe(4);
    expect(report?.scenes).toBe(8);
    expect(report?.compilerErrors).toBe(0);
    expect(report?.failingTests).toHaveLength(0);

    // §33.17: provenance and revisions intact — every scene's change set in
    // ordinary history, a checkpoint after every act.
    const history = await reopened.listChangeSets();
    for (const act of done.acts) {
      expect(act.checkpointId).toBeDefined();
      const child = await reopened.actBuilds.get(act.actBuildId as string);
      for (const chapterRecord of child?.chapters ?? []) {
        const chapterChild = await reopened.chapterBuilds.get(
          chapterRecord.chapterBuildId as string,
        );
        for (const scene of chapterChild?.scenes ?? []) {
          expect(history.some((change) => change.id === scene.changeSetId)).toBe(true);
        }
      }
    }
  });

  it("a model changed mid-build serves the future and never rewrites the past (§15)", async () => {
    const { store, repo, chapters } = await fixtureBook();
    let stop = true;
    const modelA = new ScriptedModel(draftsByScene, "mock:model-a");
    const { builder } = autoBookBuilder(repo, {
      drafting: modelA,
      onProgress: (b) => {
        if (stop && b.acts.filter((a) => a.status === "completed").length >= 1) {
          stop = false;
          builder.requestPause(b.id);
        }
      },
    });
    const paused = await builder.start({ approvalPolicy: "auto_until_error" });
    expect(paused.status).toBe("paused");
    expect(paused.modelAssignments.premium_prose).toBe("mock:model-a");

    // Reopen with Model B configured for drafting.
    const reopened = await openBranch(store);
    const modelB = new ScriptedModel(draftsByScene, "mock:model-b");
    const fresh = new BookBuilder({
      repo: reopened,
      models: {
        drafting: modelB,
        analysis: new ScriptedModel((prompt) =>
          prompt.includes('"beats"') ? coverageAllMet(prompt) : NO_TRANSITIONS,
        ),
      },
      grant: GRANT,
    });
    const done = await fresh.resume(paused.id);
    expect(done.status).toBe("completed");
    expect(done.modelAssignments.premium_prose).toBe("mock:model-b");
    expect(done.diagnostics.some((d) => d.message.includes("model assignments changed"))).toBe(
      true,
    );

    // Provenance: Act I chapters carry Model A; Act II chapters carry Model B.
    const draftsFor = async (chapterIndex: number) => {
      const file = chapters[chapterIndex]?.filePath as string;
      const out = [];
      for (const entry of await reopened.listChangeSets()) {
        if (!entry.summary.startsWith("Draft SCENE")) continue;
        const change = await reopened.getChangeSet(entry.id);
        if (change?.filesChanged.some((f) => f.path === file)) out.push(change);
      }
      return out;
    };
    const actOne = await draftsFor(0);
    const actTwo = await draftsFor(2);
    expect(actOne.length).toBeGreaterThan(0);
    expect(actTwo.length).toBeGreaterThan(0);
    expect(actOne.every((change) => change.modelId === "mock:model-a")).toBe(true);
    expect(actTwo.every((change) => change.modelId === "mock:model-b")).toBe(true);
    // Model A's prose was never regenerated: Model B drafted no Act 1 scene.
    // (The match is against the instruction's quoted scene title — an Act 2
    // scene's compiled context may legitimately mention Act 1 chapters.)
    expect(
      modelB.requests.some((r) => /Write the prose for SCENE_\d+ \("Act 1 Chapter/.test(r)),
    ).toBe(false);
  });

  it("cancelling keeps everything committed and is final", async () => {
    const { repo, chapters } = await fixtureBook();
    let stop = true;
    const { builder } = autoBookBuilder(repo, {
      onProgress: (b) => {
        if (stop && b.acts.filter((a) => a.status === "completed").length >= 1) {
          stop = false;
          builder.requestPause(b.id);
        }
      },
    });
    const paused = await builder.start({ approvalPolicy: "auto_until_error" });
    const fileBefore = await repo.readProjectFile(chapters[0]?.filePath as string);
    const cancelled = await builder.cancel(paused.id);
    expect(cancelled.status).toBe("cancelled");
    expect(await repo.readProjectFile(chapters[0]?.filePath as string)).toBe(fileBefore);
    await expect(builder.resume(cancelled.id)).rejects.toBeInstanceOf(EditError);
  });
});

describe("the stress plan (§30)", () => {
  it("carries 3 acts, 30 chapters and 120 scenes through restart without strain", async () => {
    const { store, repo, scenes } = await fixtureBook(3, 10, 4);
    expect(scenes).toHaveLength(120);

    // Analysis off: the stress test measures orchestration, not mock chatter.
    let stop = true;
    const { builder, drafting } = autoBookBuilder(repo, {
      analysis: false,
      onProgress: (b) => {
        if (stop && b.acts.filter((a) => a.status === "completed").length >= 1) {
          stop = false;
          builder.requestPause(b.id);
        }
      },
    });
    const paused = await builder.start({ approvalPolicy: "auto_until_error" });
    expect(paused.status).toBe("paused");
    expect(paused.acts[0]?.status).toBe("completed");

    // Restart mid-book; the remaining 80 scenes build from where it stopped.
    const reopened = await openBranch(store);
    const freshDrafting = new ScriptedModel(draftsByScene);
    const fresh = new BookBuilder({
      repo: reopened,
      models: { drafting: freshDrafting },
      grant: GRANT,
    });
    const done = await fresh.resume(paused.id);
    expect(done.status).toBe("completed");
    expect(done.acts.every((act) => act.status === "completed")).toBe(true);
    expect(done.report?.scenes).toBe(120);
    expect(done.report?.chaptersCompleted).toBe(30);

    // Every scene drafted exactly once across both sessions.
    const all = [...drafting.requests, ...freshDrafting.requests];
    for (const scene of scenes) {
      expect(all.filter((r) => r.includes(`Write the prose for ${String(scene.id)}`))).toHaveLength(
        1,
      );
    }

    // No assumption that the manuscript fits a context window: every drafting
    // request is budget-bounded, and late scenes never carry Act 1's prose.
    const late = freshDrafting.requests.filter((r) => r.includes("Act 3 Chapter 10"));
    expect(late.length).toBeGreaterThan(0);
    for (const request of late) {
      expect(request).not.toContain("Prose for SCENE_0001.");
      expect(request.length).toBeLessThan(80_000);
    }
  }, 120_000);
});
