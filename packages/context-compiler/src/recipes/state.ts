import { orderScenes } from "@jellytind/domain";
import type { Chapter, Fact, Scene } from "@jellytind/domain";
import { StoryTimeline, type CharacterState, type ObjectState } from "@jellytind/story-state";
import { PRIORITY, type Candidate } from "../candidate";
import type { ProjectReader } from "../reader";
import { provenance } from "./shared";

/**
 * Story state as compiled context.
 *
 * The point of the state engine is that a model never has to re-read the
 * manuscript to work out who is where and who knows what. So a recipe includes
 * the state **at the target's boundary** — reconstructed, not "latest" — and
 * says so in the provenance, because *state before Scene 42* and *state after
 * Scene 42* are different answers to different questions.
 *
 * Only confirmed transitions are used. Model-proposed state has not been
 * approved, so it is not fed back to a model as though it were canon.
 */
export async function buildTimeline(reader: ProjectReader): Promise<StoryTimeline> {
  const [scenes, chapters, transitions] = await Promise.all([
    reader.listScenes(),
    reader.listChapters(),
    reader.listStateTransitions(),
  ]);
  return new StoryTimeline(
    orderScenes(scenes, chapters).map((s) => s.id as string),
    transitions,
  );
}

function renderCharacterState(state: CharacterState, facts: ReadonlyMap<string, Fact>): string {
  const lines = [
    `location: ${state.locationId ?? "unrecorded"}`,
    `status: ${state.status}`,
    `carrying: ${state.inventory.length === 0 ? "nothing recorded" : state.inventory.join(", ")}`,
  ];
  if (state.knowledge.length === 0) {
    lines.push("knows: nothing recorded");
  } else {
    lines.push("knows:");
    for (const entry of state.knowledge) {
      const statement = facts.get(entry.factId)?.statement ?? "(fact not found)";
      lines.push(
        `  - ${entry.factId}: ${statement} [${entry.howLearned}, certainty ${String(
          entry.certainty,
        )}, learned in ${entry.learnedInSceneId}]`,
      );
    }
  }
  return [`STATE OF ${state.characterId} ${boundaryWords(state.asOf)}`, ...lines].join("\n");
}

function boundaryWords(asOf: { sceneId: string; position: "before" | "after" }): string {
  return `${asOf.position === "before" ? "immediately before" : "immediately after"} ${asOf.sceneId}`;
}

function renderObjectState(state: ObjectState): string {
  return [
    `STATE OF ${state.objectId} ${boundaryWords(state.asOf)}`,
    `owner: ${state.ownerId ?? "unowned"}`,
    `location: ${state.locationId ?? "unrecorded"}`,
  ].join("\n");
}

export interface StateCandidateInput {
  readonly timeline: StoryTimeline;
  readonly facts: ReadonlyMap<string, Fact>;
  /** Characters whose state matters to this operation. */
  readonly characterIds: readonly string[];
  readonly objectIds: readonly string[];
  /** The boundary to reconstruct at. */
  readonly sceneId: string;
  readonly position: "before" | "after";
  /** What the state is relevant *to*, for the provenance sentence. */
  readonly becauseOf: string;
}

/**
 * State candidates for one boundary. Returns nothing when the scene is not in
 * the story order (an unassigned scene has no place in the timeline yet).
 */
export function stateCandidates(input: StateCandidateInput): Candidate[] {
  const { timeline, sceneId, position, becauseOf } = input;
  try {
    timeline.positionOf(sceneId);
  } catch {
    return [];
  }

  const asOf = { sceneId, position } as const;
  const out: Candidate[] = [];

  for (const [index, characterId] of input.characterIds.entries()) {
    const state = timeline.characterStateAt(characterId, asOf);
    out.push({
      id: `${characterId}@${position}:${sceneId}`,
      kind: "character_state",
      label: `${characterId} state`,
      section: "storyState",
      priority: PRIORITY.state + index,
      provenance: provenance(
        "character_state",
        `story state of ${characterId} ${boundaryWords(asOf)}, who is involved in ${becauseOf}`,
        [becauseOf, characterId],
      ),
      full: renderCharacterState(state, input.facts),
    });
  }

  for (const objectId of input.objectIds) {
    const state = timeline.objectStateAt(objectId, asOf);
    out.push({
      id: `${objectId}@${position}:${sceneId}`,
      kind: "object_state",
      label: `${objectId} state`,
      section: "storyState",
      priority: PRIORITY.state + 1,
      provenance: provenance(
        "object_state",
        `story state of ${objectId} ${boundaryWords(asOf)}, which appears in ${becauseOf}`,
        [becauseOf, objectId],
      ),
      full: renderObjectState(state),
    });
  }

  const established = timeline.establishedFactsAt(asOf);
  if (established.length > 0) {
    out.push({
      id: `facts@${position}:${sceneId}`,
      kind: "facts",
      label: "Established facts",
      section: "storyState",
      priority: PRIORITY.state + 2,
      provenance: provenance(
        "established_fact",
        `facts true in the story world ${boundaryWords(asOf)}`,
        [becauseOf],
      ),
      full: [
        `FACTS TRUE ${boundaryWords(asOf).toUpperCase()}`,
        ...established.map(
          (id) => `- ${id}: ${input.facts.get(id)?.statement ?? "(fact not found)"}`,
        ),
      ].join("\n"),
      summary: `Established facts ${boundaryWords(asOf)}: ${established.join(", ")}`,
    });
  }

  return out;
}

/** Characters a scene involves, POV first, deduplicated. */
export function involvedCharacters(scene: Scene): string[] {
  return [
    ...new Set([
      ...(scene.pov === undefined ? [] : [scene.pov as string]),
      ...(scene.characterIds as readonly string[]),
    ]),
  ];
}

/** Characters and objects a whole chapter involves. */
export function chapterInvolvement(
  scenes: readonly Scene[],
  chapter: Chapter,
): { characterIds: string[]; objectIds: string[]; firstScene?: Scene } {
  const inChapter = scenes.filter((s) => s.chapterId === chapter.id);
  return {
    characterIds: [...new Set(inChapter.flatMap(involvedCharacters))],
    objectIds: [...new Set(inChapter.flatMap((s) => s.objectIds as readonly string[]))],
    ...(inChapter[0] !== undefined ? { firstScene: inChapter[0] } : {}),
  };
}
