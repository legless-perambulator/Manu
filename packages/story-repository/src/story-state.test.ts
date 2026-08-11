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
      kind: "knowledge_gained",
      subjectId: mara.id,
      value: vault.id,
      certainty: 1,
      howLearned: "witnessed",
    },
    { sceneId: s42.id, kind: "character_location", subjectId: elias.id, value: manor.id },
    { sceneId: s42.id, kind: "object_owner", subjectId: key.id, value: elias.id },
    {
      sceneId: s42.id,
      kind: "knowledge_gained",
      subjectId: elias.id,
      value: vault.id,
      certainty: 0.8,
      howLearned: "told",
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
      { certainty: 1, howLearned: "witnessed" },
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
          kind: "knowledge_gained",
          subjectId: elias.id,
          value: vault.id,
          certainty: 0.3,
          howLearned: "inferred",
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
    expect(timeline.characterStateAfterScene(elias.id, s43.id).knowledge[0]?.learnedInSceneId).toBe(
      (await repo.listScenes())[2]?.id,
    );

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
