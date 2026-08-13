import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { StoryRepository } from "@jellytind/story-repository";
import type { ReaderLevel, ReaderReading, ReaderSimulation } from "@jellytind/domain";
import { EMPTY_READER_STATE } from "@jellytind/domain";
import { loadArchitecture, renderChain, resolveChain, solutionStep } from "./architecture";
import { auditFairness, checkAlibis, detectObviousness, earliestSolvable } from "./fairness";
import { MysteryError } from "./types";

/**
 * A mystery with no manuscript.
 *
 * Not a shortcut for the test: it *is* the acceptance criterion. Every chapter
 * here is empty prose, and the engine is still expected to say what the reader
 * has by scene four, which reasoning rests on what, and whether the ending is
 * earned. If any of this needed the text, it would fail here.
 */
async function novel() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "The Sealed Vault" });

  const mara = await repo.addCharacter({ name: "Mara", role: "protagonist", goals: [] });
  const elias = await repo.addCharacter({ name: "Elias", goals: [] });
  const tamsin = await repo.addCharacter({ name: "Tamsin", goals: [] });
  const rook = await repo.addCharacter({ name: "Rook", goals: [] });
  const vance = await repo.addCharacter({ name: "Vance", goals: [] });

  const hall = await repo.addLocation({ name: "The hall" });
  const cellar = await repo.addLocation({ name: "The cellar" });

  const doorFact = await repo.addFact({
    statement: "The cellar door only locks from the inside",
  });
  const grudgeFact = await repo.addFact({
    statement: "Elias was cut out of the will three weeks before",
  });

  const one = await repo.addChapter({ title: "The key board" });
  const two = await repo.addChapter({ title: "The lock plate" });

  const cast = [mara.id, elias.id, tamsin.id, rook.id];
  const s1 = await repo.addScene({
    title: "The key board",
    chapterId: one.id,
    locationId: hall.id,
    characterIds: cast,
  });
  const s2 = await repo.addScene({
    title: "The ledger",
    chapterId: one.id,
    locationId: hall.id,
    characterIds: cast,
  });
  const s3 = await repo.addScene({
    title: "The damp coat",
    chapterId: one.id,
    locationId: cellar.id,
    characterIds: cast,
  });
  const s4 = await repo.addScene({
    title: "The lock plate",
    chapterId: two.id,
    locationId: cellar.id,
    characterIds: cast,
  });
  const s5 = await repo.addScene({
    title: "Tamsin explains",
    chapterId: two.id,
    locationId: hall.id,
    characterIds: cast,
  });
  const s6 = await repo.addScene({
    title: "The reveal",
    chapterId: two.id,
    locationId: hall.id,
    characterIds: cast,
  });

  await repo.addStateTransitions([
    { sceneId: s1.id, kind: "character_location", subjectId: elias.id, value: hall.id },
    // He goes down in scene three, and the project never brings him back up —
    // which is what makes his alibi for that scene checkable.
    { sceneId: s3.id, kind: "character_location", subjectId: elias.id, value: cellar.id },
    { sceneId: s1.id, kind: "character_location", subjectId: tamsin.id, value: hall.id },
    { sceneId: s1.id, kind: "character_location", subjectId: rook.id, value: hall.id },
  ]);

  return {
    repo,
    store,
    mara,
    elias,
    tamsin,
    rook,
    vance,
    hall,
    cellar,
    doorFact,
    grudgeFact,
    one,
    two,
    s1,
    s2,
    s3,
    s4,
    s5,
    s6,
  };
}

/**
 * A fair mystery, laid out end to end.
 *
 * Two clues yield a deduction; that deduction plus a fact the story shows in
 * scene four yields the solution. The reveal is scene six, the author says it
 * should be solvable from scene four, and it is.
 */
async function fairMystery(project: Awaited<ReturnType<typeof novel>>) {
  const { repo, elias, tamsin, mara, rook, vance, hall, doorFact, s1, s2, s3, s4, s5, s6 } =
    project;

  const mystery = await repo.mysteries.addMystery({
    name: "The sealed vault",
    question: "Who sealed the vault, and why?",
    solution: "Elias sealed it from the inside and climbed out through the coal chute.",
    culpritIds: [elias.id],
    revealSceneId: s6.id,
    intendedSolvableFromSceneId: s4.id,
    status: "active",
  });

  const key = await repo.mysteries.addClue({
    mysteryId: mystery.id,
    description: "A key missing from the board",
    source: "absence",
    firstAppearance: s1.id,
    visibility: "shown",
    apparentMeaning: "Someone has been careless.",
    trueMeaning: "Elias took it the night before.",
  });
  const coat = await repo.mysteries.addClue({
    mysteryId: mystery.id,
    description: "Elias's coat is damp to the elbow",
    source: "observation",
    firstAppearance: s3.id,
    visibility: "shown",
  });
  const plate = await repo.mysteries.addClue({
    mysteryId: mystery.id,
    description: "The lock plate is mounted on the cellar side",
    source: "object",
    firstAppearance: s4.id,
    visibility: "shown",
    relatedFactIds: [doorFact.id],
    payoffSceneId: s6.id,
  });
  const herring = await repo.mysteries.addClue({
    mysteryId: mystery.id,
    description: "Tamsin's ledger entry for that night",
    kind: "red_herring",
    source: "document",
    firstAppearance: s2.id,
    visibility: "stated",
    apparentMeaning: "She was in the house when she said she was not.",
    resolution: "She was falsifying her hours, not sealing vaults.",
    resolvedSceneId: s5.id,
  });

  const stepOne = await repo.mysteries.addDeduction({
    mysteryId: mystery.id,
    statement: "Whoever sealed it went down before it was sealed",
    premises: [key.id, coat.id],
    difficulty: "moderate",
  });
  const solution = await repo.mysteries.addDeduction({
    mysteryId: mystery.id,
    statement: "Elias sealed the vault from the inside",
    premises: [stepOne.id, doorFact.id],
    difficulty: "demanding",
    isSolution: true,
  });

  await repo.mysteries.setSuspect({
    mysteryId: mystery.id,
    characterId: elias.id,
    motive: "cut out of the will",
    means: "kept the spare key",
    opportunity: "alone in the house all evening",
    alibi: {
      claim: "He says he never left the hall.",
      locationId: hall.id,
      coversSceneId: s3.id,
      corroboratedBy: tamsin.id,
    },
    evidenceFor: [key.id, coat.id],
    evidenceAgainst: [],
  });
  await repo.mysteries.setSuspect({
    mysteryId: mystery.id,
    characterId: tamsin.id,
    // Everything a suspect can have, and she did not do it. That is the point
    // of not adding motive, means and opportunity up.
    motive: "her name is on the deed",
    means: "keeps the ledger and the keys",
    opportunity: "was in the house that night",
    alibi: {
      claim: "She was in the hall with Mara.",
      locationId: hall.id,
      coversSceneId: s2.id,
      corroboratedBy: mara.id,
    },
    evidenceFor: [herring.id],
    evidenceAgainst: [],
  });
  await repo.mysteries.setSuspect({
    mysteryId: mystery.id,
    characterId: rook.id,
    alibi: { claim: "He says he was walking the lane.", coversSceneId: s2.id },
    evidenceFor: [],
    evidenceAgainst: [],
  });
  await repo.mysteries.setSuspect({
    mysteryId: mystery.id,
    characterId: vance.id,
    evidenceFor: [],
    evidenceAgainst: [],
  });

  return { mystery, key, coat, plate, herring, stepOne, solution };
}

/** A reader who is handed their suspicions rather than reaching them. */
function scriptedReader(
  profileId: string,
  profileName: string,
  chapters: readonly { id: string; suspicionOfCulprit: ReaderLevel }[],
  culpritId: string,
): ReaderSimulation {
  const readings: ReaderReading[] = chapters.map((chapter, index) => ({
    chapterId: chapter.id,
    position: index + 1,
    understanding: "Something happened in the cellar.",
    bored: [],
    interested: [],
    confusedBy: [],
    emotionalMoments: [],
    state: {
      ...EMPTY_READER_STATE,
      suspicions: [{ subject: culpritId, level: chapter.suspicionOfCulprit }],
    },
    exposure: {
      chapterId: chapter.id,
      chapterTitle: `Chapter ${String(index + 1)}`,
      position: index + 1,
      sceneIds: [],
      charactersMet: [],
      factsOnPage: [],
      threadsSeen: [],
      words: 0,
    },
    fingerprint: `fp-${chapter.id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
  }));

  return {
    id: `SIM_${profileId}`,
    profileId,
    profileName,
    status: "completed",
    readings,
    chapterIds: chapters.map((chapter) => chapter.id),
    startedAt: "2026-01-01T00:00:00.000Z",
    rerunCount: 0,
  };
}

// ── The acceptance criterion ────────────────────────────────────────────────

describe("the architecture is reconstructed from records, not prose", () => {
  it("answers every question about the mystery with an empty manuscript", async () => {
    const project = await novel();
    const { mystery, key, plate, solution } = await fairMystery(project);
    const { repo, store, elias, s1, s4 } = project;

    // Nothing has been written. Every chapter file is front matter and a
    // heading — there is no prose in this book for anything to read.
    for (const chapter of await repo.listChapters()) {
      const file = (await store.readFile(chapter.filePath)) ?? "";
      const prose = file
        .replace(/^---[\s\S]*?---/, "")
        .split("\n")
        .filter((line) => line.trim() !== "" && !line.startsWith("#"));
      expect(prose).toEqual([]);
    }

    const architecture = await loadArchitecture(repo, mystery.id);

    expect(architecture.sceneOrder).toHaveLength(6);
    expect(architecture.positionOf(s1.id)).toBe(1);
    expect(architecture.positionOf(s4.id)).toBe(4);
    expect(architecture.exposureOf(key.id)).toEqual({ sceneId: s1.id, position: 1 });
    expect(architecture.exposureOf(plate.id)).toEqual({ sceneId: s4.id, position: 4 });
    expect(architecture.clues).toHaveLength(4);
    expect(architecture.suspects).toHaveLength(4);
    expect(architecture.mystery.culpritIds).toEqual([elias.id]);

    const { steps } = resolveChain(architecture, await repo.listFacts());
    expect(solutionStep(steps)?.deductionId).toBe(solution.id);
    expect(solutionStep(steps)?.reachableAt?.position).toBe(4);
  });

  it("survives a restart, because it is canon and lives with the book", async () => {
    const project = await novel();
    const { mystery } = await fairMystery(project);
    const reopened = await StoryRepository.openProject({ store: project.store });

    expect(await reopened.mysteries.listClues(mystery.id)).toHaveLength(4);
    expect((await reopened.mysteries.getMystery(mystery.id))?.solution).toMatch(/coal chute/);
    expect(await project.store.readFile("mystery/clues.json")).not.toBeNull();
  });

  it("refuses a mystery it does not have", async () => {
    const { repo } = await novel();
    await expect(loadArchitecture(repo, "MYSTERY_9999")).rejects.toThrowError(/No mystery with id/);
  });
});

// ── Deduction chains ────────────────────────────────────────────────────────

describe("the deduction chain", () => {
  it("resolves premises to what they are and when the reader gets them", async () => {
    const project = await novel();
    const { mystery, key, coat, stepOne, solution } = await fairMystery(project);
    const { repo, doorFact, s3, s4 } = project;

    const architecture = await loadArchitecture(repo, mystery.id);
    const { steps, cycles } = resolveChain(architecture, await repo.listFacts());

    expect(cycles).toEqual([]);
    // Premises before conclusions: the first step is reachable in scene three.
    expect(steps.map((step) => step.deductionId)).toEqual([stepOne.id, solution.id]);

    const first = steps[0];
    expect(first?.premises.map((premise) => premise.kind)).toEqual(["clue", "clue"]);
    expect(first?.premises.map((premise) => premise.id)).toEqual([key.id, coat.id]);
    // The latest premise gates the step: the coat arrives in scene three.
    expect(first?.reachableAt).toEqual({ sceneId: s3.id, position: 3 });

    const last = steps[1];
    expect(last?.premises.map((premise) => premise.kind)).toEqual(["deduction", "fact"]);
    expect(last?.premises[1]?.label).toBe("The cellar door only locks from the inside");
    expect(last?.premises[1]?.availableAt).toEqual({ sceneId: s4.id, position: 4 });
    expect(last?.isSolution).toBe(true);
    expect(doorFact).toBeDefined();
  });

  it("draws the chain the way the specification draws it", async () => {
    const project = await novel();
    const { mystery } = await fairMystery(project);
    const architecture = await loadArchitecture(project.repo, mystery.id);
    const { steps } = resolveChain(architecture, await project.repo.listFacts());

    const first = steps[0];
    expect(first).toBeDefined();
    const drawn = renderChain(first as NonNullable<typeof first>);
    expect(drawn).toContain("A key missing from the board  [scene 1]");
    expect(drawn).toContain("+");
    expect(drawn).toContain("↓");
    expect(drawn).toContain("(reachable from scene 3)");
  });

  it("reports reasoning that circles rather than hanging on it", async () => {
    const project = await novel();
    const { mystery, key, stepOne, solution } = await fairMystery(project);

    // Make the first step rest on the conclusion it supports.
    await project.repo.mysteries.updateDeduction(stepOne.id, { premises: [key.id, solution.id] });

    const architecture = await loadArchitecture(project.repo, mystery.id);
    const { cycles } = resolveChain(architecture, await project.repo.listFacts());
    expect(cycles.length).toBeGreaterThan(0);

    const report = await auditFairness(project.repo, mystery.id);
    expect(report.findings.some((finding) => /circles/.test(finding.statement))).toBe(true);
  });

  it("treats a fact with no clue exposing it as something the reader never got", async () => {
    const project = await novel();
    const { mystery, solution } = await fairMystery(project);
    // The grudge is established in the project and never shown to the reader.
    const existing = (await project.repo.mysteries.listDeductions(mystery.id)).find(
      (entry) => entry.id === solution.id,
    );
    await project.repo.mysteries.updateDeduction(solution.id, {
      premises: [...(existing?.premises ?? []), project.grudgeFact.id],
    });

    const architecture = await loadArchitecture(project.repo, mystery.id);
    const { steps } = resolveChain(architecture, await project.repo.listFacts());
    const last = solutionStep(steps);

    expect(
      last?.premises.find((premise) => premise.id === project.grudgeFact.id)?.availableAt,
    ).toBeNull();
    expect(last?.reachableAt).toBeNull();
  });
});

// ── Fairness ────────────────────────────────────────────────────────────────

describe("can a careful reader fairly reach the solution before the reveal?", () => {
  it("says fair when every premise arrives in time", async () => {
    const project = await novel();
    const { mystery, key, coat, plate, herring } = await fairMystery(project);
    const report = await auditFairness(project.repo, mystery.id);

    expect(report.verdict).toBe("fair");
    expect(report.findings).toEqual([]);
    expect(report.readerHasByReveal).toEqual([key.id, herring.id, coat.id, plate.id]);
    expect(report.basis).toMatch(
      /4 clue\(s\), 2 deduction\(s\), 4 suspect\(s\), reveal at scene 6/,
    );
    expect(report.notChecked).toEqual([]);
  });

  it("calls it unfair when the solution rests on something never shown", async () => {
    const project = await novel();
    const { mystery, solution } = await fairMystery(project);
    const existing = (await project.repo.mysteries.listDeductions(mystery.id)).find(
      (entry) => entry.id === solution.id,
    );
    await project.repo.mysteries.updateDeduction(solution.id, {
      premises: [...(existing?.premises ?? []), project.grudgeFact.id],
    });

    const report = await auditFairness(project.repo, mystery.id);
    const hidden = report.findings.filter((finding) => finding.problem === "hidden_essential");

    expect(report.verdict).toBe("unfair");
    expect(hidden).toHaveLength(1);
    expect(hidden[0]?.statement).toMatch(/never shown "Elias was cut out of the will/);
    expect(hidden[0]?.detail).toMatch(/not a fact the reader has/);
    expect(hidden[0]?.derivation).toBe("deterministic");
  });

  it("calls it unfair when a premise only lands at the reveal", async () => {
    const project = await novel();
    const { mystery, coat } = await fairMystery(project);
    await project.repo.mysteries.updateClue(coat.id, {
      firstAppearance: project.s6.id,
      readerExposure: [project.s6.id],
    });

    const report = await auditFairness(project.repo, mystery.id);
    const late = report.findings.filter((finding) => finding.problem === "late_premise");

    expect(report.verdict).toBe("unfair");
    expect(late[0]?.statement).toMatch(/scene 6, at or after the reveal/);
    expect(late[0]?.sceneIds).toEqual([project.s6.id]);
  });

  it("calls out reasoning that rests on a premise the project does not have", async () => {
    const project = await novel();
    const { mystery, key, solution } = await fairMystery(project);
    await project.repo.mysteries.updateDeduction(solution.id, {
      premises: [key.id, "CLUE_9999"],
    });

    const report = await auditFairness(project.repo, mystery.id);
    const missing = report.findings.filter((finding) => finding.problem === "missing_premise");

    expect(report.verdict).toBe("unfair");
    expect(missing[0]?.statement).toMatch(/rests on CLUE_9999, which is not in the project/);
  });

  it("says technically fair when everything the solution needs is buried", async () => {
    const project = await novel();
    const { mystery, key, coat } = await fairMystery(project);
    await project.repo.mysteries.updateClue(key.id, { visibility: "buried" });
    await project.repo.mysteries.updateClue(coat.id, { visibility: "buried" });

    const report = await auditFairness(project.repo, mystery.id);
    const finding = report.findings.find((entry) => entry.problem === "technically_fair");

    expect(report.verdict).toBe("strained");
    expect(finding?.statement).toMatch(
      /Every clue the solution needs is marked buried \(2 of them\)/,
    );
    expect(finding?.detail).toMatch(/worth making on purpose/);
  });

  it("finds a red herring the story never explains", async () => {
    const project = await novel();
    const { mystery } = await fairMystery(project);
    await project.repo.mysteries.addClue({
      mysteryId: mystery.id,
      description: "Rook's boots by the cellar stair",
      kind: "red_herring",
      firstAppearance: project.s2.id,
    });

    const report = await auditFairness(project.repo, mystery.id);
    const herrings = report.findings.filter((finding) => finding.problem === "unresolved_herring");

    expect(report.verdict).toBe("strained");
    expect(herrings).toHaveLength(1);
    expect(herrings[0]?.statement).toMatch(/"Rook's boots by the cellar stair" is never explained/);
    expect(herrings[0]?.sceneIds).toEqual([project.s2.id]);
  });

  it("finds a clue planted and never cashed", async () => {
    const project = await novel();
    const { mystery } = await fairMystery(project);
    await project.repo.mysteries.addClue({
      mysteryId: mystery.id,
      description: "A torn glove in the grate",
      firstAppearance: project.s2.id,
    });

    const report = await auditFairness(project.repo, mystery.id);
    const unpaid = report.findings.filter((finding) => finding.problem === "unpaid_clue");

    expect(unpaid).toHaveLength(1);
    expect(unpaid[0]?.statement).toMatch(/nothing uses it — no payoff scene and no deduction/);
  });

  it("says what it could not check rather than guessing", async () => {
    const project = await novel();
    const mystery = await project.repo.mysteries.addMystery({
      name: "The second vault",
      question: "And who sealed that one?",
    });

    const report = await auditFairness(project.repo, mystery.id);
    expect(report.verdict).toBe("insufficient_data");
    expect(report.notChecked).toContain(
      "no reveal scene is recorded, so nothing could be checked against it",
    );
    expect(report.notChecked).toContain(
      "no deduction is marked as the solution, so there is no chain to check for fairness",
    );
    expect(report.notChecked).toContain("no clues are recorded for this mystery");
  });

  it("never reports a score, a percentage or a mechanical guilt verdict", async () => {
    const project = await novel();
    const { mystery } = await fairMystery(project);
    const report = await auditFairness(project.repo, mystery.id);
    const rendered = JSON.stringify(report);

    expect(rendered).not.toMatch(/%/);
    expect(rendered).not.toMatch(/score/i);
    expect(rendered).not.toMatch(/probability/i);
    // Tamsin has motive, means and opportunity and did not do it. Nothing in
    // the audit decides otherwise — the author's culprit list is the only
    // statement of guilt anywhere.
    const architecture = await loadArchitecture(project.repo, mystery.id);
    const tamsin = architecture.suspects.find(
      (suspect) => (suspect.characterId as string) === project.tamsin.id,
    );
    expect(tamsin?.motive).toBeDefined();
    expect(tamsin?.means).toBeDefined();
    expect(tamsin?.opportunity).toBeDefined();
    expect(architecture.mystery.culpritIds.map(String)).not.toContain(project.tamsin.id);
    expect(rendered).not.toContain(project.tamsin.id);
  });
});

// ── Earliest solvability ────────────────────────────────────────────────────

describe("the earliest point the solution becomes reachable", () => {
  it("names the premise that holds it back, and compares it to the author's intent", async () => {
    const project = await novel();
    const { mystery } = await fairMystery(project);
    const solvability = await earliestSolvable(project.repo, mystery.id);

    expect(solvability.earliestSceneId).toBe(project.s4.id);
    expect(solvability.earliestPosition).toBe(4);
    expect(solvability.gatingPremise?.id).toBe(project.doorFact.id);
    expect(solvability.gatingPremise?.label).toBe("The cellar door only locks from the inside");
    expect(solvability.intendedSceneId).toBe(project.s4.id);
    expect(solvability.scenesFromIntended).toBe(0);
    expect(solvability.caveat).toMatch(/not a measurement of whether real readers solve it/);
  });

  it("counts the scenes when the last premise arrives later than intended", async () => {
    const project = await novel();
    const { mystery, plate } = await fairMystery(project);
    await project.repo.mysteries.updateClue(plate.id, {
      firstAppearance: project.s5.id,
      readerExposure: [project.s5.id],
    });

    const solvability = await earliestSolvable(project.repo, mystery.id);
    expect(solvability.earliestPosition).toBe(5);
    expect(solvability.scenesFromIntended).toBe(1);
  });

  it("says plainly when the solution is never reachable", async () => {
    const project = await novel();
    const { mystery, solution } = await fairMystery(project);
    const existing = (await project.repo.mysteries.listDeductions(mystery.id)).find(
      (entry) => entry.id === solution.id,
    );
    await project.repo.mysteries.updateDeduction(solution.id, {
      premises: [...(existing?.premises ?? []), project.grudgeFact.id],
    });

    const solvability = await earliestSolvable(project.repo, mystery.id);
    expect(solvability.earliestSceneId).toBeNull();
    expect(solvability.earliestPosition).toBeNull();
    expect(solvability.caveat).toMatch(/at least one premise never reaches the reader/);
  });

  it("says when there is no solution to reach", async () => {
    const project = await novel();
    const mystery = await project.repo.mysteries.addMystery({
      name: "The third vault",
      question: "Well?",
    });
    const solvability = await earliestSolvable(project.repo, mystery.id);
    expect(solvability.caveat).toMatch(/No deduction is marked as the solution/);
  });
});

// ── Accidental obviousness ──────────────────────────────────────────────────

describe("readers arriving at the culprit early", () => {
  it("finds a reader who suspects the culprit before the author intended", async () => {
    const project = await novel();
    const { mystery } = await fairMystery(project);

    const sharp = scriptedReader(
      "genre_expert",
      "Genre expert",
      [
        { id: project.one.id, suspicionOfCulprit: "high" },
        { id: project.two.id, suspicionOfCulprit: "high" },
      ],
      project.elias.id,
    );
    const casual = scriptedReader(
      "casual",
      "Casual reader",
      [
        { id: project.one.id, suspicionOfCulprit: "none" },
        { id: project.two.id, suspicionOfCulprit: "low" },
      ],
      project.elias.id,
    );

    const findings = await detectObviousness(project.repo, mystery.id, [sharp, casual]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.readerProfileName).toBe("Genre expert");
    expect(findings[0]?.culpritId).toBe(project.elias.id);
    expect(findings[0]?.suspectedAtPosition).toBe(1);
    expect(findings[0]?.intendedPosition).toBe(2);
    expect(findings[0]?.scenesEarly).toBe(1);
    expect(findings[0]?.caveat).toMatch(/Model analysis over the clue system the author recorded/);
  });

  it("does not treat a reader who gets there on time as a problem", async () => {
    const project = await novel();
    const { mystery } = await fairMystery(project);
    const onTime = scriptedReader(
      "casual",
      "Casual reader",
      [
        { id: project.one.id, suspicionOfCulprit: "low" },
        { id: project.two.id, suspicionOfCulprit: "high" },
      ],
      project.elias.id,
    );

    expect(await detectObviousness(project.repo, mystery.id, [onTime])).toEqual([]);
  });

  it("takes a higher threshold when the writer asks for one", async () => {
    const project = await novel();
    const { mystery } = await fairMystery(project);
    const hedging = scriptedReader(
      "genre_expert",
      "Genre expert",
      [
        { id: project.one.id, suspicionOfCulprit: "moderate" },
        { id: project.two.id, suspicionOfCulprit: "moderate" },
      ],
      project.elias.id,
    );

    expect(await detectObviousness(project.repo, mystery.id, [hedging])).toHaveLength(1);
    expect(
      await detectObviousness(project.repo, mystery.id, [hedging], { threshold: "high" }),
    ).toEqual([]);
  });
});

// ── Alibis against the timeline ─────────────────────────────────────────────

describe("alibis checked against the recorded timeline", () => {
  it("registers a contradiction when the project puts them somewhere else", async () => {
    const project = await novel();
    const { mystery } = await fairMystery(project);
    const findings = await checkAlibis(project.repo, mystery.id);

    const contradicted = findings.filter((finding) => finding.kind === "contradicted");
    expect(contradicted).toHaveLength(1);
    expect(contradicted[0]?.characterId).toBe(project.elias.id);
    expect(contradicted[0]?.statement).toBe(
      "Elias claims to have been at The hall, and the project records them at The cellar.",
    );
    expect(contradicted[0]?.sceneIds).toEqual([project.s3.id]);
  });

  it("leaves an alibi the timeline supports alone", async () => {
    const project = await novel();
    const { mystery } = await fairMystery(project);
    const findings = await checkAlibis(project.repo, mystery.id);
    expect(findings.some((finding) => finding.characterId === project.tamsin.id)).toBe(false);
  });

  it("notes an alibi with nobody to corroborate it", async () => {
    const project = await novel();
    const { mystery } = await fairMystery(project);
    const findings = await checkAlibis(project.repo, mystery.id);

    const uncorroborated = findings.filter((finding) => finding.kind === "uncorroborated");
    expect(uncorroborated).toHaveLength(1);
    expect(uncorroborated[0]?.characterId).toBe(project.rook.id);
    expect(uncorroborated[0]?.detail).toBe("He says he was walking the lane.");
  });

  it("says unchecked rather than clean when there is nothing to check", async () => {
    const project = await novel();
    const { mystery } = await fairMystery(project);
    await project.repo.mysteries.setSuspect({
      mysteryId: mystery.id,
      characterId: project.mara.id,
      alibi: { claim: "She says she was asleep." },
      evidenceFor: [],
      evidenceAgainst: [],
    });

    const findings = await checkAlibis(project.repo, mystery.id);
    const unchecked = findings.filter((finding) => finding.kind === "unchecked");

    expect(unchecked.map((finding) => finding.characterId).sort()).toEqual(
      [project.mara.id, project.vance.id].sort(),
    );
    expect(
      unchecked.find((finding) => finding.characterId === project.vance.id)?.statement,
    ).toMatch(/No alibi is recorded for Vance/);
    expect(unchecked.find((finding) => finding.characterId === project.mara.id)?.statement).toMatch(
      /names no scene it covers/,
    );
  });
});

// ── The store ───────────────────────────────────────────────────────────────

describe("the clue store", () => {
  it("treats the scene a clue appears in as a scene the reader was exposed to", async () => {
    const project = await novel();
    const { mystery } = await fairMystery(project);
    const clue = await project.repo.mysteries.addClue({
      mysteryId: mystery.id,
      description: "A second key, never on the board",
      firstAppearance: project.s2.id,
      readerExposure: [project.s5.id],
    });
    expect(clue.readerExposure).toEqual([project.s2.id, project.s5.id]);
  });

  it("keeps a suspect keyed to one mystery, and leaves the character alone", async () => {
    const project = await novel();
    const { mystery } = await fairMystery(project);
    const other = await project.repo.mysteries.addMystery({ name: "The fire", question: "Who?" });

    await project.repo.mysteries.setSuspect({
      mysteryId: other.id,
      characterId: project.elias.id,
      evidenceFor: [],
      evidenceAgainst: [],
    });
    expect(await project.repo.mysteries.listSuspects(other.id)).toHaveLength(1);
    expect(await project.repo.mysteries.listSuspects(mystery.id)).toHaveLength(4);

    await project.repo.mysteries.removeSuspect(other.id, project.elias.id);
    expect(await project.repo.mysteries.listSuspects(other.id)).toHaveLength(0);
    expect(await project.repo.getEntity(project.elias.id)).not.toBeNull();
  });

  it("merges into an existing suspect rather than duplicating them", async () => {
    const project = await novel();
    const { mystery } = await fairMystery(project);
    await project.repo.mysteries.setSuspect({
      mysteryId: mystery.id,
      characterId: project.rook.id,
      investigatorSuspicion: "The inspector likes him for it.",
      evidenceFor: [],
      evidenceAgainst: [],
    });

    const suspects = await project.repo.mysteries.listSuspects(mystery.id);
    const rook = suspects.find((entry) => (entry.characterId as string) === project.rook.id);
    expect(suspects).toHaveLength(4);
    expect(rook?.investigatorSuspicion).toBe("The inspector likes him for it.");
    // The alibi set earlier is still there.
    expect(rook?.alibi?.claim).toMatch(/walking the lane/);
  });
});

describe("errors", () => {
  it("carries a machine-readable code", () => {
    expect(new MysteryError("unknown_clue", "nope").code).toBe("unknown_clue");
  });
});
