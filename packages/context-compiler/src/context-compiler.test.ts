import { describe, expect, it } from "vitest";
import { ContextCompiler, RECIPES } from "./compiler";
import { CompileError } from "./errors";
import { fixtureReader, FIXTURE_FILES, FIXTURE_SCENES } from "./fixture";
import { buildTimeline } from "./recipes/state";
import { buildChronology, temporalCandidates } from "./recipes/temporal";
import { renderContextPackage } from "./present";
import { adjacentChapters, adjacentScenes, orderScenes } from "./sequence";
import { estimateTokens } from "./tokens";
import { allItems, includedIds, section, type ContextPackage } from "./types";
import type { Scene } from "@jellytind/domain";

const compiler = () => new ContextCompiler(fixtureReader(), { now: () => "2026-01-01T00:00:00Z" });

/** IDs in one section — the handle these tests assert exact selection with. */
const ids = (pkg: ContextPackage, name: Parameters<typeof section>[1]): string[] =>
  (section(pkg, name)?.items ?? []).map((item) => item.id);

const reasonFor = (pkg: ContextPackage, id: string): string | undefined =>
  allItems(pkg).find((item) => item.id === id)?.provenance.reason;

describe("narrative order", () => {
  it("orders scenes by chapter order then project order", () => {
    const reader = fixtureReader();
    return Promise.all([reader.listScenes(), reader.listChapters()]).then(([scenes, chapters]) => {
      expect(orderScenes(scenes, chapters).map((s) => s.id)).toEqual([
        "SCENE_0001",
        "SCENE_0002",
        "SCENE_0003",
        "SCENE_0004",
      ]);
      expect(adjacentScenes(scenes, chapters, "SCENE_0002")).toMatchObject({
        previous: { id: "SCENE_0001" },
        next: { id: "SCENE_0003" },
      });
      // Adjacency crosses chapter boundaries; the story is one sequence.
      expect(adjacentScenes(scenes, chapters, "SCENE_0003").next?.id).toBe("SCENE_0004");
      expect(adjacentScenes(scenes, chapters, "SCENE_0001").previous).toBeUndefined();
      expect(adjacentChapters(chapters, "CHAPTER_0001").next?.id).toBe("CHAPTER_0002");
    });
  });
});

describe("scene_inspection recipe", () => {
  it("selects exactly the scene's own references", async () => {
    const pkg = await compiler().compile({
      recipe: "scene_inspection",
      targetId: "SCENE_0002",
    });

    expect(pkg.target).toEqual({ id: "SCENE_0002", kind: "scene", label: "The Argument" });
    expect(ids(pkg, "target")).toEqual(["SCENE_0002"]);
    expect(ids(pkg, "primaryText")).toEqual(["manuscript/CHAPTER_0001.md"]);
    expect(ids(pkg, "adjacentScenes")).toEqual(["SCENE_0001", "SCENE_0003"]);
    // POV first, then remaining participants — never the whole cast.
    expect(ids(pkg, "characters")).toEqual(["CHAR_0001", "CHAR_0002"]);
    expect(ids(pkg, "locations")).toEqual(["LOC_0001"]);
    expect(ids(pkg, "plotThreads")).toEqual(["THREAD_0001", "THREAD_0002"]);
    expect(ids(pkg, "worldRules")).toEqual(["RULE_0001", "RULE_0002"]);

    // Nothing unrelated leaks in.
    expect(includedIds(pkg)).not.toContain("CHAR_0003");
    expect(includedIds(pkg)).not.toContain("SCENE_0004");
    expect(includedIds(pkg)).not.toContain("notes/ideas.md");
    // Scene inspection carries no style material; that is the rewrite recipe.
    expect(section(pkg, "styleRules")).toBeUndefined();
  });

  it("gives every element a reason it was included", async () => {
    const pkg = await compiler().compile({ recipe: "scene_inspection", targetId: "SCENE_0002" });

    expect(reasonFor(pkg, "CHAR_0002")).toBe("participant in SCENE_0002");
    expect(reasonFor(pkg, "CHAR_0001")).toBe("POV character of SCENE_0002");
    expect(reasonFor(pkg, "SCENE_0001")).toBe("the scene immediately before SCENE_0002");
    expect(reasonFor(pkg, "SCENE_0003")).toBe("the scene immediately after SCENE_0002");
    expect(reasonFor(pkg, "LOC_0001")).toBe("setting of SCENE_0002");
    expect(reasonFor(pkg, "THREAD_0001")).toBe("plot thread carried by SCENE_0002");
    expect(reasonFor(pkg, "manuscript/CHAPTER_0001.md")).toBe(
      "prose of CHAPTER_0001, the chapter containing SCENE_0002",
    );
    expect(allItems(pkg).every((item) => item.provenance.reason !== "")).toBe(true);
  });

  it("records the chain of inclusion", async () => {
    const pkg = await compiler().compile({ recipe: "scene_inspection", targetId: "SCENE_0002" });
    const character = allItems(pkg).find((item) => item.id === "CHAR_0002");
    expect(character?.provenance.via).toEqual(["SCENE_0002"]);
    expect(character?.provenance.rule).toBe("participant_character");
  });

  it("rejects an unknown target", async () => {
    await expect(
      compiler().compile({ recipe: "scene_inspection", targetId: "SCENE_9999" }),
    ).rejects.toThrow(CompileError);
  });
});

describe("scene_rewrite recipe", () => {
  it("adds style and character-voice material to scene inspection", async () => {
    const inspection = await compiler().compile({
      recipe: "scene_inspection",
      targetId: "SCENE_0002",
    });
    const rewrite = await compiler().compile({ recipe: "scene_rewrite", targetId: "SCENE_0002" });

    // A superset: everything inspection chose is still present.
    for (const id of includedIds(inspection)) {
      expect(includedIds(rewrite)).toContain(id);
    }

    expect(ids(rewrite, "styleRules")).toEqual([
      "style/pacing.md",
      "style/voice.md",
      "style/examples/CHAR_0001-dialogue.md",
      "style/examples/elias-monologue.md",
    ]);
    expect(reasonFor(rewrite, "style/examples/CHAR_0001-dialogue.md")).toBe(
      "voice material for CHAR_0001, who narrates SCENE_0002",
    );
    expect(reasonFor(rewrite, "style/examples/elias-monologue.md")).toBe(
      "voice material for CHAR_0002, who speaks in SCENE_0002",
    );
  });

  it("pulls voice material only for characters in the scene", async () => {
    // SCENE_0004 has only Mara, so Elias's voice example must not appear.
    const pkg = await compiler().compile({ recipe: "scene_rewrite", targetId: "SCENE_0004" });
    expect(ids(pkg, "styleRules")).toEqual([
      "style/pacing.md",
      "style/voice.md",
      "style/examples/CHAR_0001-dialogue.md",
    ]);
  });
});

describe("chapter_inspection recipe", () => {
  it("selects the chapter's scenes, neighbours, cast and active threads", async () => {
    const pkg = await compiler().compile({
      recipe: "chapter_inspection",
      targetId: "CHAPTER_0001",
    });

    expect(ids(pkg, "target")).toEqual(["CHAPTER_0001"]);
    expect(ids(pkg, "primaryText")).toEqual(["manuscript/CHAPTER_0001.md"]);
    expect(ids(pkg, "adjacentScenes")).toEqual([
      "SCENE_0001",
      "SCENE_0002",
      "SCENE_0003",
      "CHAPTER_0002",
    ]);
    expect(ids(pkg, "characters")).toEqual(["CHAR_0001", "CHAR_0002", "CHAR_0003"]);
    // THREAD_0003 is resolved, so it is not an *active* thread.
    expect(ids(pkg, "plotThreads")).toEqual(["THREAD_0001", "THREAD_0002"]);
    expect(reasonFor(pkg, "CHAR_0003")).toBe("appears in 1 scene(s) of CHAPTER_0001: SCENE_0003");
  });

  it("brings neighbouring chapters in as summaries, never as prose", async () => {
    const pkg = await compiler().compile({
      recipe: "chapter_inspection",
      targetId: "CHAPTER_0002",
    });
    const previous = allItems(pkg).find((item) => item.id === "CHAPTER_0001");
    expect(previous?.provenance.reason).toBe(
      "summary of the chapter immediately before CHAPTER_0002",
    );
    expect(previous?.text).toContain("derived summary");
    expect(previous?.text).not.toContain("The hall was colder");
    expect(includedIds(pkg)).not.toContain("manuscript/CHAPTER_0001.md");
  });
});

describe("recipes are distinct", () => {
  it("does not use one universal strategy", async () => {
    const c = compiler();
    const inspect = await c.compile({ recipe: "scene_inspection", targetId: "SCENE_0002" });
    const rewrite = await c.compile({ recipe: "scene_rewrite", targetId: "SCENE_0002" });
    const chapter = await c.compile({ recipe: "chapter_inspection", targetId: "CHAPTER_0001" });

    expect(includedIds(inspect)).not.toEqual(includedIds(rewrite));
    expect(includedIds(inspect)).not.toEqual(includedIds(chapter));
    expect(RECIPES.map((r) => r.name)).toEqual([
      "scene_inspection",
      "scene_rewrite",
      "chapter_inspection",
    ]);
  });
});

describe("token budget", () => {
  it("reserves output tokens before selecting", async () => {
    const pkg = await compiler().compile({
      recipe: "scene_inspection",
      targetId: "SCENE_0002",
      budget: { maxTokens: 1000, reserveForOutput: 400 },
    });
    expect(pkg.metadata.availableTokens).toBe(600);
    expect(pkg.metadata.withinBudget).toBe(true);
  });

  it("downgrades to summaries rather than truncating silently", async () => {
    const pkg = await compiler().compile({
      recipe: "scene_inspection",
      targetId: "SCENE_0002",
      budget: { maxTokens: 120 },
    });

    const summarised = allItems(pkg).filter((item) => item.rendering === "summary");
    expect(summarised.length).toBeGreaterThan(0);
    // Every downgrade is reported, with the full cost and the reason.
    for (const item of summarised) {
      const note = pkg.metadata.notes.find((n) => n.id === item.id);
      expect(note?.disposition).toBe("summary");
      expect(note?.fullTokens).toBeGreaterThan(note?.includedTokens ?? 0);
      expect(note?.reason).toMatch(/tokens/);
    }
  });

  it("never drops an element without recording why", async () => {
    const pkg = await compiler().compile({
      recipe: "scene_rewrite",
      targetId: "SCENE_0002",
      budget: { maxTokens: 90 },
    });

    const includedCount = allItems(pkg).length;
    const excluded = pkg.metadata.notes.filter((n) => n.disposition === "excluded");
    expect(includedCount + excluded.length).toBe(pkg.metadata.candidateCount);
    for (const note of excluded) {
      expect(note.reason).toMatch(/budget was exhausted/);
      expect(note.provenance.reason).not.toBe("");
    }
  });

  it("keeps the task and target even when the budget cannot fit them", async () => {
    const pkg = await compiler().compile({
      recipe: "scene_inspection",
      targetId: "SCENE_0002",
      budget: { maxTokens: 5 },
    });
    expect(ids(pkg, "task")).toEqual(["task"]);
    expect(ids(pkg, "target")).toEqual(["SCENE_0002"]);
    // And it says so rather than pretending it fitted.
    expect(pkg.metadata.withinBudget).toBe(false);
  });

  it("labels a prose excerpt with how much was omitted", async () => {
    const long = "A".repeat(4000);
    const reader = fixtureReader({
      readProjectFile: (path) =>
        Promise.resolve(
          path === "manuscript/CHAPTER_0001.md" ? long : (FIXTURE_FILES[path] ?? null),
        ),
    });
    const pkg = await new ContextCompiler(reader).compile({
      recipe: "scene_inspection",
      targetId: "SCENE_0002",
      budget: { maxTokens: 400 },
    });
    const prose = allItems(pkg).find((item) => item.id === "manuscript/CHAPTER_0001.md");
    expect(prose?.rendering).toBe("summary");
    expect(prose?.text).toMatch(/\[excerpt: opening \d+ of 4000 characters; \d+ omitted/);
    expect(prose?.fullTokens).toBe(estimateTokens(long));
  });

  it("rejects a budget that leaves nothing for context", async () => {
    await expect(
      compiler().compile({
        recipe: "scene_inspection",
        targetId: "SCENE_0002",
        budget: { maxTokens: 100, reserveForOutput: 100 },
      }),
    ).rejects.toThrow(CompileError);
  });
});

describe("pinned context", () => {
  it("puts user pins above everything the recipe chose", async () => {
    const pkg = await compiler().compile({
      recipe: "scene_inspection",
      targetId: "SCENE_0002",
      pinned: ["CHAR_0003"],
      budget: { maxTokens: 150 },
    });
    const pinned = allItems(pkg).find((item) => item.id === "CHAR_0003");
    expect(pinned?.provenance.reason).toBe("pinned by the user for this operation");
    expect(pinned?.section).toBe("additionalRetrievedContext");
    expect(pinned?.rendering).toBe("full");
  });
});

describe("reproducibility", () => {
  it("compiles identically for the same project state", async () => {
    const one = await compiler().compile({ recipe: "scene_rewrite", targetId: "SCENE_0002" });
    const two = await compiler().compile({ recipe: "scene_rewrite", targetId: "SCENE_0002" });
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });

  it("is unaffected by the order the project returns entities", async () => {
    const forward = await compiler().compile({
      recipe: "chapter_inspection",
      targetId: "CHAPTER_0001",
    });
    const reversed = await new ContextCompiler(
      fixtureReader({
        listCharacters: async () => (await fixtureReader().listCharacters()).reverse(),
        listChapters: async () => (await fixtureReader().listChapters()).reverse(),
        listWorldRules: async () => (await fixtureReader().listWorldRules()).reverse(),
      }),
      { now: () => "2026-01-01T00:00:00Z" },
    ).compile({ recipe: "chapter_inspection", targetId: "CHAPTER_0001" });

    expect(includedIds(reversed)).toEqual(includedIds(forward));
  });
});

describe("rendering for a model call", () => {
  it("renders sections with provenance and states what was left out", async () => {
    const pkg = await compiler().compile({
      recipe: "scene_inspection",
      targetId: "SCENE_0002",
      instruction: "Explain what changes between Mara and Elias.",
    });
    const text = renderContextPackage(pkg);

    expect(text).toContain("## TASK");
    expect(text).toContain("Explain what changes between Mara and Elias.");
    expect(text).toContain("## PRIMARY TEXT");
    expect(text).toContain("### CHAR_0002 — Elias [participant in SCENE_0002]");
    expect(text).not.toContain("## CONTEXT NOTES");

    const tight = await compiler().compile({
      recipe: "scene_inspection",
      targetId: "SCENE_0002",
      budget: { maxTokens: 100 },
    });
    expect(renderContextPackage(tight)).toContain("## CONTEXT NOTES");
  });

  it("can omit provenance annotations", async () => {
    const pkg = await compiler().compile({ recipe: "scene_inspection", targetId: "SCENE_0002" });
    expect(renderContextPackage(pkg, { includeProvenance: false })).not.toContain(
      "[participant in SCENE_0002]",
    );
  });
});

describe("story state in context", () => {
  it("includes state at the scene's entry boundary, with the boundary named", async () => {
    const pkg = await compiler().compile({ recipe: "scene_inspection", targetId: "SCENE_0002" });
    const state = section(pkg, "storyState");
    expect(state).toBeDefined();

    // Mara is at the manor entering SCENE_0002, having learned the fact in 0001.
    const mara = state?.items.find((i) => i.id.startsWith("CHAR_0001"));
    expect(mara?.provenance.reason).toBe(
      "story state of CHAR_0001 immediately before SCENE_0002, who is involved in SCENE_0002",
    );
    expect(mara?.text).toContain("location: LOC_0001");
    expect(mara?.text).toContain("FACT_0001: A vault lies beneath the manor.");
    expect(mara?.text).toContain("witnessed");

    const facts = state?.items.find((i) => i.id.startsWith("facts@"));
    expect(facts?.text).toContain("FACTS TRUE IMMEDIATELY BEFORE SCENE_0002");
  });

  it("reports state as of the target, not the latest state", async () => {
    // Entering SCENE_0001 nothing has happened yet, so no state is available.
    const first = await compiler().compile({ recipe: "scene_inspection", targetId: "SCENE_0001" });
    const state = section(first, "storyState");
    const mara = state?.items.find((i) => i.id.startsWith("CHAR_0001"));
    expect(mara?.text).toContain("location: unrecorded");
    expect(mara?.text).toContain("holds: nothing recorded");
  });

  it("carries state into the rendered context a model receives", async () => {
    const pkg = await compiler().compile({ recipe: "scene_rewrite", targetId: "SCENE_0002" });
    const text = renderContextPackage(pkg);
    expect(text).toContain("## STORY STATE");
    expect(text).toContain("STATE OF CHAR_0001 immediately before SCENE_0002");
  });

  it("includes chapter-entry state for chapter inspection", async () => {
    const pkg = await compiler().compile({
      recipe: "chapter_inspection",
      targetId: "CHAPTER_0001",
    });
    const state = section(pkg, "storyState");
    expect(
      state?.items.every((i) => i.provenance.reason.includes("immediately before SCENE_0001")),
    ).toBe(true);
  });
});

describe("relationship state in context", () => {
  it("includes relationships between characters present, at the entry boundary", async () => {
    const pkg = await compiler().compile({ recipe: "scene_inspection", targetId: "SCENE_0002" });
    const item = allItems(pkg).find((i) => i.id.startsWith("REL_0001@"));

    expect(item?.provenance.reason).toBe(
      "relationship between CHAR_0001 and CHAR_0002 immediately before SCENE_0002, both of whom are in SCENE_0002",
    );
    expect(item?.text).toContain("type: rival");
    expect(item?.text).toContain("status: wary");
  });

  it("never provides future relationship state while working on an earlier scene", async () => {
    // The relationship turns hostile in SCENE_0003 and trust is recorded in
    // SCENE_0002 — neither may appear in SCENE_0002's entry context.
    const pkg = await compiler().compile({ recipe: "scene_inspection", targetId: "SCENE_0002" });
    const item = allItems(pkg).find((i) => i.id.startsWith("REL_0001@"));
    expect(item?.text).not.toContain("hostile");
    expect(item?.text).not.toContain("trust");

    // Later in the story, both are present.
    const later = await compiler().compile({ recipe: "scene_inspection", targetId: "SCENE_0004" });
    const timeline = await buildTimeline(fixtureReader());
    expect(
      timeline.relationshipBeforeScene(
        { id: "REL_0001", characterAId: "CHAR_0001", characterBId: "CHAR_0002", type: "rival" },
        "SCENE_0004",
      ).status,
    ).toBe("hostile");
    // SCENE_0004 has only one character, so no relationship is compiled for it.
    expect(allItems(later).some((i) => i.id.startsWith("REL_0001@"))).toBe(false);
  });

  it("omits relationships where only one party is in the scene", async () => {
    const pkg = await compiler().compile({ recipe: "scene_inspection", targetId: "SCENE_0001" });
    expect(allItems(pkg).some((i) => i.id.startsWith("REL_0001@"))).toBe(false);
  });
});

describe("temporal context", () => {
  it("tells the model where the scene sits in story time", async () => {
    const pkg = await compiler().compile({ recipe: "scene_inspection", targetId: "SCENE_0002" });
    const item = allItems(pkg).find((i) => i.id === "story-time@SCENE_0002");

    expect(item?.provenance.rule).toBe("story_time");
    expect(item?.text).toContain("when: 2019-03-04T18:00:00Z");
    // Fourth in story time (after the fire, the flashback and SCENE_0001),
    // second in the manuscript — the two numbers are the point.
    expect(item?.text).toContain("chronological position: 4 of 6");
    expect(item?.text).toContain("manuscript position: 2");
  });

  it("marks a flashback as presented out of sequence", async () => {
    const pkg = await compiler().compile({ recipe: "scene_inspection", targetId: "SCENE_0003" });
    const item = allItems(pkg).find((i) => i.id === "story-time@SCENE_0003");

    expect(item?.text).toContain("out of chronological sequence");
    expect(item?.text).toContain("Do not assume the preceding chapters");
  });

  it("carries the events the story world has already reached", async () => {
    const pkg = await compiler().compile({ recipe: "scene_inspection", targetId: "SCENE_0002" });
    const item = allItems(pkg).find((i) => i.id === "preceding-events@SCENE_0002");

    expect(item?.provenance.rule).toBe("preceding_event");
    expect(item?.text).toContain("EVENT_0001 — The fire at the manor");
    expect(item?.text).toContain("off-page");
  });

  /**
   * The failure this section exists to prevent: a flashback sits early in the
   * story world and late in the book, so its manuscript neighbours are the
   * future. Nothing chronologically later may reach it.
   */
  it("never leaks future timeline events into a flashback's context", async () => {
    const pkg = await compiler().compile({ recipe: "scene_inspection", targetId: "SCENE_0003" });
    const temporal = allItems(pkg).filter((i) => i.kind === "timeline");

    // SCENE_0003 happens in 2017; both events happen after it.
    for (const item of temporal) {
      expect(item.text).not.toContain("EVENT_0002");
    }
    expect(allItems(pkg).some((i) => i.id === "future-events@SCENE_0003")).toBe(false);
  });

  it("provides forward-looking events only when explicitly asked", async () => {
    const chronology = await buildChronology(fixtureReader());
    const scene = FIXTURE_SCENES.find((s) => s.id === "SCENE_0003") as Scene;

    const guarded = temporalCandidates({ chronology, scene });
    expect(guarded.some((c) => c.id === "future-events@SCENE_0003")).toBe(false);

    const asked = temporalCandidates({ chronology, scene, includeFuture: true });
    const future = asked.find((c) => c.id === "future-events@SCENE_0003");
    expect(future?.provenance.rule).toBe("future_event");
    expect(future?.full).toContain("These have NOT happened yet");
    expect(future?.full).toContain("EVENT_0002");
  });

  it("names what is happening elsewhere at the same moment", async () => {
    const chronology = await buildChronology(fixtureReader());
    // SCENE_0001 runs 09:00–11:00; nothing else overlaps it.
    expect(chronology.simultaneousWith("SCENE_0001")).toEqual([]);
    // The chronology, not the chapter order, is what the compiler reports.
    expect(chronology.chronologicalOrder().map((n) => n.id)).toEqual([
      "EVENT_0001",
      "SCENE_0003",
      "SCENE_0001",
      "SCENE_0002",
      "EVENT_0002",
      "SCENE_0004",
    ]);
  });
});
