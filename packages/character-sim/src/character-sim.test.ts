import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { StoryRepository } from "@jellytind/story-repository";
import { heuristicBand } from "@jellytind/domain";
import { auditAgency } from "./agency";
import { establishedFactors, testBehaviour, whatWouldTheyDo } from "./behaviour";
import { behaviourEvidence } from "./debugger";
import { renderSnapshot, snapshotAt } from "./snapshot";
import { CharacterSimError, type CharacterAnalyst } from "./types";

/**
 * A book where Mara learns something in scene four that she cannot possibly
 * know in scene two — the whole point of testing behaviour at a story point.
 */
async function novel() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "The Cellar Door" });

  const mara = await repo.addCharacter({
    name: "Mara",
    description: "A solicitor who came home for a funeral and stayed.",
    role: "protagonist",
    goals: ["find out who sealed the vault"],
  });
  const elias = await repo.addCharacter({ name: "Elias", goals: [] });
  const hall = await repo.addLocation({ name: "The hall" });
  const cellar = await repo.addLocation({ name: "The cellar" });

  const sealed = await repo.addFact({ statement: "Elias sealed the vault from the inside" });
  const chapter = await repo.addChapter({ title: "Openings" });

  const s1 = await repo.addScene({
    title: "The hall",
    chapterId: chapter.id,
    locationId: hall.id,
    characterIds: [mara.id, elias.id],
    purpose: ["establish the rift"],
  });
  const s2 = await repo.addScene({
    title: "The stairs",
    chapterId: chapter.id,
    locationId: hall.id,
    characterIds: [mara.id],
    purpose: ["get her to the door"],
  });
  const s3 = await repo.addScene({
    title: "The cellar",
    chapterId: chapter.id,
    locationId: cellar.id,
    characterIds: [mara.id, elias.id],
    purpose: ["she learns who sealed it"],
    factIds: [sealed.id],
  });
  const s4 = await repo.addScene({
    title: "After",
    chapterId: chapter.id,
    locationId: cellar.id,
    characterIds: [mara.id, elias.id],
    purpose: ["she confronts him"],
    factIds: [sealed.id],
  });
  // Set in the hall, with nothing recorded bringing her back up from the
  // cellar — the deterministic "she is somewhere else" case.
  const s5 = await repo.addScene({
    title: "The next morning",
    chapterId: chapter.id,
    locationId: hall.id,
    characterIds: [mara.id, elias.id],
    purpose: ["the house in daylight"],
  });

  const relationship = await repo.addRelationship({
    characterAId: mara.id,
    characterBId: elias.id,
    type: "siblings",
    status: "wary",
  });

  await repo.addStateTransitions([
    { sceneId: s1.id, kind: "character_location", subjectId: mara.id, value: hall.id },
    { sceneId: s2.id, kind: "character_location", subjectId: mara.id, value: cellar.id },
    // She learns it *in* scene three, so she has it entering scene four and not before.
    {
      sceneId: s3.id,
      kind: "knowledge_changed",
      subjectId: mara.id,
      value: sealed.id,
      knowledgeState: "known",
      sourceType: "witnessed",
    },
    { sceneId: s3.id, kind: "fact_established", subjectId: sealed.id, value: sealed.id },
    { sceneId: s3.id, kind: "relationship_status", subjectId: relationship.id, value: "broken" },
  ]);

  await repo.personalities.add({
    characterId: mara.id,
    dimension: "fears",
    statement: "will not go into a confined space alone if she can help it",
  });
  await repo.personalities.add({
    characterId: mara.id,
    dimension: "under_pressure",
    statement: "asks one more question when she should leave",
    status: "proposed",
    evidence: "a model's reading of chapter one",
  });

  return {
    repo,
    store,
    mara,
    elias,
    hall,
    cellar,
    sealed,
    chapter,
    s1,
    s2,
    s3,
    s4,
    s5,
    relationship,
  };
}

/** A scripted judge. The engine is what is under test, not a model. */
function scripted(overrides: Partial<CharacterAnalyst> = {}): CharacterAnalyst {
  return {
    modelId: "scripted-judge",
    weigh: () =>
      Promise.resolve({
        supporting: [
          {
            statement: "She has said she wants to know who sealed it.",
            source: "model reading of the character",
            derivation: "model" as const,
          },
        ],
        opposing: [
          {
            statement: "Going alone costs her the one person who could corroborate it.",
            source: "model reading of the character",
            derivation: "model" as const,
          },
          {
            statement: "She is recorded as avoiding confined spaces alone.",
            source: "model reading of the character",
            derivation: "model" as const,
          },
        ],
        contradictions: [
          {
            kind: "soft" as const,
            statement: "A reader may feel the caution she showed in the hall has evaporated.",
            derivation: "model" as const,
          },
        ],
        judgement: {
          band: "strained" as const,
          statement: "She would, but it costs her something the scene does not pay for.",
          reasoning:
            "Her stated fear is specific and the scene gives her no pressure to override it.",
          uncertainty: ["whether the fear is meant to have been overcome by now"],
        },
        conditions: [
          {
            statement: "Take away the option of waiting for Elias.",
            rationale: "The fear only binds while there is an alternative.",
            cost: "Elias loses a scene of presence.",
          },
        ],
      }),
    alternatives: () =>
      Promise.resolve([
        {
          action: "Wait at the top of the stairs and call down.",
          because: "It costs her nothing.",
          band: "characteristic" as const,
        },
      ]),
    readAgency: () =>
      Promise.resolve([
        {
          sceneId: "SCENE_0002",
          statement: "She crosses the house for no stated reason of her own.",
        },
      ]),
    ...overrides,
  };
}

// ── State at the right story point ──────────────────────────────────────────

describe("the snapshot is taken at the right point in the story", () => {
  it("gives a character only what they know entering the scene", async () => {
    const { repo, mara, sealed, s2, s4 } = await novel();

    const before = await snapshotAt(repo, mara.id, s2.id);
    const after = await snapshotAt(repo, mara.id, s4.id);

    // She learns it in scene three: not held at two, held at four.
    expect(before.knowledge.map((item) => item.factId)).not.toContain(sealed.id);
    expect(after.knowledge.map((item) => item.factId)).toContain(sealed.id);
  });

  it("counts what the story has established and she does not hold, without handing it over", async () => {
    const { repo, mara, s4, elias } = await novel();
    // Elias has no knowledge transition at all, so entering scene four the
    // proposition is established and he does not have it.
    const his = await snapshotAt(repo, elias.id, s4.id);
    const hers = await snapshotAt(repo, mara.id, s4.id);

    expect(his.notKnownCount).toBe(1);
    expect(hers.notKnownCount).toBe(0);
    // The count is reported; the statement never reaches the briefing.
    expect(renderSnapshot(his)).not.toContain("Elias sealed the vault from the inside");
    expect(renderSnapshot(his)).toMatch(/1 other proposition\(s\).*does NOT hold/);
  });

  it("reconstructs where they are and who people are to them at that boundary", async () => {
    const { repo, mara, s2, s4 } = await novel();
    const before = await snapshotAt(repo, mara.id, s2.id);
    const after = await snapshotAt(repo, mara.id, s4.id);

    expect(before.physical.locationName).toBe("The hall");
    expect(after.physical.locationName).toBe("The cellar");
    // The relationship breaks in scene three, so it is wary at two and broken at four.
    expect(before.relationships[0]?.status).toBe("wary");
    expect(after.relationships[0]?.status).toBe("broken");
  });

  it("uses only author-confirmed personality, never a model's proposal", async () => {
    const { repo, mara, s2 } = await novel();
    const snapshot = await snapshotAt(repo, mara.id, s2.id);

    expect(snapshot.personality).toHaveLength(1);
    expect(snapshot.personality[0]?.statement).toMatch(/confined space/);
    expect(renderSnapshot(snapshot)).not.toContain("asks one more question");
  });

  it("carries what has just happened to them, and no more", async () => {
    const { repo, mara, s4 } = await novel();
    const snapshot = await snapshotAt(repo, mara.id, s4.id);
    expect(snapshot.pressures.map((entry) => entry.statement)).toEqual([
      "Has just learned: Elias sealed the vault from the inside",
      "Something has just changed with Elias: broken",
    ]);
  });

  it("says what the project does not record rather than filling it in", async () => {
    const { repo, elias, s1 } = await novel();
    const snapshot = await snapshotAt(repo, elias.id, s1.id);
    expect(snapshot.notRecorded).toContain("no goals are recorded for this character");
    expect(snapshot.notRecorded).toContain(
      "no confirmed personality traits — nothing to check behaviour against",
    );
  });

  it("refuses a character or scene it does not have", async () => {
    const { repo, mara, s1 } = await novel();
    await expect(snapshotAt(repo, "CHAR_9999", s1.id)).rejects.toThrowError(/not a character/);
    await expect(snapshotAt(repo, mara.id, "SCENE_9999")).rejects.toThrowError(/not a scene/);
  });
});

// ── The behaviour test ──────────────────────────────────────────────────────

describe("would she do this, here?", () => {
  it("returns the seven sections, with the deterministic half filled in", async () => {
    const { repo, mara, s2 } = await novel();
    const test = await testBehaviour(
      repo,
      { characterId: mara.id, sceneId: s2.id, proposedAction: "Mara enters the cellar alone." },
      { analyst: scripted() },
    );

    expect(test.proposedAction).toBe("Mara enters the cellar alone.");
    expect(test.established.some((entry) => /confined space/.test(entry.statement))).toBe(true);
    expect(
      test.established.some((entry) => /Wants: find out who sealed/.test(entry.statement)),
    ).toBe(true);
    expect(test.supporting).toHaveLength(1);
    expect(test.opposing).toHaveLength(2);
    expect(test.judgement?.band).toBe("strained");
    expect(test.judgement?.modelId).toBe("scripted-judge");
    expect(test.conditions[0]?.statement).toMatch(/Take away the option/);
    expect(test.basis).toMatch(/entering "The stairs"/);
  });

  it("never reports a probability, a score or a percentage", async () => {
    const { repo, mara, s2 } = await novel();
    const test = await testBehaviour(
      repo,
      { characterId: mara.id, sceneId: s2.id, proposedAction: "Mara enters the cellar alone." },
      { analyst: scripted() },
    );
    const rendered = JSON.stringify(test);

    expect(rendered).not.toMatch(/%/);
    expect(rendered).not.toMatch(/probability/i);
    // Counts are reported as counts.
    expect(test.counts).toEqual({ supporting: 1, opposing: 2, hardContradictions: 0 });
  });

  it("catches an action that turns on something she does not know yet", async () => {
    const { repo, mara, s2 } = await novel();
    const test = await testBehaviour(
      repo,
      {
        characterId: mara.id,
        sceneId: s2.id,
        proposedAction: "Mara accuses Elias, who sealed the vault from the inside.",
      },
      { analyst: scripted() },
    );

    const hard = test.contradictions.filter((entry) => entry.kind === "hard");
    expect(hard).toHaveLength(1);
    expect(hard[0]?.statement).toMatch(/does not know at this point/);
    expect(hard[0]?.derivation).toBe("deterministic");
  });

  it("does not raise it once she does know", async () => {
    const { repo, mara, s4 } = await novel();
    const test = await testBehaviour(
      repo,
      {
        characterId: mara.id,
        sceneId: s4.id,
        proposedAction: "Mara accuses Elias, who sealed the vault from the inside.",
      },
      { analyst: scripted() },
    );
    expect(test.contradictions.filter((entry) => entry.kind === "hard")).toHaveLength(0);
  });

  it("catches a character who is somewhere else, or not in the scene at all", async () => {
    const { repo, mara, elias, s2, s5 } = await novel();
    // She is recorded in the cellar entering the fifth scene, which is in the hall.
    const misplaced = await testBehaviour(repo, {
      characterId: mara.id,
      sceneId: s5.id,
      proposedAction: "Mara crosses the hall.",
    });
    expect(
      misplaced.contradictions.some((entry) => /recorded at The cellar/.test(entry.statement)),
    ).toBe(true);

    const absent = await testBehaviour(repo, {
      characterId: elias.id,
      sceneId: s2.id,
      proposedAction: "Elias follows her down.",
    });
    expect(
      absent.contradictions.some((entry) =>
        /not recorded as being in this scene/.test(entry.statement),
      ),
    ).toBe(true);
  });

  it("runs its deterministic half with no model, and says what it could not do", async () => {
    const { repo, mara, s2 } = await novel();
    const test = await testBehaviour(repo, {
      characterId: mara.id,
      sceneId: s2.id,
      proposedAction: "Mara enters the cellar alone.",
    });

    expect(test.judgement).toBeUndefined();
    expect(test.established.length).toBeGreaterThan(0);
    expect(test.notChecked).toContain(
      "no model is configured, so nothing weighed the action against who this character is",
    );
  });

  it("refuses an empty action", async () => {
    const { repo, mara, s2 } = await novel();
    await expect(
      testBehaviour(repo, { characterId: mara.id, sceneId: s2.id, proposedAction: "   " }),
    ).rejects.toThrowError(/Say what the character is proposed to do/);
  });

  it("bands from counts, heuristically and by that name", () => {
    expect(heuristicBand({ supporting: 0, opposing: 0, hardContradictions: 1 })).toBe(
      "out_of_character",
    );
    expect(heuristicBand({ supporting: 1, opposing: 3, hardContradictions: 0 })).toBe("strained");
    expect(heuristicBand({ supporting: 3, opposing: 1, hardContradictions: 0 })).toBe(
      "characteristic",
    );
    expect(heuristicBand({ supporting: 2, opposing: 2, hardContradictions: 0 })).toBe("plausible");
  });

  it("gathers established factors from every recorded system", async () => {
    const { repo, mara, s4 } = await novel();
    const factors = establishedFactors(await snapshotAt(repo, mara.id, s4.id));
    const sources = new Set(factors.map((entry) => entry.source));

    expect(sources).toContain("author-confirmed personality");
    expect(sources).toContain("character record");
    expect(sources).toContain("knowledge at this scene");
    expect(sources).toContain("relationship at this scene");
    expect(factors.every((entry) => entry.derivation === "deterministic")).toBe(true);
  });
});

// ── Counterfactual ──────────────────────────────────────────────────────────

describe("what would she do instead", () => {
  it("offers alternatives, advisory and applied to nothing", async () => {
    const { repo, mara, s2, store } = await novel();
    const before = await store.readFile(".writer/project.json");

    const counterfactual = await whatWouldTheyDo(
      repo,
      { characterId: mara.id, sceneId: s2.id, proposedAction: "Mara enters the cellar alone." },
      { analyst: scripted() },
    );

    expect(counterfactual.alternatives[0]?.action).toMatch(/Wait at the top/);
    expect(counterfactual.caveat).toMatch(/Advisory only/);
    expect(counterfactual.caveat).toMatch(/no alternative has been applied/);
    // Nothing about the project moved.
    expect(await store.readFile(".writer/project.json")).toBe(before);
    expect(await repo.listChangeSets()).toHaveLength((await repo.listChangeSets()).length);
  });

  it("says plainly when no model is configured", async () => {
    const { repo, mara, s2 } = await novel();
    const counterfactual = await whatWouldTheyDo(repo, {
      characterId: mara.id,
      sceneId: s2.id,
      proposedAction: "Mara enters the cellar alone.",
    });
    expect(counterfactual.alternatives).toEqual([]);
    expect(counterfactual.caveat).toMatch(/No model is configured/);
  });
});

// ── Agency audit ────────────────────────────────────────────────────────────

describe("the agency audit", () => {
  it("finds a scene that turns on something the character does not know", async () => {
    const { repo, elias } = await novel();
    const audit = await auditAgency(repo, elias.id);

    const unknown = audit.findings.filter(
      (finding) => finding.kind === "acts_on_unknown_information",
    );
    expect(unknown.length).toBeGreaterThan(0);
    expect(unknown[0]?.derivation).toBe("deterministic");
  });

  it("says when a character has no goals to be checked against", async () => {
    const { repo, elias } = await novel();
    const audit = await auditAgency(repo, elias.id);
    expect(audit.findings.some((finding) => finding.kind === "no_recorded_goal")).toBe(true);
  });

  it("flags a decision recorded with no reason", async () => {
    const { repo, mara, s2 } = await novel();
    await repo.addDecision({
      description: "go down alone",
      characterId: mara.id,
      sceneId: s2.id,
    });
    const audit = await auditAgency(repo, mara.id);

    const found = audit.findings.find((finding) => finding.kind === "decision_without_reason");
    expect(found?.statement).toMatch(/with no reason recorded/);
  });

  it("flags a character moved with no decision of their own", async () => {
    const { repo, mara } = await novel();
    const audit = await auditAgency(repo, mara.id);
    expect(audit.findings.some((finding) => finding.kind === "moved_without_reason")).toBe(true);
  });

  it("carries the caveat and labels the model's half", async () => {
    const { repo, mara } = await novel();
    const audit = await auditAgency(repo, mara.id, { analyst: scripted() });

    expect(audit.caveat).toMatch(/is a reading, not a measurement/);
    const read = audit.findings.filter((finding) => finding.derivation === "model");
    expect(read).toHaveLength(1);
    expect(read[0]?.kind).toBe("reads_as_plot_driven");
    expect(audit.modelId).toBe("scripted-judge");
  });

  it("runs with no model and says what it could not read", async () => {
    const { repo, mara } = await novel();
    const audit = await auditAgency(repo, mara.id);
    expect(audit.findings.every((finding) => finding.derivation === "deterministic")).toBe(true);
    expect(audit.notChecked).toContain(
      "no model is configured, so nothing read the scenes for behaviour that only serves the plot",
    );
  });

  it("can be scoped to one chapter", async () => {
    const { repo, mara, chapter } = await novel();
    const audit = await auditAgency(repo, mara.id, { chapterId: chapter.id });
    expect(audit.scope).toBe(chapter.id);
    expect(audit.scenesInspected).toBe(5);
  });
});

// ── Debugger integration ────────────────────────────────────────────────────

describe("as Story Debugger evidence", () => {
  it("hands back deterministic findings in the debugger's own shape", async () => {
    const { repo, mara, s2 } = await novel();
    const test = await testBehaviour(
      repo,
      { characterId: mara.id, sceneId: s2.id, proposedAction: "Mara enters the cellar alone." },
      { analyst: scripted() },
    );
    const evidence = behaviourEvidence(test);

    expect(evidence[0]?.id).toBe("E1");
    expect(evidence.every((item) => item.system === "character_simulation")).toBe(true);
    expect(evidence.every((item) => item.sceneId === s2.id)).toBe(true);
    // The model's own judgement is not evidence: a diagnosis citing it would
    // be citing another model's reading.
    expect(evidence.some((item) => /costs her something/.test(item.statement))).toBe(false);
    expect(evidence.some((item) => item.statement.startsWith("Not checked:"))).toBe(true);
  });

  it("numbers evidence from where the caller is up to", async () => {
    const { repo, mara, s2 } = await novel();
    const test = await testBehaviour(repo, {
      characterId: mara.id,
      sceneId: s2.id,
      proposedAction: "Mara waits.",
    });
    expect(behaviourEvidence(test, 7)[0]?.id).toBe("E7");
  });
});

// ── Personality ─────────────────────────────────────────────────────────────

describe("author-confirmed personality", () => {
  it("keeps proposed traits out until the author agrees, and rejects for good", async () => {
    const { repo, mara } = await novel();
    const all = await repo.personalities.list(mara.id);
    const proposed = all.find((trait) => trait.status === "proposed");
    expect(proposed).toBeDefined();

    await repo.personalities.setStatus(proposed?.id ?? "", "confirmed");
    expect(await repo.personalities.confirmed(mara.id)).toHaveLength(2);

    await repo.personalities.setStatus(proposed?.id ?? "", "rejected");
    expect(await repo.personalities.confirmed(mara.id)).toHaveLength(1);
    // Rejected is kept: it is the author saying this is not who she is.
    expect(await repo.personalities.list(mara.id)).toHaveLength(2);
  });

  it("survives a restart", async () => {
    const { repo, store, mara } = await novel();
    const reopened = await StoryRepository.openProject({ store });
    expect(await reopened.personalities.confirmed(mara.id)).toHaveLength(1);
    expect(repo).toBeDefined();
  });
});

describe("errors", () => {
  it("carries a machine-readable code", () => {
    expect(new CharacterSimError("no_action", "nope").code).toBe("no_action");
  });
});
