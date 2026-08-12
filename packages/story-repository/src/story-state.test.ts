import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { TransitionError } from "@jellytind/story-state";
import { StoryRepository } from "./story-repository";
import { RepositoryError } from "./errors";

/**
 * A fixture timeline over a real project: Elias travels from London to the
 * manor and learns about the vault; the brass key changes hands; Mara leaves.
 */
async function novel() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "The Vault" });

  const elias = await repo.addCharacter({ name: "Elias", role: "protagonist" });
  const mara = await repo.addCharacter({ name: "Mara", role: "foil" });
  const manor = await repo.addLocation({ name: "Blackthorn Manor" });
  const london = await repo.addLocation({ name: "London" });
  const key = await repo.addObject({ name: "Brass Key" });
  const vault = await repo.addFact({ statement: "A vault lies beneath the manor." });
  const chapter = await repo.addChapter({ title: "Openings" });

  const s40 = await repo.addScene({ title: "Before", chapterId: chapter.id, pov: elias.id });
  const s41 = await repo.addScene({ title: "Discovery", chapterId: chapter.id, pov: mara.id });
  const s42 = await repo.addScene({
    title: "Arrival",
    chapterId: chapter.id,
    pov: elias.id,
    locationId: manor.id,
    characterIds: [elias.id, mara.id],
    objectIds: [key.id],
  });
  const s43 = await repo.addScene({ title: "Departure", chapterId: chapter.id, pov: mara.id });

  await repo.addStateTransitions([
    { sceneId: s40.id, kind: "character_location", subjectId: elias.id, value: london.id },
    { sceneId: s40.id, kind: "character_location", subjectId: mara.id, value: manor.id },
    { sceneId: s40.id, kind: "object_owner", subjectId: key.id, value: mara.id },
    { sceneId: s41.id, kind: "fact_established", subjectId: vault.id, value: vault.id },
    {
      sceneId: s41.id,
      kind: "knowledge_changed",
      subjectId: mara.id,
      value: vault.id,
      certainty: 1,
      knowledgeState: "known",
      sourceType: "witnessed",
    },
    { sceneId: s42.id, kind: "character_location", subjectId: elias.id, value: manor.id },
    { sceneId: s42.id, kind: "object_owner", subjectId: key.id, value: elias.id },
    {
      sceneId: s42.id,
      kind: "knowledge_changed",
      subjectId: elias.id,
      value: vault.id,
      certainty: 0.8,
      knowledgeState: "believed",
      sourceType: "told",
      sourceEntityId: mara.id,
    },
    { sceneId: s43.id, kind: "character_location", subjectId: mara.id, value: london.id },
  ]);

  return { store, repo, elias, mara, manor, london, key, vault, chapter, s40, s41, s42, s43 };
}

describe("state persistence", () => {
  it("stores transitions in the project as human-readable JSON", async () => {
    const { store, repo } = await novel();
    const raw = await store.readFile(".writer/state/transitions.json");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "{}")).toMatchObject({ seq: 9 });
    expect(await repo.listStateTransitions()).toHaveLength(9);
  });

  it("records state changes as reversible change sets", async () => {
    const { repo, s40, elias, london } = await novel();
    const before = (await repo.listChangeSets()).length;
    const [added] = await repo.addStateTransitions([
      { sceneId: s40.id, kind: "character_location", subjectId: elias.id, value: london.id },
    ]);

    const changes = await repo.listChangeSets();
    expect(changes.length).toBe(before + 1);
    expect(changes[0]?.operation).toBe("record_state");

    await repo.revertChangeSet(changes[0]?.id ?? "");
    expect((await repo.listStateTransitions()).some((t) => t.id === added?.id)).toBe(false);
  });

  it("refuses transitions that reference entities the project does not have", async () => {
    const { repo, s40, elias } = await novel();
    await expect(
      repo.addStateTransitions([
        { sceneId: s40.id, kind: "character_location", subjectId: elias.id, value: "LOC_9999" },
      ]),
    ).rejects.toThrow(RepositoryError);
  });

  it("refuses transitions of the wrong shape", async () => {
    const { repo, s40, elias, key } = await novel();
    await expect(
      repo.addStateTransitions([
        { sceneId: s40.id, kind: "character_location", subjectId: key.id, value: elias.id },
      ]),
    ).rejects.toThrow(TransitionError);
  });
});

describe("historical queries through the repository", () => {
  it("answers where a character is immediately before a scene", async () => {
    const { repo, elias, london, manor, s42 } = await novel();
    const timeline = await repo.getStoryTimeline();

    expect(timeline.characterStateBeforeScene(elias.id, s42.id).locationId).toBe(london.id);
    expect(timeline.characterStateAfterScene(elias.id, s42.id).locationId).toBe(manor.id);
  });

  it("answers whether a character knows a fact at a point", async () => {
    const { repo, mara, elias, vault, s41, s42 } = await novel();
    const timeline = await repo.getStoryTimeline();

    expect(timeline.knows(mara.id, vault.id, { sceneId: s41.id, position: "before" })).toBeNull();
    expect(timeline.knows(mara.id, vault.id, { sceneId: s41.id, position: "after" })).toMatchObject(
      { certainty: 1, state: "known", sourceType: "witnessed" },
    );
    expect(timeline.knows(elias.id, vault.id, { sceneId: s42.id, position: "before" })).toBeNull();
    expect(
      timeline.knows(elias.id, vault.id, { sceneId: s42.id, position: "after" }),
    ).not.toBeNull();
  });

  it("tracks object ownership across the timeline", async () => {
    const { repo, key, mara, elias, s42 } = await novel();
    const timeline = await repo.getStoryTimeline();
    expect(timeline.objectStateBeforeScene(key.id, s42.id).ownerId).toBe(mara.id);
    expect(timeline.objectStateAfterScene(key.id, s42.id).ownerId).toBe(elias.id);
  });

  it("orders the timeline by narrative order, not creation order", async () => {
    const { repo, s40, s41, s42, s43 } = await novel();
    const timeline = await repo.getStoryTimeline();
    expect(timeline.sceneOrder).toEqual([s40.id, s41.id, s42.id, s43.id]);
  });
});

describe("manual correction", () => {
  it("corrects a transition and every later answer with it", async () => {
    const { repo, elias, london, manor, s42 } = await novel();
    const wrong = (await repo.listStateTransitions()).find(
      (t) => t.sceneId === s42.id && t.kind === "character_location",
    );

    await repo.updateStateTransition(wrong?.id ?? "", { value: london.id });
    const timeline = await repo.getStoryTimeline();
    expect(timeline.characterStateAfterScene(elias.id, s42.id).locationId).toBe(london.id);
    expect(timeline.characterStateAfterScene(elias.id, s42.id).locationId).not.toBe(manor.id);
  });

  it("re-validates a correction", async () => {
    const { repo, key, s42 } = await novel();
    const move = (await repo.listStateTransitions()).find((t) => t.kind === "character_location");
    await expect(repo.updateStateTransition(move?.id ?? "", { value: key.id })).rejects.toThrow(
      TransitionError,
    );
    void s42;
  });

  it("deletes a transition", async () => {
    const { repo } = await novel();
    const first = (await repo.listStateTransitions())[0];
    await repo.deleteStateTransition(first?.id ?? "");
    expect((await repo.listStateTransitions()).some((t) => t.id === first?.id)).toBe(false);
  });
});

describe("proposed state is not canon", () => {
  it("keeps proposals out of reconstructed state until confirmed", async () => {
    const { repo, elias, vault, s43 } = await novel();
    const [proposed] = await repo.addStateTransitions(
      [
        {
          sceneId: s43.id,
          kind: "knowledge_changed",
          subjectId: elias.id,
          value: vault.id,
          certainty: 0.3,
          knowledgeState: "suspected",
          sourceType: "inferred",
        },
      ],
      { source: "agent", confirmationStatus: "proposed", modelId: "mock:test" },
    );
    expect(proposed?.confirmationStatus).toBe("proposed");
    expect(proposed?.confirmedAt).toBeUndefined();

    const timeline = await repo.getStoryTimeline();
    // Elias already knows the fact from SCENE_0042; the proposal adds nothing,
    // so check the transition itself is excluded rather than the derived state.
    expect(
      timeline.transitionsAtScene(s43.id).filter((t) => t.confirmationStatus === "proposed"),
    ).toHaveLength(1);
    expect(
      timeline.characterStateAfterScene(elias.id, s43.id).knowledge[0]?.acquiredAtSceneId,
    ).toBe((await repo.listScenes())[2]?.id);

    await repo.setTransitionStatus(proposed?.id ?? "", "confirmed");
    const stored = (await repo.listStateTransitions()).find((t) => t.id === proposed?.id);
    expect(stored?.confirmationStatus).toBe("confirmed");
    expect(stored?.confirmedAt).toBeDefined();
  });

  it("records provenance on every transition", async () => {
    const { repo, s43, mara, manor } = await novel();
    const [t] = await repo.addStateTransitions(
      [{ sceneId: s43.id, kind: "character_location", subjectId: mara.id, value: manor.id }],
      { source: "agent", confirmationStatus: "proposed", modelId: "mock:test" },
    );
    expect(t).toMatchObject({
      sceneId: s43.id,
      source: "agent",
      confirmationStatus: "proposed",
      modelId: "mock:test",
    });
    expect(t?.createdAt).toBeDefined();
  });
});

// ── Knowledge and belief ────────────────────────────────────────────────────

describe("knowledge through the repository", () => {
  /** Mara witnesses the truth; Elias is lied to about a false proposition. */
  async function beliefs() {
    const f = await novel();
    const { repo, mara, elias, s42, s43 } = f;
    const marcus = await repo.addCharacter({ name: "Marcus", role: "suspect" });
    const lie = await repo.addFact({
      statement: "Marcus is the killer.",
      objectiveTruth: false,
    });
    await repo.addStateTransitions([
      {
        sceneId: s43.id,
        kind: "knowledge_changed",
        subjectId: elias.id,
        value: lie.id,
        knowledgeState: "believed",
        sourceType: "deceived",
        sourceEntityId: mara.id,
        certainty: 0.9,
      },
    ]);
    return { ...f, marcus, lie, s42, s43 };
  }

  it("keeps objective truth separate from what a character believes", async () => {
    const { repo, elias, lie, s43 } = await beliefs();
    const fact = await repo.getEntity<{ objectiveTruth: boolean }>(lie.id);
    expect(fact?.objectiveTruth).toBe(false);

    const timeline = await repo.getStoryTimeline();
    const held = timeline.knows(elias.id, lie.id, { sceneId: s43.id, position: "after" });
    expect(held).toMatchObject({ state: "believed", sourceType: "deceived", certainty: 0.9 });
    // Believing it changed nothing about the world.
    expect((await repo.getEntity<{ objectiveTruth: boolean }>(lie.id))?.objectiveTruth).toBe(false);
  });

  it("reports a false belief", async () => {
    const { repo, elias, lie, s43 } = await beliefs();
    expect(await repo.getFalseBeliefs({ sceneId: s43.id, position: "after" })).toEqual([
      { characterId: elias.id, factId: lie.id, kind: "believes_false" },
    ]);
  });

  it("builds the knowledge graph for a fact, including who has no position", async () => {
    const { repo, mara, elias, marcus, vault, s42 } = await beliefs();
    const graph = await repo.getFactKnowledgeGraph(vault.id, {
      sceneId: s42.id,
      position: "after",
    });
    expect(graph.objectiveTruth).toBe(true);
    const byId = new Map(graph.holders.map((h) => [h.characterId, h]));
    expect(byId.get(mara.id)).toMatchObject({ state: "known", sourceType: "witnessed" });
    expect(byId.get(elias.id)).toMatchObject({ state: "believed", sourceEntityId: mara.id });
    expect(byId.get(marcus.id)).toMatchObject({ state: "unknown" });
  });

  it("traces how a character came by information", async () => {
    const { repo, mara, elias, vault, s42 } = await beliefs();
    const timeline = await repo.getStoryTimeline();
    expect(
      timeline
        .traceAcquisition(elias.id, vault.id, { sceneId: s42.id, position: "after" })
        .map((step) => `${step.characterId}:${step.sourceType}`),
    ).toEqual([`${elias.id}:told`, `${mara.id}:witnessed`]);
  });

  it("answers who holds a fact by a given point", async () => {
    const { repo, mara, elias, vault, s41, s42 } = await beliefs();
    const timeline = await repo.getStoryTimeline();
    expect(
      timeline
        .charactersWhoKnowFactAtScene(vault.id, { sceneId: s41.id, position: "after" })
        .map((r) => r.characterId),
    ).toEqual([mara.id]);
    expect(
      timeline
        .charactersWhoKnowFactAtScene(vault.id, { sceneId: s42.id, position: "after" })
        .map((r) => r.characterId)
        .sort(),
    ).toEqual([mara.id, elias.id].sort());
  });

  it("runs deterministic knowledge checks over the project", async () => {
    const { repo } = await beliefs();
    // The fixture is consistent — a deceiver need not hold what they tell.
    expect((await repo.checkKnowledge()).filter((v) => v.severity === "error")).toEqual([]);
  });

  it("catches a character passing on what they never held", async () => {
    const { repo, marcus, elias, vault, s43 } = await beliefs();
    await repo.addStateTransitions([
      {
        sceneId: s43.id,
        kind: "knowledge_changed",
        subjectId: marcus.id,
        value: vault.id,
        knowledgeState: "known",
        sourceType: "told",
        sourceEntityId: elias.id,
      },
    ]);
    void elias;
    const found = await repo.checkKnowledge();
    expect(found.map((v) => v.kind)).not.toContain("told_without_knowing");

    // Now one that genuinely cannot hold: Marcus is the source, and he holds nothing.
    await repo.addStateTransitions([
      {
        sceneId: s43.id,
        kind: "knowledge_changed",
        subjectId: elias.id,
        value: vault.id,
        knowledgeState: "known",
        sourceType: "told",
        sourceEntityId: marcus.id,
      },
    ]);
    expect((await repo.checkKnowledge()).map((v) => v.kind)).toContain("told_without_knowing");
  });
});

describe("fact deletion safety", () => {
  it("refuses to delete a fact a belief points at", async () => {
    const { repo, vault } = await novel();
    await expect(repo.deleteEntity(vault.id)).rejects.toThrow(/story-state transition/);
    expect(await repo.getEntity(vault.id)).not.toBeNull();
  });

  it("removes the citing transitions when unlinking", async () => {
    const { repo, vault } = await novel();
    const before = (await repo.listStateTransitions()).length;
    await repo.deleteEntity(vault.id, { mode: "unlink" });

    const after = await repo.listStateTransitions();
    expect(after.length).toBeLessThan(before);
    expect(after.some((t) => t.value === vault.id || t.subjectId === vault.id)).toBe(false);
    // The timeline stays answerable, with no dangling citation.
    const timeline = await repo.getStoryTimeline();
    expect(timeline.knownFactIds()).not.toContain(vault.id);
  });

  it("refuses to delete a character named as an information source", async () => {
    const { repo, mara } = await novel();
    await expect(repo.deleteEntity(mara.id)).rejects.toThrow(/story-state transition/);
  });
});

describe("revision persistence of knowledge", () => {
  it("reverting a change set restores the earlier information state", async () => {
    const { repo, elias, mara, vault, s43 } = await novel();
    const timeline = await repo.getStoryTimeline();
    expect(
      timeline.knows(elias.id, vault.id, { sceneId: s43.id, position: "after" }),
    ).not.toBeNull();

    await repo.addStateTransitions([
      {
        sceneId: s43.id,
        kind: "knowledge_changed",
        subjectId: elias.id,
        value: vault.id,
        knowledgeState: "unknown",
        sourceType: "unknown",
      },
    ]);
    const forgotten = await repo.getStoryTimeline();
    expect(forgotten.knows(elias.id, vault.id, { sceneId: s43.id, position: "after" })).toBeNull();

    await repo.revertChangeSet((await repo.listChangeSets())[0]?.id ?? "");
    const restored = await repo.getStoryTimeline();
    expect(
      restored.knows(elias.id, vault.id, { sceneId: s43.id, position: "after" }),
    ).not.toBeNull();
    void mara;
  });

  it("survives reopening the project", async () => {
    const { store, repo, elias, vault, s42 } = await novel();
    const reopened = await StoryRepository.openProject({ store });
    const timeline = await reopened.getStoryTimeline();
    expect(
      timeline.knows(elias.id, vault.id, { sceneId: s42.id, position: "after" }),
    ).toMatchObject({ state: "believed", sourceType: "told" });
    void repo;
  });
});

// ── Relationships over time ─────────────────────────────────────────────────

describe("relationship state through the repository", () => {
  /** Elias and Mara: warm allies who sour after the lie in SCENE_0042. */
  async function relationship() {
    const f = await novel();
    const { repo, elias, mara, s40, s42, s43, chapter } = f;
    const rel = await repo.addRelationship({
      characterAId: elias.id,
      characterBId: mara.id,
      type: "allies",
      status: "warm",
      description: "Thrown together by the same investigation.",
    });
    await repo.addStateTransitions([
      { sceneId: s40.id, kind: "relationship_event", subjectId: rel.id, value: "first_meeting" },
      {
        sceneId: s40.id,
        kind: "relationship_dimension",
        subjectId: rel.id,
        value: "",
        dimension: "trust",
        level: "moderate",
        magnitude: 0.48,
      },
      {
        sceneId: s42.id,
        kind: "relationship_dimension",
        subjectId: rel.id,
        value: "",
        dimension: "trust",
        level: "low",
        magnitude: 0.31,
        note: "Mara lies about the vault.",
      },
      { sceneId: s42.id, kind: "relationship_status", subjectId: rel.id, value: "suspicious" },
      { sceneId: s43.id, kind: "relationship_type", subjectId: rel.id, value: "adversaries" },
    ]);
    return { ...f, rel, chapter };
  }

  it("answers what the relationship was at a point, not what it became", async () => {
    const { repo, rel, s42, s43 } = await relationship();

    const before = await repo.getRelationshipBeforeScene(rel.id, s42.id);
    expect(before).toMatchObject({ type: "allies", status: "warm" });
    expect(before.dimensions.trust).toMatchObject({ magnitude: 0.48, level: "moderate" });

    const after = await repo.getRelationshipAfterScene(rel.id, s42.id);
    expect(after).toMatchObject({ type: "allies", status: "suspicious" });
    expect(after.dimensions.trust).toMatchObject({
      magnitude: 0.31,
      previous: { magnitude: 0.48 },
      reason: "Mara lies about the vault.",
    });

    expect((await repo.getRelationshipAfterScene(rel.id, s43.id)).type).toBe("adversaries");
  });

  it("keeps identity across every change", async () => {
    const { repo, rel, elias, mara, s43 } = await relationship();
    const latest = await repo.getRelationshipAfterScene(rel.id, s43.id);
    expect(latest).toMatchObject({
      relationshipId: rel.id,
      characterAId: elias.id,
      characterBId: mara.id,
    });
  });

  it("gives a character's relationships as they stood at a moment", async () => {
    const { repo, elias, s40, s43 } = await relationship();
    const early = await repo.getRelationshipsForCharacter(elias.id, {
      sceneId: s40.id,
      position: "before",
    });
    expect(early).toHaveLength(1);
    expect(early[0]).toMatchObject({ type: "allies", status: "warm" });

    const late = await repo.getRelationshipsForCharacter(elias.id, {
      sceneId: s43.id,
      position: "after",
    });
    expect(late[0]).toMatchObject({ type: "adversaries", status: "suspicious" });
  });

  it("gives the history and the changes within a chapter", async () => {
    const { repo, rel, chapter } = await relationship();
    const history = await repo.getRelationshipHistory(rel.id);
    expect(history.map((c) => c.label)).toEqual([
      "first_meeting",
      "trust",
      "trust",
      "status",
      "type",
    ]);

    const inChapter = await repo.getRelationshipChangesInChapter(chapter.id);
    expect(inChapter).toHaveLength(history.length);
    expect(inChapter.find((c) => c.label === "type")?.to).toBe("adversaries");
  });

  it("refuses invalid subjects and characters", async () => {
    const { repo, elias, s40 } = await relationship();
    await expect(
      repo.addStateTransitions([
        { sceneId: s40.id, kind: "relationship_status", subjectId: elias.id, value: "warm" },
      ]),
    ).rejects.toThrow(/needs a relationship subject/);

    await expect(
      repo.addRelationship({
        characterAId: elias.id,
        characterBId: "CHAR_9999" as typeof elias.id,
        type: "allies",
      }),
    ).rejects.toThrow(RepositoryError);
  });
});

describe("relationship deletion safety", () => {
  it("refuses to delete a relationship with recorded history", async () => {
    const { repo, elias, mara, s40 } = await novel();
    const rel = await repo.addRelationship({
      characterAId: elias.id,
      characterBId: mara.id,
      type: "allies",
    });
    await repo.addStateTransitions([
      { sceneId: s40.id, kind: "relationship_status", subjectId: rel.id, value: "warm" },
    ]);

    await expect(repo.deleteEntity(rel.id)).rejects.toThrow(/story-state transition/);
    expect(await repo.getEntity(rel.id)).not.toBeNull();
  });

  it("removes the history when unlinking", async () => {
    const { repo, elias, mara, s40 } = await novel();
    const rel = await repo.addRelationship({
      characterAId: elias.id,
      characterBId: mara.id,
      type: "allies",
    });
    await repo.addStateTransitions([
      { sceneId: s40.id, kind: "relationship_status", subjectId: rel.id, value: "warm" },
    ]);

    await repo.deleteEntity(rel.id, { mode: "unlink" });
    expect((await repo.listStateTransitions()).some((t) => t.subjectId === rel.id)).toBe(false);
    expect((await repo.getStoryTimeline()).knownRelationshipIds()).not.toContain(rel.id);
  });

  it("refuses to delete a character a relationship depends on", async () => {
    const { repo, elias, mara } = await novel();
    await repo.addRelationship({
      characterAId: elias.id,
      characterBId: mara.id,
      type: "allies",
    });
    await expect(repo.deleteEntity(elias.id)).rejects.toThrow(RepositoryError);
  });
});
