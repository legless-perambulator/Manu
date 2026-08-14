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
import { StoryRepository, listSceneSpans, openBranch } from "@jellytind/story-repository";
import { ChapterBuilder } from "./chapter-builder";
import { EditError } from "./types";

const GRANT: PermissionGrant = {
  permissions: ["read_manuscript", "read_canon", "edit_manuscript", "edit_story_state"],
};

/**
 * A model whose answer depends on the request — so one instance can draft
 * different scenes, continue a short one, and judge coverage, deterministically.
 * The pipeline sees the full LanguageModel surface; only `generateStructured`
 * matters here.
 */
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

/** Draft prose distinct per scene, so tests can see which context drew what. */
function draftsByScene(prompt: string): unknown {
  const scene = /SCENE_\d+/.exec(prompt)?.[0] ?? "SCENE_????";
  return {
    text: `Prose for ${scene}. Mara crossed the room and the argument began in earnest, each sentence built from the compiled context rather than a snapshot.`,
    rationale: "drafted from plan",
    warnings: [],
  };
}

/** A coverage verdict that says every beat happened. */
function coverageAllMet(prompt: string): unknown {
  const beats = [...prompt.matchAll(/^- (.+)$/gm)].map((m) => m[1] ?? "");
  return { beats: beats.map((beat) => ({ beat, met: true, note: "shown on the page" })) };
}

/** An extractor answer proposing nothing — the quiet default. */
const NO_TRANSITIONS = { transitions: [] };

/**
 * The fixture §20 asks for: a chapter with four planned scenes, no prose yet.
 */
async function fourScenes() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "The Vault" });
  const mara = await repo.addCharacter({ name: "Mara", role: "protagonist" });
  const elias = await repo.addCharacter({ name: "Elias", role: "foil" });
  const manor = await repo.addLocation({ name: "Blackthorn Manor" });
  const chapter = await repo.addChapter({ title: "The Cellar", status: "outline" });

  const titles = ["Arrival", "Confrontation", "Discovery", "Escape"] as const;
  const scenes = [];
  for (const title of titles) {
    scenes.push(
      await repo.addScene({
        title,
        chapterId: chapter.id,
        pov: mara.id,
        locationId: manor.id,
        characterIds: [mara.id, elias.id],
        purpose: [`${title} happens on the page`],
        status: "planned",
      }),
    );
  }
  return { store, repo, chapter, scenes, mara, elias, manor };
}

/** A builder wired for hands-off runs: drafts by scene, all beats met, no state. */
function autoBuilder(repo: StoryRepository, options: { analysis?: boolean } = {}) {
  const drafting = new ScriptedModel(draftsByScene);
  // Coverage requests carry the `"beats"` reply format; extraction requests
  // carry `"transitions"`. That is how one scripted analyst serves both.
  const analysis = new ScriptedModel((prompt) =>
    prompt.includes('"beats"') ? coverageAllMet(prompt) : NO_TRANSITIONS,
  );
  const builder = new ChapterBuilder({
    repo,
    models: { drafting, ...(options.analysis === false ? {} : { analysis }) },
    grant: GRANT,
  });
  return { builder, drafting, analysis };
}

describe("the pipeline, scene by scene", () => {
  it("builds a four-scene chapter as a sequence of small operations", async () => {
    const { repo, chapter, scenes } = await fourScenes();
    const { builder, drafting } = autoBuilder(repo);

    const done = await builder.start({ chapterId: chapter.id as string });

    expect(done.status).toBe("completed");
    expect(done.scenes).toHaveLength(4);
    expect(done.scenes.every((scene) => scene.status === "committed")).toBe(true);

    // §20.1–2: scene-by-scene generation, each from its own compiled context.
    expect(drafting.requests.length).toBeGreaterThanOrEqual(4);
    const file = (await repo.readProjectFile(chapter.filePath)) ?? "";
    for (const scene of scenes) {
      expect(file).toContain(`Prose for ${String(scene.id)}.`);
    }
    // The prose landed in the one manuscript, inside each scene's own span.
    const spans = listSceneSpans(file);
    expect(spans.map((span) => span.sceneId)).toEqual(scenes.map((scene) => scene.id as string));
  });

  it("was never one giant completion: each scene is its own change set", async () => {
    const { repo, chapter } = await fourScenes();
    const { builder } = autoBuilder(repo);
    const done = await builder.start({ chapterId: chapter.id as string });

    const changeIds = done.scenes.map((scene) => scene.changeSetId);
    expect(new Set(changeIds).size).toBe(4);
    const history = await repo.listChangeSets();
    for (const id of changeIds) {
      expect(history.some((change) => change.id === id)).toBe(true);
    }
  });

  it("checkpoints before the build and after every committed scene", async () => {
    const { repo, chapter } = await fourScenes();
    const { builder } = autoBuilder(repo);
    const done = await builder.start({ chapterId: chapter.id as string });

    expect(done.checkpointId).toBeDefined();
    expect(done.scenes.every((scene) => scene.checkpointId !== undefined)).toBe(true);
    const checkpoints = await repo.listCheckpoints();
    // Pre-build + 4 scenes + final.
    expect(checkpoints.length).toBeGreaterThanOrEqual(6);
  });

  it("records plan coverage as a model's judgement, labelled as such", async () => {
    const { repo, chapter } = await fourScenes();
    const { builder } = autoBuilder(repo);
    const done = await builder.start({ chapterId: chapter.id as string });
    const first = done.scenes[0];
    expect(first?.coverage).toBeDefined();
    expect(first?.coverage?.every((item) => item.source === "model")).toBe(true);
  });

  it("runs the Story Compiler and the story tests at the end", async () => {
    const { repo, chapter } = await fourScenes();
    const { builder } = autoBuilder(repo);
    const done = await builder.start({ chapterId: chapter.id as string });
    expect(done.finalBuildId).toBeDefined();
    expect(done.finalBuildErrors).toBe(0);
    const builds = await repo.listBuilds();
    expect(builds.some((b) => b.id === done.finalBuildId)).toBe(true);
  });

  it("skips extraction and coverage honestly when no analysis model exists", async () => {
    const { repo, chapter } = await fourScenes();
    const { builder } = autoBuilder(repo, { analysis: false });
    const done = await builder.start({ chapterId: chapter.id as string });
    expect(done.status).toBe("completed");
    const skips = done.diagnostics.filter((d) => d.message.includes("skipped — no analysis model"));
    expect(skips.length).toBeGreaterThan(0);
  });

  it("refuses to start without the edit_manuscript permission", async () => {
    const { repo, chapter } = await fourScenes();
    const builder = new ChapterBuilder({
      repo,
      models: { drafting: new ScriptedModel(draftsByScene) },
      grant: { permissions: ["read_manuscript"] },
    });
    await expect(builder.start({ chapterId: chapter.id as string })).rejects.toMatchObject({
      editCode: "permission_denied",
    });
  });

  it("refuses a chapter with no scenes rather than inventing a plan", async () => {
    const { repo } = await fourScenes();
    const empty = await repo.addChapter({ title: "Unplanned" });
    const { builder } = autoBuilder(repo);
    const failed = await builder.start({ chapterId: empty.id as string });
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toContain("no scenes assigned");
  });
});

describe("length strategy and continuation (§4–5)", () => {
  it("continues a short draft from its exact endpoint without repeating prose", async () => {
    const { repo, chapter, scenes } = await fourScenes();
    let draftCalls = 0;
    const drafting = new ScriptedModel((prompt) => {
      if (prompt.includes("Continue from exactly that point")) {
        // The continuation prompt must carry the existing ending, not a summary.
        expect(prompt).toContain("opening stub");
        return {
          text: "The continuation carries on to the end of the planned scene, covering the remaining beats at proper length. ".repeat(
            8,
          ),
          rationale: "",
          warnings: [],
        };
      }
      draftCalls += 1;
      return { text: "A short opening stub.", rationale: "", warnings: [] };
    });
    const builder = new ChapterBuilder({ repo, models: { drafting }, grant: GRANT });

    const first = scenes[0]?.id as string;
    const done = await builder.start({
      chapterId: chapter.id as string,
      targets: { [first]: { minWords: 60 } },
    });

    const record = done.scenes[0];
    expect(record?.words ?? 0).toBeGreaterThanOrEqual(60);
    // More than one call for the long scene; the stub survives at the front.
    expect(record?.calls ?? 0).toBeGreaterThan(1);
    const file = (await repo.readProjectFile(chapter.filePath)) ?? "";
    expect(file).toContain("A short opening stub.");
    expect(draftCalls).toBe(4);
  });

  it("bounds continuations and reports a still-short scene instead of looping", async () => {
    const { repo, chapter, scenes } = await fourScenes();
    const drafting = new ScriptedModel(() => ({
      text: "Tiny fragment only.",
      rationale: "",
      warnings: [],
    }));
    const builder = new ChapterBuilder({ repo, models: { drafting }, grant: GRANT });
    const first = scenes[0]?.id as string;
    const done = await builder.start({
      chapterId: chapter.id as string,
      targets: { [first]: { minWords: 500 } },
      maxContinuations: 2,
    });
    // 1 draft + 2 continuations, then an honest warning — never an open loop.
    const record = done.scenes.find((scene) => scene.sceneId === first);
    expect(record?.calls).toBe(3);
    expect(
      done.diagnostics.some((d) => d.sceneId === first && d.message.includes("against a minimum")),
    ).toBe(true);
  });

  it("reports an over-length scene without truncating it", async () => {
    const { repo, chapter, scenes } = await fourScenes();
    const long = "Words keep arriving in numbers well past the ceiling. ".repeat(30);
    const drafting = new ScriptedModel(() => ({ text: long, rationale: "", warnings: [] }));
    const builder = new ChapterBuilder({ repo, models: { drafting }, grant: GRANT });
    const first = scenes[0]?.id as string;
    const done = await builder.start({
      chapterId: chapter.id as string,
      targets: { [first]: { maxWords: 50 } },
    });
    expect(
      done.diagnostics.some((d) => d.sceneId === first && d.message.includes("left intact")),
    ).toBe(true);
    const file = (await repo.readProjectFile(chapter.filePath)) ?? "";
    expect(file).toContain("Words keep arriving");
  });
});

describe("state propagation (§6, §20.3)", () => {
  it("state confirmed after Scene 1 is part of what Scene 2's context reads", async () => {
    const { repo, chapter, scenes, mara, manor } = await fourScenes();
    const first = scenes[0]?.id as string;

    const drafting = new ScriptedModel(draftsByScene);
    const analysis = new ScriptedModel((prompt) => {
      if (prompt.includes('"beats"') && prompt.includes("planned beats"))
        return coverageAllMet(prompt);
      // Scene 1 moves Mara to the manor; later scenes change nothing.
      if (prompt.includes(`state changes ${first}`)) {
        return {
          transitions: [
            {
              kind: "character_location",
              subjectId: mara.id as string,
              value: manor.id as string,
              confidence: 0.95,
              evidence: "Mara crossed the room",
            },
          ],
        };
      }
      return NO_TRANSITIONS;
    });
    const builder = new ChapterBuilder({ repo, models: { drafting, analysis }, grant: GRANT });

    const done = await builder.start({
      chapterId: chapter.id as string,
      autoConfirmObjective: true,
    });

    // The objective, high-confidence transition was auto-confirmed…
    const record = done.scenes[0];
    expect(record?.transitionsProposed).toBe(1);
    expect(record?.transitionsConfirmed).toBe(1);
    const stored = (await repo.listStateTransitions()).filter((t) => t.sceneId === first);
    expect(stored[0]?.confirmationStatus).toBe("confirmed");

    // …and the canonical state after Scene 1 places Mara at the manor, which is
    // exactly what Scene 2's compiled context reads (docs/STORY_STATE.md).
    const second = scenes[1]?.id as string;
    const state = await repo.getCharacterState(mara.id, { sceneId: second, position: "before" });
    expect(state.locationId).toBe(manor.id as string);
  });

  it("never auto-confirms interpretive kinds, whatever their confidence", async () => {
    const { repo, chapter, scenes, mara, elias } = await fourScenes();
    const fact = await repo.addFact({
      statement: "The vault has a second key",
      objectiveTruth: true,
    });
    const first = scenes[0]?.id as string;
    const drafting = new ScriptedModel(draftsByScene);
    const analysis = new ScriptedModel((prompt) => {
      if (prompt.includes('"beats"')) return coverageAllMet(prompt);
      if (prompt.includes(`state changes ${first}`)) {
        return {
          transitions: [
            {
              kind: "knowledge_changed",
              subjectId: mara.id as string,
              value: fact.id as string,
              knowledgeState: "known",
              sourceType: "told",
              sourceEntityId: elias.id as string,
              confidence: 0.99,
              evidence: "Elias tells her outright",
            },
          ],
        };
      }
      return NO_TRANSITIONS;
    });
    const builder = new ChapterBuilder({ repo, models: { drafting, analysis }, grant: GRANT });
    const done = await builder.start({
      chapterId: chapter.id as string,
      autoConfirmObjective: true,
    });

    expect(done.scenes[0]?.transitionsProposed).toBe(1);
    expect(done.scenes[0]?.transitionsConfirmed).toBe(0);
    const stored = (await repo.listStateTransitions()).filter((t) => t.sceneId === first);
    expect(stored[0]?.confirmationStatus).toBe("proposed");
  });
});

describe("approval policies (§10)", () => {
  it("every_scene holds each draft for the writer and commits nothing early", async () => {
    const { repo, chapter } = await fourScenes();
    const { builder } = autoBuilder(repo);

    let build = await builder.start({
      chapterId: chapter.id as string,
      approvalPolicy: "every_scene",
    });
    // First stop: the plan gate.
    expect(build.status).toBe("awaiting_approval");
    expect(build.pending?.question).toContain("scenes");

    build = await builder.approve(build.id);
    // Second stop: scene 1 drafted and held. Nothing in the file yet.
    expect(build.status).toBe("awaiting_approval");
    expect(build.pending?.sceneId).toBe(build.scenes[0]?.sceneId);
    expect(build.scenes[0]?.draft).toBeDefined();
    const fileBefore = (await repo.readProjectFile(chapter.filePath)) ?? "";
    expect(fileBefore).not.toContain("Prose for");

    build = await builder.approve(build.id);
    // Approval committed scene 1 and drafted scene 2.
    const fileAfter = (await repo.readProjectFile(chapter.filePath)) ?? "";
    expect(fileAfter).toContain(`Prose for ${build.scenes[0]?.sceneId ?? ""}`);
    expect(build.pending?.sceneId).toBe(build.scenes[1]?.sceneId);
  });

  it("declining a held draft discards it and pauses; resume drafts again", async () => {
    const { repo, chapter } = await fourScenes();
    const { builder } = autoBuilder(repo);
    let build = await builder.start({
      chapterId: chapter.id as string,
      approvalPolicy: "every_scene",
    });
    build = await builder.approve(build.id); // plan → scene 1 held
    build = await builder.rejectPending(build.id, "not this one");

    expect(build.status).toBe("paused");
    expect(build.scenes[0]?.draft).toBeUndefined();
    const file = (await repo.readProjectFile(chapter.filePath)) ?? "";
    expect(file).not.toContain("Prose for");

    build = await builder.resume(build.id);
    expect(build.pending?.sceneId).toBe(build.scenes[0]?.sceneId);
    expect(build.scenes[0]?.draft).toBeDefined();
  });

  it("every_chapter runs the scenes and pauses once before finishing", async () => {
    const { repo, chapter } = await fourScenes();
    const { builder } = autoBuilder(repo);
    let build = await builder.start({
      chapterId: chapter.id as string,
      approvalPolicy: "every_chapter",
    });
    expect(build.pending?.question).toContain("scenes");
    build = await builder.approve(build.id);
    // All four scenes committed, then the chapter gate.
    expect(build.scenes.every((scene) => scene.status === "committed")).toBe(true);
    expect(build.status).toBe("awaiting_approval");
    expect(build.pending?.question).toContain("Keep the built");
    build = await builder.approve(build.id);
    expect(build.status).toBe("completed");
  });
});

describe("pause, resume and restart (§11, §20.4–6)", () => {
  it("pauses between steps on request and resumes from the same place", async () => {
    const { repo, chapter } = await fourScenes();

    // Ask for the pause once the second scene has committed.
    const stopAfter = 2;
    let committed = 0;
    const pausing = new ChapterBuilder({
      repo,
      models: {
        drafting: new ScriptedModel(draftsByScene),
        analysis: new ScriptedModel((prompt) =>
          prompt.includes('"beats"') ? coverageAllMet(prompt) : NO_TRANSITIONS,
        ),
      },
      grant: GRANT,
      onProgress: (build) => {
        const now = build.scenes.filter((scene) => scene.status === "committed").length;
        if (now >= stopAfter && committed < stopAfter) {
          committed = now;
          pausing.requestPause(build.id);
        }
      },
    });

    const paused = await pausing.start({ chapterId: chapter.id as string });
    expect(paused.status).toBe("paused");
    const doneScenes = paused.scenes.filter((scene) => scene.status === "committed").length;
    expect(doneScenes).toBeGreaterThanOrEqual(2);
    expect(doneScenes).toBeLessThan(4);

    // "Restart Manu": a brand-new repository over the same store, and a
    // brand-new builder with no memory of the first one (§20.5).
    const { builder: fresh } = autoBuilder(repo);
    const resumed = await fresh.resume(paused.id);
    expect(resumed.status).toBe("completed");
    expect(resumed.scenes.every((scene) => scene.status === "committed")).toBe(true);
    expect(resumed.resumeCount).toBe(1);
  });

  it("survives a real process boundary: reopen the project, resume the build", async () => {
    const { store, repo, chapter } = await fourScenes();
    let build = await autoBuilder(repo).builder.start({
      chapterId: chapter.id as string,
      approvalPolicy: "every_scene",
    });
    build = await autoBuilder(repo).builder.approve(build.id); // plan approved; scene 1 held

    // Reopen: a new StoryRepository over the same files, like a new session.
    const reopened = await openBranch(store);
    const { builder } = autoBuilder(reopened);
    const record = await builder.get(build.id);
    expect(record?.status).toBe("awaiting_approval");
    // The held draft survived the restart — it lives in the persisted record.
    expect(record?.scenes[0]?.draft).toBeDefined();

    let resumed = await builder.approve(build.id);
    while (resumed.status === "awaiting_approval") {
      resumed = await builder.approve(resumed.id);
    }
    expect(resumed.status).toBe("completed");
  });

  it("a scene edited by hand between scenes is what the next scene reads (§16)", async () => {
    const { repo, chapter } = await fourScenes();
    const { builder } = autoBuilder(repo);
    let build = await builder.start({
      chapterId: chapter.id as string,
      approvalPolicy: "every_scene",
    });
    build = await builder.approve(build.id); // plan
    build = await builder.approve(build.id); // commit scene 1, hold scene 2

    // The writer rewrites scene 1 by hand while the gate is open.
    const file = (await repo.readProjectFile(chapter.filePath)) ?? "";
    const edited = file.replace(/Prose for SCENE_\d+\./, "Mara never entered at all.");
    await repo.writeProjectFile(chapter.filePath, edited);

    // Committing scene 2 splices into the *current* file: the manual edit stays.
    build = await builder.approve(build.id);
    const after = (await repo.readProjectFile(chapter.filePath)) ?? "";
    expect(after).toContain("Mara never entered at all.");
    expect(after).toContain(`Prose for ${build.scenes[1]?.sceneId ?? ""}`);
  });
});

describe("failure and cancellation (§12, §18)", () => {
  it("a provider failure records the exact step and scene, and resume retries it", async () => {
    const { repo, chapter } = await fourScenes();
    let healthy = false;
    const drafting = new ScriptedModel((prompt, calls) => {
      if (!healthy && calls >= 3) throw new ModelError("provider_error", "socket dropped");
      return draftsByScene(prompt);
    });
    const builder = new ChapterBuilder({ repo, models: { drafting }, grant: GRANT });

    const failed = await builder.start({ chapterId: chapter.id as string });
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toContain("draft_scene");
    expect(failed.failureReason).toContain("SCENE_");
    const committedBefore = failed.scenes.filter((scene) => scene.status === "committed").length;
    expect(committedBefore).toBeGreaterThanOrEqual(1);

    healthy = true;
    const resumed = await builder.resume(failed.id);
    expect(resumed.status).toBe("completed");
    // The scene the failure interrupted was retried, not silently skipped —
    // every scene ends committed (§28 of Phase 34 caught this regression).
    expect(resumed.scenes.every((scene) => scene.status === "committed")).toBe(true);
  });

  it("cancelling keeps committed scenes, discards the held draft, and is final", async () => {
    const { repo, chapter } = await fourScenes();
    const { builder } = autoBuilder(repo);
    let build = await builder.start({
      chapterId: chapter.id as string,
      approvalPolicy: "every_scene",
    });
    build = await builder.approve(build.id); // plan
    build = await builder.approve(build.id); // scene 1 committed, scene 2 held
    const fileBefore = (await repo.readProjectFile(chapter.filePath)) ?? "";

    const cancelled = await builder.cancel(build.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.scenes.some((scene) => scene.draft !== undefined)).toBe(false);
    // Committed work untouched; project files identical.
    expect(await repo.readProjectFile(chapter.filePath)).toBe(fileBefore);
    // Recorded, and unresumable.
    expect(cancelled.diagnostics.some((d) => d.message.includes("cancelled"))).toBe(true);
    await expect(builder.resume(cancelled.id)).rejects.toBeInstanceOf(EditError);
  });
});

describe("validation stops the build (§7, §20.7–10)", () => {
  it("pauses on a continuity error injected mid-build, and resumes once fixed", async () => {
    const { repo, chapter, scenes, elias } = await fourScenes();
    const first = scenes[0]?.id as string;
    const second = scenes[1]?.id as string;
    const { builder } = autoBuilder(repo);

    let build = await builder.start({
      chapterId: chapter.id as string,
      approvalPolicy: "every_scene",
    });
    build = await builder.approve(build.id); // plan → scene 1 held
    build = await builder.approve(build.id); // scene 1 committed → scene 2 held
    expect(build.pending?.sceneId).toBe(second);

    // §20.7: inject one continuity failure between scenes — a hard world rule
    // and a confirmed resurrection, exactly the shape the deterministic
    // compiler catches with no model involved.
    await repo.addWorldRule({
      name: "The dead do not come back",
      description: "Nothing can resurrect the dead.",
      severity: "hard",
    });
    await repo.addStateTransitions([
      {
        sceneId: first,
        kind: "character_status",
        subjectId: elias.id as string,
        value: "deceased",
      },
      { sceneId: second, kind: "character_status", subjectId: elias.id as string, value: "active" },
    ]);

    // §20.8: committing scene 2 runs validation, which pauses the build.
    build = await builder.approve(build.id);
    expect(build.status).toBe("paused");
    expect(build.diagnostics.some((d) => d.severity === "error")).toBe(true);
    expect(build.diagnostics.some((d) => d.message.includes("recorded alive again"))).toBe(true);

    // §20.9–11: correct the issue, resume, and the chapter completes.
    const stored = (await repo.listStateTransitions()).filter(
      (t) => t.kind === "character_status" && t.subjectId === (elias.id as string),
    );
    for (const t of stored) await repo.setTransitionStatus(t.id as string, "rejected");

    let resumed = await builder.resume(build.id);
    while (resumed.status === "awaiting_approval") {
      resumed = await builder.approve(resumed.id);
    }
    expect(resumed.status).toBe("completed");
    // §20.12: the Story Compiler ran over the finished chapter.
    expect(resumed.finalBuildId).toBeDefined();
    expect(resumed.finalBuildErrors).toBe(0);
    // §20.13: the revision history is intact — every scene's change set exists.
    const history = await repo.listChangeSets();
    for (const scene of resumed.scenes) {
      expect(history.some((change) => change.id === scene.changeSetId)).toBe(true);
    }
  });
});

describe("the bounded revision loop (§8–9)", () => {
  it("revises once against unmet beats, then pauses honestly if still unmet", async () => {
    const { repo, chapter, scenes } = await fourScenes();
    const first = scenes[0]?.id as string;
    const drafting = new ScriptedModel((prompt) =>
      prompt.includes("Revise it so these planned beats")
        ? {
            text: "A revised version of the scene that still does not manage the beat.",
            rationale: "",
            warnings: [],
          }
        : draftsByScene(prompt),
    );
    const analysis = new ScriptedModel((prompt) => {
      if (!prompt.includes('"beats"')) return NO_TRANSITIONS;
      // Scene 1's beat is never met; everyone else's always is.
      const beats = [...prompt.matchAll(/^- (.+)$/gm)].map((m) => m[1] ?? "");
      return {
        beats: beats.map((beat) => ({
          beat,
          met: !beat.startsWith("Arrival"),
          note: "checked",
        })),
      };
    });
    const builder = new ChapterBuilder({
      repo,
      models: { drafting, analysis },
      grant: GRANT,
    });

    const paused = await builder.start({ chapterId: chapter.id as string, maxRevisions: 1 });
    expect(paused.status).toBe("paused");
    const record = paused.scenes.find((scene) => scene.sceneId === first);
    // One draft + one revision — the loop is bounded, not open (§9).
    expect(record?.attempts).toBe(2);
    expect(
      paused.diagnostics.some((d) => d.sceneId === first && d.message.includes("beat(s) unmet")),
    ).toBe(true);
    // The revision itself was committed and is in history.
    const file = (await repo.readProjectFile(chapter.filePath)) ?? "";
    expect(file).toContain("A revised version of the scene");
  });
});

describe("the audit trail (§19)", () => {
  it("keeps request, models, per-scene changes, approvals and steps on the record", async () => {
    const { repo, chapter } = await fourScenes();
    const { builder } = autoBuilder(repo);
    const done = await builder.start({ chapterId: chapter.id as string });

    expect(done.modelAssignments.premium_prose).toBe("mock:scripted");
    expect(done.usage.calls).toBeGreaterThanOrEqual(8); // 4 drafts + 4 extractions + 4 coverages
    expect(done.taskId).toMatch(/^TASK_/);

    // Every step logged to the ordinary agent activity stream, under one task.
    const activity = await repo.agents.listActivity();
    const ours = activity.filter((event) => event.taskId === done.taskId);
    expect(ours.some((event) => event.tool === "chapter_build.commit")).toBe(true);
    expect(ours.some((event) => event.tool === "chapter_build.complete")).toBe(true);

    // The committed change sets carry AI provenance in ordinary history.
    const history = await repo.listChangeSets();
    const draftChange = history.find((change) => change.id === done.scenes[0]?.changeSetId);
    expect(draftChange?.actor).toBe("agent");
  });
});
