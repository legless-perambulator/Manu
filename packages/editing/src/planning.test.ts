import { describe, expect, it } from "vitest";
import type { PermissionGrant } from "@jellytind/agent-runtime";
import { InMemoryProjectStore } from "@jellytind/persistence";
import {
  MockLanguageModel,
  type GenerateRequest,
  type LanguageModel,
  type RequestOptions,
  type StructuredRequest,
} from "@jellytind/model-router";
import { StoryRepository } from "@jellytind/story-repository";
import { ChapterBuilder } from "./chapter-builder";
import { PlanArchitect } from "./plan-architect";

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
  readonly id = "mock:planner";
  readonly capabilities = { streaming: true, structuredOutput: true, tools: true };
  readonly requests: string[] = [];
  private readonly fallback = new MockLanguageModel({});

  constructor(private readonly respond: (prompt: string) => unknown) {}

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
    return Promise.resolve(request.schema.parse(this.respond(prompt)));
  }
}

/**
 * §17's given: a ten-chapter outline, story state up to Chapter 5, Chapter 6
 * empty.
 */
async function tenChapters() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "The Vault" });
  const mara = await repo.addCharacter({ name: "Mara" });
  const elias = await repo.addCharacter({ name: "Elias" });
  const cellar = await repo.addLocation({ name: "The Cellar" });
  const keyFact = await repo.addFact({ statement: "There is a brass key behind the panel" });
  const opensFact = await repo.addFact({ statement: "The key opens the vault under the chapel" });
  const thread = await repo.addPlotThread({ name: "The vault investigation" });

  const chapters = [];
  for (let i = 1; i <= 10; i += 1) {
    chapters.push(await repo.addChapter({ title: `Chapter ${String(i)}`, order: i - 1 }));
  }
  // Prose and state exist up to Chapter 5; Elias learns of the key in Chapter 5.
  for (let i = 0; i < 5; i += 1) {
    const chapter = chapters[i];
    if (chapter === undefined) continue;
    const scene = await repo.addScene({
      title: `Events of ${chapter.title}`,
      chapterId: chapter.id,
      pov: mara.id,
      characterIds: [mara.id, elias.id],
      status: "drafted",
    });
    if (i === 4) {
      await repo.addStateTransitions([
        {
          sceneId: scene.id as string,
          kind: "knowledge_changed",
          subjectId: elias.id as string,
          value: keyFact.id as string,
          knowledgeState: "known",
          sourceType: "witnessed",
        },
      ]);
    }
  }
  const six = chapters[5];
  if (six === undefined) throw new Error("fixture broke");
  return { store, repo, mara, elias, cellar, keyFact, opensFact, thread, six };
}

/** The plan the "Story Architect" proposes for Chapter 6, per the instruction. */
function plannerAnswer(fixture: Awaited<ReturnType<typeof tenChapters>>): unknown {
  const { mara, elias, cellar, keyFact, opensFact, thread } = fixture;
  return {
    objective: "Mara discovers the key without understanding what it opens",
    chapterRole: "the turn from suspicion to possession",
    scenes: [
      {
        title: "The loose panel",
        pov: mara.id as string,
        locationId: cellar.id as string,
        characterIds: [mara.id as string],
        objective: "Mara finds the brass key",
        conflict: "The cellar is not hers to search",
        exitState: "Mara has the key and no idea of its purpose",
        beats: ["Mara pries the panel", "The key falls at her feet", "She pockets it unseen"],
        knowledgeChanges: [
          {
            characterId: mara.id as string,
            factId: keyFact.id as string,
            to: "known",
          },
        ],
        plotThreadIds: [thread.id as string],
        minWords: 30,
      },
      {
        title: "Questions at supper",
        pov: mara.id as string,
        characterIds: [mara.id as string, elias.id as string],
        objective: "Mara probes without revealing what she holds",
        conflict: "Elias watches her too closely",
        beats: ["Mara asks about the chapel", "Elias deflects", "Suspicion tightens"],
        plotThreadIds: [thread.id as string],
      },
    ],
    forbiddenFacts: [
      {
        factId: opensFact.id as string,
        characterId: mara.id as string,
        reason: "she must not yet understand what it opens",
      },
    ],
    constraints: ["The chapter stays inside one evening"],
    notes: [],
  };
}

describe("§17 — the acceptance scenario, end to end", () => {
  it("plans Chapter 6, survives review and edits, and hands the exact approved version to the builder", async () => {
    const fixture = await tenChapters();
    const { repo, six, mara, opensFact } = fixture;

    // «Plan Chapter 6. Mara needs to discover the key, but she must not yet
    // understand what it opens.»
    const architect = new PlanArchitect({
      repo,
      model: new ScriptedModel(() => plannerAnswer(fixture)),
      grant: GRANT,
    });
    const { plan, findings } = await architect.proposeChapterPlan({
      chapterId: six.id as string,
      instruction: "Mara needs to discover the key, but she must not yet understand what it opens.",
    });

    // 1–2: a structured plan with scenes was generated and stored as a draft.
    expect(plan.status).toBe("draft");
    expect(plan.version).toBe(1);
    expect(plan.scenes).toHaveLength(2);
    expect(plan.scenes[0]?.beats).toHaveLength(3);
    expect(plan.source).toBe("model");

    // 3: the knowledge constraint is recorded, structurally.
    expect(plan.forbiddenFacts).toEqual([
      {
        factId: opensFact.id as string,
        characterId: mara.id as string,
        reason: "she must not yet understand what it opens",
      },
    ]);

    // 4: the plan validates against current story state — no errors.
    expect(findings.filter((finding) => finding.severity === "error")).toHaveLength(0);

    // 5: the writer changes Scene 2 manually. An ordinary journaled save; the
    // plan becomes the writer's as much as the model's.
    const edited = plan.scenes.map((scene) =>
      scene.key === "s2"
        ? { ...scene, title: "Questions in the orchard", beats: [...scene.beats, "Mara lies"] }
        : scene,
    );
    const v2 = await repo.saveChapterPlan(
      { ...plan, scenes: edited, source: "mixed" },
      { note: "writer edited scene 2" },
    );
    expect(v2.version).toBe(2);

    // 6: approval materialises the scenes as records.
    const approved = await repo.approveChapterPlan(six.id as string);
    expect(approved.status).toBe("approved");
    expect(approved.approvedVersion).toBe(3);
    const scenes = (await repo.listScenes()).filter((scene) => scene.chapterId === six.id);
    expect(scenes.map((scene) => scene.title)).toEqual([
      "The loose panel",
      "Questions in the orchard",
    ]);
    expect(scenes[1]?.purpose).toContain("Mara lies");

    // 7: the Chapter Builder consumes exactly the approved version.
    const drafting = new ScriptedModel((prompt) => {
      // The plan's forbidden-knowledge constraint reaches every draft call.
      if (prompt.includes("Write the prose for")) {
        expect(prompt).toContain("must not yet understand");
      }
      const scene = /SCENE_\d+/.exec(prompt)?.[0] ?? "SCENE";
      return {
        text: `Prose for ${scene}, an evening of keys and unasked questions, held to the plan's constraints throughout the whole scene.`,
        rationale: "",
        warnings: [],
      };
    });
    const builder = new ChapterBuilder({ repo, models: { drafting }, grant: GRANT });
    const build = await builder.start({ chapterId: six.id as string });

    expect(build.status).toBe("completed");
    expect(build.planId).toBe(approved.id);
    expect(build.planVersion).toBe(approved.approvedVersion);
    expect(build.planConstraints?.some((c) => c.includes("must not yet understand"))).toBe(true);
    // The plan's word target flowed into the build.
    const first = build.scenes.find((scene) => scene.title === "The loose panel");
    expect(first?.target?.minWords).toBe(30);
  });

  it("a draft plan is not consumed: the builder says so and builds from records", async () => {
    const fixture = await tenChapters();
    const { repo, six } = fixture;
    const architect = new PlanArchitect({
      repo,
      model: new ScriptedModel(() => plannerAnswer(fixture)),
      grant: GRANT,
    });
    await architect.proposeChapterPlan({ chapterId: six.id as string });
    // Not approved — so the chapter still has no scene records, and a build
    // must refuse for lack of scenes rather than quietly reading the draft.
    const drafting = new ScriptedModel(() => ({ text: "x", rationale: "", warnings: [] }));
    const builder = new ChapterBuilder({ repo, models: { drafting }, grant: GRANT });
    const failed = await builder.start({ chapterId: six.id as string });
    expect(failed.status).toBe("failed");
    expect(failed.planId).toBeUndefined();
    expect(
      failed.diagnostics.some((d) => d.message.includes("only an approved plan is consumed")),
    ).toBe(true);
  });

  it("generation prunes invented IDs into the plan's notes instead of keeping them", async () => {
    const fixture = await tenChapters();
    const { repo, six } = fixture;
    const answer = plannerAnswer(fixture) as {
      scenes: Record<string, unknown>[];
    };
    (answer.scenes[0] as { characterIds: string[] }).characterIds.push("CHAR_9999");
    const architect = new PlanArchitect({
      repo,
      model: new ScriptedModel(() => answer),
      grant: GRANT,
    });
    const { plan } = await architect.proposeChapterPlan({ chapterId: six.id as string });
    expect(plan.scenes[0]?.characterIds).not.toContain("CHAR_9999");
    expect(plan.notes.some((note) => note.includes("CHAR_9999"))).toBe(true);
  });

  it("refuses generation without the edit_plans permission", async () => {
    const fixture = await tenChapters();
    const architect = new PlanArchitect({
      repo: fixture.repo,
      model: new ScriptedModel(() => plannerAnswer(fixture)),
      grant: { permissions: ["read_manuscript", "read_canon"] },
    });
    await expect(
      architect.proposeChapterPlan({ chapterId: fixture.six.id as string }),
    ).rejects.toMatchObject({ editCode: "permission_denied" });
  });
});

describe("plan-vs-draft comparison (§8)", () => {
  it("labels covered, partial and missed per element, plus the unexpected", async () => {
    const fixture = await tenChapters();
    const { repo, six } = fixture;
    const architect = new PlanArchitect({
      repo,
      model: new ScriptedModel((prompt) => {
        if (prompt.includes("THE PLAN")) {
          return {
            beats: [
              { beat: "Mara pries the panel", verdict: "covered", note: "on the page" },
              { beat: "The key falls at her feet", verdict: "partially_covered", note: "implied" },
              { beat: "She pockets it unseen", verdict: "missed", note: "not present" },
            ],
            unexpected: ["Mara hums the chapel hymn — could seed the vault reveal"],
          };
        }
        return plannerAnswer(fixture);
      }),
      grant: GRANT,
    });
    await architect.proposeChapterPlan({ chapterId: six.id as string });
    const approved = await repo.approveChapterPlan(six.id as string);
    // Put some prose in the first materialised scene's span.
    const chapter = (await repo.listChapters()).find((c) => c.id === six.id);
    const sceneId = approved.scenes[0]?.sceneId;
    if (chapter === undefined || sceneId === undefined) throw new Error("fixture broke");
    const file = (await repo.readProjectFile(chapter.filePath)) ?? "";
    await repo.writeProjectFile(
      chapter.filePath,
      `${file}\n<!-- scene: ${sceneId} -->\n\nMara worked the panel loose and hummed.\n`,
    );

    const coverage = await architect.comparePlanToDraft(six.id as string);
    const first = coverage.find((entry) => entry.sceneId === sceneId);
    expect(first?.beats.map((beat) => beat.verdict)).toEqual([
      "covered",
      "partially_covered",
      "missed",
    ]);
    expect(first?.beats.every((beat) => beat.source === "model")).toBe(true);
    expect(first?.unexpected[0]).toContain("chapel hymn");
  });
});
