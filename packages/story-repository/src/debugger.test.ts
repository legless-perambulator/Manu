import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { DebugError, renderDebugReport, type DebugTrace } from "@jellytind/story-debugger";
import { StoryRepository } from "./story-repository";

/**
 * A novel built with its problems on purpose.
 *
 * Every one of these faults is the kind a writer notices as a *feeling* — the
 * betrayal doesn't land, her decision feels forced, chapter four drags — and the
 * point of the debugger is to answer that feeling with what the project
 * actually records. So the fixture engineers each fault deliberately and the
 * tests assert on the evidence, not on a verdict.
 *
 * The story: Marcus betrays Elias in chapter five. It is signalled in every
 * chapter before it, which is the classic version of "the reader got there
 * first". Mara enters the house in chapter four on the strength of something
 * nobody has told her.
 */
async function novel() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "Blackthorn" });

  const marcus = await repo.addCharacter({
    name: "Marcus",
    role: "ally",
    goals: ["Keep his brother's debt hidden"],
  });
  const elias = await repo.addCharacter({ name: "Elias", role: "protagonist" });
  // Deliberately goal-less: the debugger must say so rather than guess.
  const mara = await repo.addCharacter({ name: "Mara", role: "investigator" });

  const manor = await repo.addLocation({ name: "Blackthorn Manor" });
  const house = await repo.addLocation({ name: "The Vance House" });
  const revolver = await repo.addObject({ name: "Revolver" });

  const betrayal = await repo.addPlotThread({
    name: "The betrayal",
    description: "Marcus is working for the other side.",
    status: "introduced",
  });
  const treachery = await repo.addFact({ statement: "Marcus is working for Vance." });
  const cellar = await repo.addFact({ statement: "There is a cellar beneath the Vance House." });

  const chapters = [];
  for (const title of ["Arrival", "The Letter", "The Absence", "The House", "The Turn"]) {
    chapters.push(await repo.addChapter({ title, status: "drafted" }));
  }
  const [one, two, three, four, five] = chapters as [
    (typeof chapters)[0],
    (typeof chapters)[0],
    (typeof chapters)[0],
    (typeof chapters)[0],
    (typeof chapters)[0],
  ];

  // Four chapters of Marcus behaving suspiciously, then the reveal.
  const s1 = await repo.addScene({
    title: "Marcus saves Elias",
    chapterId: one.id,
    locationId: manor.id,
    characterIds: [marcus.id, elias.id],
    plotThreadIds: [betrayal.id],
    purpose: ["Establish Marcus as loyal"],
    status: "drafted",
  });
  const s2 = await repo.addScene({
    title: "A letter he does not explain",
    chapterId: two.id,
    locationId: manor.id,
    characterIds: [marcus.id],
    plotThreadIds: [betrayal.id],
    purpose: ["Plant doubt about Marcus"],
    status: "drafted",
  });
  const s3 = await repo.addScene({
    title: "Marcus is not where he said",
    chapterId: three.id,
    locationId: manor.id,
    characterIds: [marcus.id, elias.id],
    plotThreadIds: [betrayal.id],
    purpose: ["Plant doubt about Marcus"],
    status: "drafted",
  });
  const s4 = await repo.addScene({
    title: "Mara enters the house",
    chapterId: four.id,
    locationId: house.id,
    characterIds: [mara.id],
    // The scene turns on the cellar — which nothing tells Mara about.
    factIds: [cellar.id],
    purpose: ["Mara searches the cellar"],
    status: "drafted",
  });
  const s5 = await repo.addScene({
    title: "The turn",
    chapterId: five.id,
    locationId: manor.id,
    characterIds: [marcus.id, elias.id],
    objectIds: [revolver.id],
    plotThreadIds: [betrayal.id],
    factIds: [treachery.id],
    purpose: ["Marcus's betrayal lands"],
    status: "drafted",
  });

  await repo.addRelationship({
    characterAId: marcus.id,
    characterBId: elias.id,
    type: "ally",
    status: "trusted",
    description: "Elias owes Marcus his life.",
  });

  await repo.addSetup({
    description: "Marcus flinches at the mention of Vance.",
    setupSceneIds: [s2.id],
    payoffSceneIds: [s5.id],
    subtlety: "blatant",
    intendedInterpretation: "Nerves.",
    trueMeaning: "He already works for Vance.",
    targetThreadId: betrayal.id,
    targetRevealId: treachery.id,
  });

  await repo.addStateTransitions([
    { sceneId: s1.id, kind: "thread_appearance", subjectId: betrayal.id, value: "introduces" },
    { sceneId: s2.id, kind: "thread_appearance", subjectId: betrayal.id, value: "complicates" },
    { sceneId: s3.id, kind: "thread_appearance", subjectId: betrayal.id, value: "escalates" },
    { sceneId: s5.id, kind: "thread_appearance", subjectId: betrayal.id, value: "resolves" },
    {
      sceneId: s5.id,
      kind: "knowledge_changed",
      subjectId: elias.id,
      value: treachery.id,
      knowledgeState: "known",
      sourceType: "witnessed",
    },
    // The revolver is last recorded at the Vance House and never moved back,
    // yet chapter five uses it at the manor. The canonical continuity fault.
    { sceneId: s1.id, kind: "object_location", subjectId: revolver.id, value: house.id },
  ]);

  // Chapter four is three times the length of its neighbours.
  const prose = async (chapterId: string, filePath: string, words: number) => {
    const scaffolded = (await repo.readProjectFile(filePath)) ?? "";
    await repo.writeProjectFile(
      filePath,
      `${scaffolded}\n${Array.from({ length: words }, (_, i) => `word${String(i)}`).join(" ")}\n`,
    );
    return chapterId;
  };
  for (const chapter of [one, two, three, five]) {
    await prose(chapter.id as string, chapter.filePath, 400);
  }
  await prose(four.id as string, four.filePath, 1_600);

  return {
    store,
    repo,
    marcus,
    elias,
    mara,
    manor,
    house,
    revolver,
    betrayal,
    treachery,
    cellar,
    one,
    two,
    three,
    four,
    five,
    s1,
    s2,
    s3,
    s4,
    s5,
  };
}

const statements = (trace: DebugTrace): string =>
  trace.evidence.map((e) => `${e.statement} ${e.detail ?? ""}`).join("\n");

const measure = (trace: DebugTrace, label: string): number | undefined =>
  trace.measurements.find((m) => m.label.includes(label))?.value;

describe("reveal debugging", () => {
  it("finds the reveal from the thread and measures how far ahead the signals start", async () => {
    const { repo, marcus, betrayal, treachery, s2, s5 } = await novel();

    const trace = await repo.traceStoryProblem({
      mode: "reveal",
      problem: "Why doesn't Marcus's betrayal land?",
      characterId: marcus.id,
      threadId: betrayal.id,
      factId: treachery.id,
    });

    expect(trace.mode).toBe("reveal");
    expect(trace.scope.summary).toContain(s5.id);
    // Four scenes of Marcus before the reveal, the first of them four back.
    expect(measure(trace, "first signal and the reveal")).toBe(4);
    expect(measure(trace, "carrying the reveal's material")).toBe(3);
    expect(measure(trace, "Chapters the signals span")).toBe(4);

    // The setup, its subtlety and its distance are all evidence.
    const text = statements(trace);
    expect(text).toContain("flinches at the mention of Vance");
    expect(text).toContain("subtlety blatant");
    expect(text).toContain(`${s2.id}`);
  });

  /** Nothing here grades the numbers. That is the model's job, and the writer's. */
  it("measures without judging", async () => {
    const { repo, marcus, betrayal } = await novel();
    const trace = await repo.traceStoryProblem({
      mode: "reveal",
      problem: "Why doesn't it land?",
      characterId: marcus.id,
      threadId: betrayal.id,
    });

    const words = `${statements(trace)} ${trace.measurements.map((m) => m.basis).join(" ")}`;
    expect(words).not.toMatch(/too (early|obvious|many|much)/i);
    expect(words).not.toMatch(/\b(should|ought to|badly|poorly)\b/i);
  });

  it("says plainly when nothing was planted for a reveal", async () => {
    const { repo, mara, s4 } = await novel();
    const trace = await repo.traceStoryProblem({
      mode: "reveal",
      problem: "The cellar reveal is flat.",
      characterId: mara.id,
      revealSceneId: s4.id,
    });

    expect(statements(trace)).toContain("No setup is recorded as serving this reveal");
    // And it says the two indistinguishable cases are indistinguishable.
    expect(statements(trace)).toContain("never registered as a setup");
  });

  it("traces who already knew, and when", async () => {
    const { repo, marcus, elias, treachery, s5 } = await novel();
    const trace = await repo.traceStoryProblem({
      mode: "reveal",
      problem: "Does the reveal land?",
      characterId: marcus.id,
      factId: treachery.id,
      revealSceneId: s5.id,
    });

    const knowledge = trace.evidence.filter((e) => e.system === "knowledge");
    expect(knowledge.length).toBeGreaterThan(0);
    expect(knowledge.some((e) => e.entities.includes(elias.id as string))).toBe(true);
  });

  it("refuses to guess when nothing identifies the reveal", async () => {
    const { repo } = await novel();
    await expect(
      repo.traceStoryProblem({ mode: "reveal", problem: "Something is off." }),
    ).rejects.toBeInstanceOf(DebugError);
  });
});

describe("character motivation debugging", () => {
  it("finds the decision resting on something the character does not know", async () => {
    const { repo, mara, cellar, s4 } = await novel();

    const trace = await repo.traceStoryProblem({
      mode: "character_motivation",
      problem: "Mara's decision to enter the house feels forced.",
      characterId: mara.id,
      sceneId: s4.id,
    });

    expect(measure(trace, "does not hold")).toBe(1);
    const gap = trace.evidence.find((e) => e.statement.includes("does not hold it entering"));
    expect(gap?.entities).toContain(cellar.id);
    expect(gap?.detail).toContain("no recorded position");
  });

  /** Unrecorded goals are reported as unrecorded, never as an absence of motive. */
  it("distinguishes no goals recorded from no goals", async () => {
    const { repo, mara, marcus, s4, s3 } = await novel();

    const without = await repo.traceStoryProblem({
      mode: "character_motivation",
      problem: "Why does she go in?",
      characterId: mara.id,
      sceneId: s4.id,
    });
    expect(statements(without)).toContain("No goals are recorded for Mara");
    expect(without.scope.notInspected.join(" ")).toContain("none are recorded to compare against");

    const with_ = await repo.traceStoryProblem({
      mode: "character_motivation",
      problem: "Why does he lie?",
      characterId: marcus.id,
      sceneId: s3.id,
    });
    expect(statements(with_)).toContain("Keep his brother's debt hidden");
  });

  it("reconstructs the relationship as it stood entering the scene", async () => {
    const { repo, marcus, s3 } = await novel();
    const trace = await repo.traceStoryProblem({
      mode: "character_motivation",
      problem: "Why does Marcus stay?",
      characterId: marcus.id,
      sceneId: s3.id,
    });

    const relationship = trace.evidence.find((e) => e.system === "relationships");
    expect(relationship?.statement).toContain("Elias");
    expect(relationship?.statement).toContain("trusted");
  });

  it("needs both a character and a scene", async () => {
    const { repo, mara } = await novel();
    await expect(
      repo.traceStoryProblem({
        mode: "character_motivation",
        problem: "?",
        characterId: mara.id,
      }),
    ).rejects.toThrow(/character.*and the scene/i);
  });
});

describe("pacing debugging", () => {
  it("measures the lopsided chapter against its neighbours", async () => {
    const { repo, four } = await novel();
    const trace = await repo.traceStoryProblem({
      mode: "pacing",
      problem: "Chapter four drags.",
    });

    expect(measure(trace, "Longest chapter as a multiple")).toBeCloseTo(4, 1);
    const outlier = trace.measurements.find((m) => m.label.startsWith("The House"));
    expect(outlier?.value).toBeCloseTo(4, 1);
    expect(outlier?.entities).toContain(four.id);
    // Distance, not a verdict.
    expect(outlier?.basis).toContain("whether it is wrong depends on what the chapter is doing");
  });

  it("says that conflict and tension are not recorded rather than inventing them", async () => {
    const { repo } = await novel();
    const trace = await repo.traceStoryProblem({ mode: "pacing", problem: "It drags." });
    expect(trace.scope.notInspected.join(" ")).toContain("Conflict, tension and stakes");
  });

  it("reports thread activity chapter by chapter", async () => {
    const { repo } = await novel();
    const trace = await repo.traceStoryProblem({ mode: "pacing", problem: "It drags." });

    const quiet = trace.evidence.find(
      (e) => e.system === "plot_threads" && e.statement.startsWith("The House"),
    );
    expect(quiet?.statement).toContain("0 recorded thread step(s)");
  });
});

describe("continuity debugging", () => {
  it("starts from a build diagnostic and traces its cause", async () => {
    const { repo, revolver, house } = await novel();
    const build = await repo.buildStory();
    const diagnostic = build.diagnostics.find((d) => d.entities.includes(revolver.id as string));
    expect(diagnostic).toBeDefined();

    const trace = await repo.traceStoryProblem({
      mode: "continuity",
      diagnosticId: (diagnostic as { id: string }).id,
    });

    // The finding itself, then the object's whole recorded history.
    expect(trace.evidence[0]?.system).toBe("compiler");
    const history = trace.evidence.find((e) => e.statement.includes("recorded change(s)"));
    expect(history?.entities).toContain(revolver.id);
    // The cause, stated: where it actually was entering the scene that uses it.
    expect(statements(trace)).toContain(`Entering the scene, Revolver`);
    expect(statements(trace)).toContain(house.id as string);
    // And how long the silence ran before the finding landed.
    expect(measure(trace, "last recorded change")).toBe(4);
  });

  it("says so when there is no build to start from", async () => {
    const { repo } = await novel();
    await expect(
      repo.traceStoryProblem({ mode: "continuity", diagnosticId: "DIAG_deadbeef" }),
    ).rejects.toThrow(/no builds yet/i);
  });

  it("says so when the diagnostic is not in the build", async () => {
    const { repo } = await novel();
    await repo.buildStory();
    await expect(
      repo.traceStoryProblem({ mode: "continuity", diagnosticId: "DIAG_deadbeef" }),
    ).rejects.toThrow(/no diagnostic/i);
  });
});

describe("the debug report", () => {
  it("saves an undiagnosed report, and says it is undiagnosed", async () => {
    const { repo, marcus, betrayal } = await novel();
    const trace = await repo.traceStoryProblem({
      mode: "reveal",
      problem: "Why doesn't Marcus's betrayal land?",
      characterId: marcus.id,
      threadId: betrayal.id,
    });

    const report = await repo.saveDebugReport(trace, { durationMs: 12 });
    expect(report.id).toBe("DEBUG_0001");
    expect(report.diagnosis).toBeUndefined();
    expect(report.interventions).toEqual([]);
    expect(report.entities.length).toBeGreaterThan(0);

    const text = renderDebugReport(report);
    expect(text).toContain("PROBLEM");
    expect(text).toContain("SCOPE INSPECTED");
    expect(text).toContain("EVIDENCE (deterministic");
    expect(text).toContain("DIAGNOSIS");
    expect(text).toContain("Not diagnosed");
    expect(text).toContain("CONFIDENCE AND UNCERTAINTY");
    expect(text).toContain("POSSIBLE INTERVENTIONS");
    expect(text).toContain("AFFECTED ENTITIES");

    expect((await repo.listDebugReports())[0]?.diagnosed).toBe(false);
    expect((await repo.getDebugReport(report.id))?.problem).toBe(trace.problem);
  });

  /** A report is derived analysis, not a change to the story. */
  it("does not record an investigation in the writer's history", async () => {
    const { repo, marcus, betrayal } = await novel();
    const before = (await repo.listChangeSets()).length;

    const trace = await repo.traceStoryProblem({
      mode: "reveal",
      problem: "?",
      characterId: marcus.id,
      threadId: betrayal.id,
    });
    await repo.saveDebugReport(trace, { durationMs: 1 });

    expect((await repo.listChangeSets()).length).toBe(before);
  });

  it("reads the same twice", async () => {
    const { repo, mara, s4 } = await novel();
    const request = {
      mode: "character_motivation",
      problem: "Forced.",
      characterId: mara.id as string,
      sceneId: s4.id as string,
    };
    const first = await repo.traceStoryProblem(request);
    const second = await repo.traceStoryProblem(request);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe("the /debug command", () => {
  it("resolves a writer's words to entities", async () => {
    const { repo, marcus } = await novel();
    const parsed = await repo.parseDebugCommand("/debug betrayal Marcus");

    expect(parsed.request.mode).toBe("reveal");
    expect((parsed.request as { characterId?: string }).characterId).toBe(marcus.id);
    expect(parsed.resolved[0]).toContain("Marcus");
    // The writer's words survive as the problem statement.
    expect(parsed.request.problem).toBe("betrayal Marcus");
  });

  it("keeps unmatched words visible rather than ignoring them", async () => {
    const { repo } = await novel();
    const parsed = await repo.parseDebugCommand("/debug pacing Ch4");
    expect(parsed.unresolved).toEqual(["Ch4"]);
    expect(parsed.request.mode).toBe("pacing");
  });

  it("refuses a topic it cannot investigate", async () => {
    const { repo } = await novel();
    await expect(repo.parseDebugCommand("/debug vibes Marcus")).rejects.toThrow(/not something/i);
  });
});
