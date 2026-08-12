import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { MockLanguageModel } from "@jellytind/model-router";
import type { PermissionGrant } from "@jellytind/agent-runtime";
import {
  applyHunks,
  buildHunks,
  computeLineDiff,
  findSceneSpan,
  listSceneSpans,
  resolveSceneRange,
  sceneMarker,
  StoryRepository,
} from "@jellytind/story-repository";
import { ManuscriptEditor } from "./manuscript-editor";
import { StateExtractor } from "./state-extractor";
import { validateProposalText } from "./proposal-schema";
import { EditError } from "./types";

const WRITE_GRANT: PermissionGrant = {
  permissions: ["read_manuscript", "read_canon", "edit_manuscript"],
};
const READ_ONLY: PermissionGrant = { permissions: ["read_manuscript", "read_canon"] };

/** Model that returns a fixed edit, structured exactly as the schema requires. */
const editor = (text: string, warnings: string[] = []) =>
  new MockLanguageModel({
    structured: { text, rationale: "Tightened the exchange.", warnings },
  });

/**
 * A small project with two marked scenes in one chapter. Deterministic, so the
 * whole propose → review → accept workflow is testable with no network.
 */
async function novel() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "The Vault" });

  const mara = await repo.addCharacter({ name: "Mara", role: "protagonist" });
  const elias = await repo.addCharacter({ name: "Elias", role: "foil" });
  const manor = await repo.addLocation({ name: "Blackthorn Manor" });
  const thread = await repo.addPlotThread({ name: "The missing photograph" });
  const chapter = await repo.addChapter({ title: "Openings", status: "drafted" });

  const sceneA = await repo.addScene({
    title: "The Argument",
    chapterId: chapter.id,
    pov: mara.id,
    locationId: manor.id,
    characterIds: [mara.id, elias.id],
    plotThreadIds: [thread.id],
    purpose: ["Mara refuses Elias's help"],
    status: "drafted",
  });
  const sceneB = await repo.addScene({
    title: "Aftermath",
    chapterId: chapter.id,
    pov: elias.id,
    characterIds: [elias.id],
    status: "drafted",
  });
  await repo.addRelationship({
    characterAId: mara.id,
    characterBId: elias.id,
    type: "rival",
    description: "Wary allies.",
  });

  const scaffold = (await repo.readProjectFile(chapter.filePath)) ?? "";
  const body = [
    sceneMarker(sceneA.id),
    "Mara turned away from Elias.",
    "The photograph was gone.",
    "",
    sceneMarker(sceneB.id),
    "Elias waited in the orchard.",
    "",
  ].join("\n");
  await repo.writeProjectFile(chapter.filePath, `${scaffold}\n${body}`);

  return { store, repo, chapter, sceneA, sceneB, mara, elias };
}

const build = async (model = editor("Mara said nothing at all.")) => {
  const fixture = await novel();
  const edits = new ManuscriptEditor({
    repo: fixture.repo,
    model,
    grant: WRITE_GRANT,
    now: () => "2026-01-01T00:00:00.000Z",
  });
  return { ...fixture, edits, model };
};

// ── Scene addressing ────────────────────────────────────────────────────────

describe("scene markers", () => {
  it("locates a marked scene's prose", () => {
    const text = `<!-- scene: SCENE_0001 -->\nfirst\n\n<!-- scene: SCENE_0002 -->\nsecond\n`;
    expect(listSceneSpans(text).map((s) => s.sceneId)).toEqual(["SCENE_0001", "SCENE_0002"]);
    const span = findSceneSpan(text, "SCENE_0001");
    expect(text.slice(span?.start, span?.end)).toBe("first\n\n");
    expect(findSceneSpan(text, "SCENE_0009")).toBeNull();
  });

  it("treats a lone unmarked scene as the whole chapter body", () => {
    const text = "---\nid: CHAPTER_0001\n---\n\nAll of it.\n";
    const resolved = resolveSceneRange(text, "SCENE_0001", {
      chapterSceneIds: ["SCENE_0001"],
      mode: "replace",
    });
    expect(resolved.ok).toBe(true);
    expect(resolved.ok && text.slice(resolved.start, resolved.end)).toBe("All of it.\n");
  });

  it("refuses to guess when an unmarked scene shares its chapter", () => {
    const resolved = resolveSceneRange("no markers here", "SCENE_0001", {
      chapterSceneIds: ["SCENE_0001", "SCENE_0002"],
      mode: "replace",
    });
    expect(resolved.ok).toBe(false);
    expect(resolved.ok === false && resolved.reason).toMatch(/not marked/);
  });

  it("appends after the last scene even when unmarked", () => {
    const text = "body\n";
    const resolved = resolveSceneRange(text, "SCENE_0002", {
      chapterSceneIds: ["SCENE_0001", "SCENE_0002"],
      mode: "append",
    });
    expect(resolved).toMatchObject({ ok: true, start: text.length, end: text.length });
  });
});

// ── Hunks ───────────────────────────────────────────────────────────────────

describe("diff hunks", () => {
  const before = "one\ntwo\nthree\nfour\n";
  const after = "one\nTWO\nthree\nFOUR\n";

  it("groups changed lines into addressable hunks", () => {
    const hunks = buildHunks(computeLineDiff(before, after));
    expect(hunks.map((h) => h.id)).toEqual(["h1", "h2"]);
    expect(hunks[0]?.added).toBe(1);
    expect(hunks[0]?.removed).toBe(1);
  });

  it("applies a subset of hunks exactly", () => {
    expect(applyHunks(before, after, ["h1", "h2"])).toBe(after);
    expect(applyHunks(before, after, [])).toBe(before);
    expect(applyHunks(before, after, ["h1"])).toBe("one\nTWO\nthree\nfour\n");
    expect(applyHunks(before, after, ["h2"])).toBe("one\ntwo\nthree\nFOUR\n");
  });
});

// ── The workflow ────────────────────────────────────────────────────────────

describe("rewrite_selection", () => {
  it("proposes without touching the project, then commits on accept", async () => {
    const { repo, edits, chapter, sceneA } = await build();
    const original = (await repo.readProjectFile(chapter.filePath)) ?? "";
    const start = original.indexOf("Mara turned away from Elias.");
    const changesBefore = (await repo.listChangeSets()).length;

    const proposal = await edits.propose({
      operation: "rewrite_selection",
      path: chapter.filePath,
      range: { start, end: start + "Mara turned away from Elias.".length },
      selectedText: "Mara turned away from Elias.",
      directive: "increase_tension",
      sceneId: sceneA.id,
    });

    // Nothing has changed yet — the model did not write to the file.
    expect(await repo.readProjectFile(chapter.filePath)).toBe(original);
    expect((await repo.listChangeSets()).length).toBe(changesBefore);
    expect(proposal.after).toContain("Mara said nothing at all.");
    expect(proposal.context.recipe).toBe("scene_rewrite");
    expect(proposal.hunks.length).toBeGreaterThan(0);

    const result = await edits.accept(proposal.id);
    expect(result.approval).toBe("accepted");
    expect(await repo.readProjectFile(chapter.filePath)).toBe(proposal.after);

    const change = await repo.getChangeSet(result.changeSetId);
    expect(change?.actor).toBe("agent");
    expect(change?.ai).toMatchObject({
      operation: "rewrite_selection",
      targetId: sceneA.id,
      directive: "increase_tension",
      contextRecipe: "scene_rewrite",
      approval: "accepted",
      modelId: "mock:test",
    });
    expect(change?.ai?.contextTokens).toBeGreaterThan(0);
    expect(change?.taskId).toBe(proposal.taskId);
  });

  it("leaves the project untouched when rejected", async () => {
    const { repo, edits, chapter, sceneA } = await build();
    const original = (await repo.readProjectFile(chapter.filePath)) ?? "";
    const start = original.indexOf("The photograph was gone.");
    const changesBefore = (await repo.listChangeSets()).length;

    const proposal = await edits.propose({
      operation: "rewrite_selection",
      path: chapter.filePath,
      range: { start, end: start + "The photograph was gone.".length },
      selectedText: "The photograph was gone.",
      directive: "shorten",
      sceneId: sceneA.id,
    });
    await edits.reject(proposal.id, "loses the beat");

    expect(await repo.readProjectFile(chapter.filePath)).toBe(original);
    expect((await repo.listChangeSets()).length).toBe(changesBefore);

    const task = await repo.agents.getTask(proposal.taskId);
    expect(task?.status).toBe("cancelled");
    const activity = await repo.agents.listActivity(proposal.taskId);
    expect(activity.at(-1)?.resultSummary).toMatch(/rejected: loses the beat/);
    expect(activity.at(-1)?.status).toBe("denied");
  });

  it("refuses a selection that no longer matches the file", async () => {
    const { edits, chapter, sceneA } = await build();
    await expect(
      edits.propose({
        operation: "rewrite_selection",
        path: chapter.filePath,
        range: { start: 0, end: 10 },
        selectedText: "something else entirely",
        directive: "rewrite",
        sceneId: sceneA.id,
      }),
    ).rejects.toMatchObject({ editCode: "stale_selection" });
  });

  it("compiles chapter context when the selection has no known scene", async () => {
    const { repo, edits, chapter } = await build();
    const original = (await repo.readProjectFile(chapter.filePath)) ?? "";
    const start = original.indexOf("Elias waited in the orchard.");
    const proposal = await edits.propose({
      operation: "rewrite_selection",
      path: chapter.filePath,
      range: { start, end: start + "Elias waited in the orchard.".length },
      selectedText: "Elias waited in the orchard.",
      directive: "expand",
    });
    expect(proposal.context.recipe).toBe("chapter_inspection");
    expect(proposal.targetId).toBe(chapter.id);
  });
});

describe("rewrite_scene", () => {
  it("replaces only the target scene's prose", async () => {
    const { repo, edits, chapter, sceneA, sceneB } = await build(
      editor("She let the silence hold.\n"),
    );
    const proposal = await edits.propose({
      operation: "rewrite_scene",
      sceneId: sceneA.id,
    });

    expect(proposal.after).toContain("She let the silence hold.");
    expect(proposal.after).not.toContain("Mara turned away from Elias.");
    // The other scene and its marker survive untouched.
    expect(proposal.after).toContain(sceneMarker(sceneB.id));
    expect(proposal.after).toContain("Elias waited in the orchard.");

    await edits.accept(proposal.id);
    const text = (await repo.readProjectFile(chapter.filePath)) ?? "";
    expect(text).toContain("She let the silence hold.");
    expect(text).toContain("Elias waited in the orchard.");
  });

  it("explains itself when a scene's prose cannot be located", async () => {
    const { repo, edits } = await build();
    const chapter = await repo.addChapter({ title: "Unmarked" });
    const first = await repo.addScene({ title: "A", chapterId: chapter.id });
    await repo.addScene({ title: "B", chapterId: chapter.id });

    await expect(
      edits.propose({ operation: "rewrite_scene", sceneId: first.id }),
    ).rejects.toMatchObject({ editCode: "unresolvable_range" });
  });
});

describe("continue_scene", () => {
  it("appends to the scene without altering what is there", async () => {
    const { repo, edits, chapter, sceneA } = await build(editor("The door closed behind her.\n"));
    const original = (await repo.readProjectFile(chapter.filePath)) ?? "";

    const proposal = await edits.propose({
      operation: "continue_scene",
      sceneId: sceneA.id,
      targetWords: 120,
    });
    expect(proposal.range.start).toBe(proposal.range.end);
    expect(proposal.after).toContain("Mara turned away from Elias.");
    expect(proposal.after).toContain("The door closed behind her.");
    expect(proposal.after.indexOf("The door closed behind her.")).toBeLessThan(
      proposal.after.indexOf(sceneMarker("SCENE_0002")),
    );

    await edits.accept(proposal.id);
    const after = (await repo.readProjectFile(chapter.filePath)) ?? "";
    expect(after).not.toBe(original);
    expect(after).toContain("The photograph was gone.");
  });
});

// ── Partial acceptance ──────────────────────────────────────────────────────

describe("partial acceptance", () => {
  it("commits only the chosen hunks and records that it was partial", async () => {
    const { repo, edits, chapter, sceneA } = await build(
      editor("Mara said nothing.\nThe frame hung empty.\n"),
    );
    const original = (await repo.readProjectFile(chapter.filePath)) ?? "";
    const selection = "Mara turned away from Elias.\nThe photograph was gone.";
    const start = original.indexOf(selection);

    const proposal = await edits.propose({
      operation: "rewrite_selection",
      path: chapter.filePath,
      range: { start, end: start + selection.length },
      selectedText: selection,
      directive: "shorten",
      sceneId: sceneA.id,
    });
    expect(proposal.hunks.length).toBeGreaterThan(0);

    const first = proposal.hunks[0];
    const result = await edits.accept(proposal.id, { hunkIds: [first?.id ?? "h1"] });

    if (proposal.hunks.length > 1) {
      expect(result.approval).toBe("partially_accepted");
      const change = await repo.getChangeSet(result.changeSetId);
      expect(change?.ai?.approval).toBe("partially_accepted");
      expect(change?.ai?.acceptedHunks).toBe(1);
      expect(change?.ai?.offeredHunks).toBe(proposal.hunks.length);
    } else {
      expect(result.approval).toBe("accepted");
    }
    expect(await repo.readProjectFile(chapter.filePath)).not.toBe(original);
  });

  it("refuses an empty acceptance rather than treating it as a rejection", async () => {
    const { edits, repo, chapter, sceneA } = await build();
    const original = (await repo.readProjectFile(chapter.filePath)) ?? "";
    const start = original.indexOf("Mara turned away from Elias.");
    const proposal = await edits.propose({
      operation: "rewrite_selection",
      path: chapter.filePath,
      range: { start, end: start + "Mara turned away from Elias.".length },
      selectedText: "Mara turned away from Elias.",
      directive: "rewrite",
      sceneId: sceneA.id,
    });

    await expect(edits.accept(proposal.id, { hunkIds: [] })).rejects.toMatchObject({
      editCode: "no_change",
    });
    // Still pending, so the author can decide properly.
    expect(edits.list().map((p) => p.id)).toContain(proposal.id);
  });
});

// ── Validation and failure ──────────────────────────────────────────────────

describe("response validation", () => {
  it("rejects empty, unchanged and runaway output", () => {
    expect(() => validateProposalText("   ", "original", { operation: "rewrite_scene" })).toThrow(
      EditError,
    );
    expect(() =>
      validateProposalText("original", "original", { operation: "rewrite_scene" }),
    ).toThrowError(/unchanged/);
    expect(() =>
      validateProposalText("x".repeat(20_000), "short", { operation: "rewrite_scene" }),
    ).toThrowError(/far beyond/);
  });

  it("strips code fences a model may wrap prose in", () => {
    expect(
      validateProposalText("```\nShe waited.\n```", "before", { operation: "rewrite_scene" }),
    ).toBe("She waited.");
  });

  it("fails the task and stages nothing when the model returns bad output", async () => {
    const { repo, edits, chapter, sceneA } = await build(editor("   "));
    const original = (await repo.readProjectFile(chapter.filePath)) ?? "";
    const start = original.indexOf("Mara turned away from Elias.");

    await expect(
      edits.propose({
        operation: "rewrite_selection",
        path: chapter.filePath,
        range: { start, end: start + "Mara turned away from Elias.".length },
        selectedText: "Mara turned away from Elias.",
        directive: "rewrite",
        sceneId: sceneA.id,
      }),
    ).rejects.toMatchObject({ editCode: "empty_response" });

    expect(await repo.readProjectFile(chapter.filePath)).toBe(original);
    expect((await repo.agents.listTasks())[0]?.status).toBe("failed");
  });

  it("surfaces a provider failure as a typed edit failure", async () => {
    const { repo, edits, chapter, sceneA } = await build(
      new MockLanguageModel({ failWith: "rate_limit" }),
    );
    const original = (await repo.readProjectFile(chapter.filePath)) ?? "";
    const start = original.indexOf("Mara turned away from Elias.");

    await expect(
      edits.propose({
        operation: "rewrite_selection",
        path: chapter.filePath,
        range: { start, end: start + "Mara turned away from Elias.".length },
        selectedText: "Mara turned away from Elias.",
        directive: "rewrite",
        sceneId: sceneA.id,
      }),
    ).rejects.toMatchObject({ editCode: "provider_failed" });
    expect(await repo.readProjectFile(chapter.filePath)).toBe(original);
  });
});

describe("permissions", () => {
  it("refuses to edit without the edit_manuscript permission", async () => {
    const fixture = await novel();
    const edits = new ManuscriptEditor({
      repo: fixture.repo,
      model: editor("anything"),
      grant: READ_ONLY,
    });
    await expect(
      edits.propose({ operation: "rewrite_scene", sceneId: fixture.sceneA.id }),
    ).rejects.toMatchObject({ editCode: "permission_denied" });
    // Nothing was asked of the model at all.
    expect((await fixture.repo.agents.listTasks()).length).toBe(0);
  });
});

// ── Reversibility ───────────────────────────────────────────────────────────

describe("reversibility", () => {
  it("an accepted AI edit can be reverted like any other change", async () => {
    const { repo, edits, chapter, sceneA } = await build();
    const original = (await repo.readProjectFile(chapter.filePath)) ?? "";
    const start = original.indexOf("Mara turned away from Elias.");

    const proposal = await edits.propose({
      operation: "rewrite_selection",
      path: chapter.filePath,
      range: { start, end: start + "Mara turned away from Elias.".length },
      selectedText: "Mara turned away from Elias.",
      directive: "rewrite",
      sceneId: sceneA.id,
    });
    const { changeSetId } = await edits.accept(proposal.id);
    expect(await repo.readProjectFile(chapter.filePath)).not.toBe(original);

    await repo.revertChangeSet(changeSetId);
    expect(await repo.readProjectFile(chapter.filePath)).toBe(original);
    expect((await repo.getChangeSet(changeSetId))?.status).toBe("reverted");
  });

  it("lists AI edits in history with their operation", async () => {
    const { repo, edits, sceneA } = await build(editor("She let the silence hold.\n"));
    const proposal = await edits.propose({ operation: "rewrite_scene", sceneId: sceneA.id });
    await edits.accept(proposal.id);

    const latest = (await repo.listChangeSets())[0];
    expect(latest?.actor).toBe("agent");
    expect(latest?.aiOperation).toBe("rewrite_scene");
  });
});

// ── AI state extraction ─────────────────────────────────────────────────────

describe("StateExtractor", () => {
  const STATE_GRANT: PermissionGrant = {
    permissions: ["read_manuscript", "read_canon", "edit_story_state"],
  };

  /** A project with the entities a state proposal can legitimately name. */
  async function withState() {
    const fixture = await novel();
    const { repo, mara, elias, sceneA } = fixture;
    const manor = (await repo.listLocations())[0];
    const key = await repo.addObject({ name: "Brass Key" });
    const vault = await repo.addFact({ statement: "A vault lies beneath the manor." });
    return { ...fixture, manor, key, vault, mara, elias, sceneA };
  }

  const extractionModel = (transitions: unknown[]) =>
    new MockLanguageModel({ structured: { transitions } });

  it("proposes transitions without making them canon", async () => {
    const { repo, mara, elias, manor, key, vault, sceneA } = await withState();
    const model = extractionModel([
      {
        kind: "character_location",
        subjectId: elias.id,
        value: manor?.id,
        confidence: 0.9,
        evidence: "Elias was already waiting.",
      },
      {
        kind: "knowledge_gained",
        subjectId: elias.id,
        value: vault.id,
        certainty: 0.7,
        howLearned: "told",
        confidence: 0.6,
        evidence: "Mara told him what lay beneath.",
      },
      {
        kind: "object_owner",
        subjectId: key.id,
        value: mara.id,
        confidence: 0.8,
        evidence: "She pocketed the key.",
      },
    ]);
    const extractor = new StateExtractor({ repo, model, grant: STATE_GRANT });

    const proposal = await extractor.analyseScene(sceneA.id);
    expect(proposal.transitions).toHaveLength(3);
    expect(proposal.rejected).toHaveLength(0);
    expect(proposal.contextRecipe).toBe("scene_inspection");

    // Stored, visible — and excluded from canonical state.
    const stored = await repo.listStateTransitions();
    expect(stored).toHaveLength(3);
    expect(stored.every((t) => t.confirmationStatus === "proposed")).toBe(true);
    expect(stored.every((t) => t.source === "agent" && t.modelId === "mock:test")).toBe(true);
    expect(stored[0]?.note).toMatch(/^Evidence:/);

    const timeline = await repo.getStoryTimeline();
    expect(timeline.characterStateAfterScene(elias.id, sceneA.id).locationId).toBeUndefined();
    expect(timeline.characterKnowledgeAfterScene(elias.id, sceneA.id)).toHaveLength(0);
  });

  it("makes a proposal canon only when confirmed", async () => {
    const { repo, elias, manor, sceneA } = await withState();
    const extractor = new StateExtractor({
      repo,
      model: extractionModel([
        {
          kind: "character_location",
          subjectId: elias.id,
          value: manor?.id,
          confidence: 0.9,
          evidence: "at the manor",
        },
      ]),
      grant: STATE_GRANT,
    });
    await extractor.analyseScene(sceneA.id);
    const [proposed] = await repo.listStateTransitions();

    await extractor.confirm(proposed?.id ?? "");
    const timeline = await repo.getStoryTimeline();
    expect(timeline.characterStateAfterScene(elias.id, sceneA.id).locationId).toBe(manor?.id);
  });

  it("keeps a rejected proposal out of state but visible", async () => {
    const { repo, elias, manor, sceneA } = await withState();
    const extractor = new StateExtractor({
      repo,
      model: extractionModel([
        {
          kind: "character_location",
          subjectId: elias.id,
          value: manor?.id,
          confidence: 0.4,
          evidence: "unclear",
        },
      ]),
      grant: STATE_GRANT,
    });
    await extractor.analyseScene(sceneA.id);
    const [proposed] = await repo.listStateTransitions();
    await extractor.reject(proposed?.id ?? "");

    expect((await repo.listStateTransitions())[0]?.confirmationStatus).toBe("rejected");
    const timeline = await repo.getStoryTimeline();
    expect(
      timeline.characterStateAfterScene(elias.id, sceneA.id, { include: "with_proposed" })
        .locationId,
    ).toBeUndefined();
  });

  it("sets aside drafts that name entities of the wrong kind", async () => {
    const { repo, elias, key, sceneA } = await withState();
    const extractor = new StateExtractor({
      repo,
      model: extractionModel([
        // A location that is actually an object — the hallucinated-ID failure.
        {
          kind: "character_location",
          subjectId: elias.id,
          value: key.id,
          confidence: 0.9,
          evidence: "nonsense",
        },
        { kind: "not_a_kind", subjectId: elias.id, value: "x", confidence: 0.2, evidence: "" },
      ]),
      grant: STATE_GRANT,
    });

    const proposal = await extractor.analyseScene(sceneA.id);
    expect(proposal.transitions).toHaveLength(0);
    expect(proposal.rejected).toHaveLength(2);
    expect(proposal.rejected[0]?.problem).toMatch(/needs a location value/);
    // Nothing unusable was persisted.
    expect(await repo.listStateTransitions()).toHaveLength(0);
  });

  it("requires the edit_story_state permission", async () => {
    const { repo, sceneA } = await withState();
    const extractor = new StateExtractor({
      repo,
      model: extractionModel([]),
      grant: { permissions: ["read_canon"] },
    });
    await expect(extractor.analyseScene(sceneA.id)).rejects.toMatchObject({
      editCode: "permission_denied",
    });
  });
});
