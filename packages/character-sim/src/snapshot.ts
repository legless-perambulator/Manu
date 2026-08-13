import { orderScenes } from "@jellytind/domain";
import type { Character, PersonalityTrait, Scene } from "@jellytind/domain";
import { holdsAsTrue } from "@jellytind/story-state";
import type { StoryRepository } from "@jellytind/story-repository";
import { CharacterSimError } from "./types";

/**
 * Everything a character is, at one point in the story.
 *
 * This is the acceptance criterion made into an object. Every field is
 * reconstructed at the boundary **entering** the scene — the only state that
 * can explain a choice made inside it — and the two things that would ruin the
 * answer are excluded by construction:
 *
 * - **No future.** State is replayed to `{ sceneId, position: "before" }`. A
 *   transition anchored later in the book cannot reach back into it.
 * - **No borrowed knowledge.** Facts the character does not hold are counted
 *   and reported as a count, never handed over. Whether she would walk into the
 *   trap depends on what *she* believes; what the reader knows is a different
 *   question, and mixing them is how a simulator starts answering it.
 *
 * Everything here is deterministic. A model is not involved in building it
 * (docs/SIMULATIONS.md).
 */
export interface CharacterSnapshot {
  readonly characterId: string;
  readonly name: string;
  readonly sceneId: string;
  readonly sceneTitle: string;
  readonly chapterTitle?: string;
  /** 1-based position in story order — what "at this point" means. */
  readonly position: number;

  readonly profile: {
    readonly description: string;
    readonly role: string;
    readonly goals: readonly string[];
    readonly notes: string;
  };
  /** Confirmed traits only. Proposed readings never reach a simulation. */
  readonly personality: readonly PersonalityTrait[];

  readonly physical: {
    readonly status: string;
    readonly presence: string;
    readonly locationId?: string;
    readonly locationName?: string;
    readonly travellingTo?: string;
    readonly inventory: readonly string[];
  };

  /** What this character holds as true, entering the scene. Theirs alone. */
  readonly knowledge: ReadonlyArray<{
    readonly factId: string;
    readonly statement: string;
    readonly state: string;
    readonly sourceType?: string;
    readonly sinceSceneId?: string;
  }>;
  /**
   * Propositions the story has established that this character does **not**
   * hold. Counted, never listed into the simulation — the count is what makes
   * "she cannot act on this" checkable without leaking the content.
   */
  readonly notKnownCount: number;

  readonly relationships: ReadonlyArray<{
    readonly relationshipId: string;
    readonly withId: string;
    readonly withName: string;
    readonly type: string;
    readonly status: string;
  }>;

  /** Scenes they were in before this one, nearest first. */
  readonly memories: ReadonlyArray<{
    readonly sceneId: string;
    readonly title: string;
    readonly position: number;
    readonly scenesAgo: number;
  }>;

  /** What is bearing on them right now, from the record. Deterministic. */
  readonly pressures: ReadonlyArray<{ readonly statement: string; readonly basis: string }>;

  readonly circumstances: {
    readonly sceneTitle: string;
    readonly purpose: readonly string[];
    readonly presentCharacterIds: readonly string[];
    readonly presentCharacterNames: readonly string[];
    readonly locationId?: string;
    readonly objectIds: readonly string[];
  };

  /** What the project does not record. Silence is not a claim. */
  readonly notRecorded: readonly string[];
}

const MEMORY_LIMIT = 8;
const RECENT_PRESSURE_WINDOW = 3;

/**
 * Compile a character at a scene.
 *
 * Everything is asked of the boundary *before* the scene: what she knows
 * walking in, where she is, who she is to the people in the room, what has just
 * happened to her.
 */
export async function snapshotAt(
  repo: StoryRepository,
  characterId: string,
  sceneId: string,
): Promise<CharacterSnapshot> {
  const [characters, scenes, chapters, locations, facts, timeline] = await Promise.all([
    repo.listCharacters(),
    repo.listScenes(),
    repo.listChapters(),
    repo.listLocations(),
    repo.listFacts(),
    repo.getStoryTimeline(),
  ]);

  const character = characters.find((entry) => (entry.id as string) === characterId);
  if (character === undefined) {
    throw new CharacterSimError(
      "unknown_character",
      `${characterId} is not a character in this project.`,
      { details: { characterId } },
    );
  }
  const scene = scenes.find((entry) => (entry.id as string) === sceneId);
  if (scene === undefined) {
    throw new CharacterSimError("unknown_scene", `${sceneId} is not a scene in this project.`, {
      details: { sceneId },
    });
  }

  const ordered = orderScenes(scenes, chapters);
  const at = ordered.findIndex((entry) => (entry.id as string) === sceneId);
  const boundary = { sceneId, position: "before" } as const;
  const name = (id: string) => characters.find((c) => (c.id as string) === id)?.name ?? id;

  // ── Who they are ──────────────────────────────────────────────────────────
  const personality = await repo.personalities.confirmed(characterId);

  // ── Where and what they are, entering the scene ───────────────────────────
  const state = timeline.characterStateAt(characterId, boundary);
  const locationName =
    state.locationId === undefined
      ? undefined
      : (locations.find((entry) => (entry.id as string) === state.locationId)?.name ??
        state.locationId);

  // ── What they hold as true, entering the scene ────────────────────────────
  const knowledge: Array<CharacterSnapshot["knowledge"][number]> = [];
  let notKnown = 0;
  const established = new Set(timeline.establishedFactsAt(boundary));
  const held = new Map(state.knowledge.map((record) => [record.factId, record]));
  for (const fact of facts) {
    const factId = fact.id as string;
    const record = held.get(factId);
    if (record !== undefined && holdsAsTrue(record.state)) {
      knowledge.push({
        factId,
        statement: fact.statement,
        state: record.state,
        sourceType: record.sourceType,
        ...(record.acquiredAtSceneId === undefined
          ? {}
          : { sinceSceneId: record.acquiredAtSceneId }),
      });
    } else if (established.has(factId)) {
      // Established in the story world, and she does not have it. The count is
      // reported; the statement is not, because she has not been told it.
      notKnown += 1;
    }
  }

  // ── Who the people in the room are to them ────────────────────────────────
  const relationshipStates = await repo.getRelationshipsForCharacter(characterId, boundary);
  const relationships = relationshipStates.map((entry) => {
    const other = entry.characterAId === characterId ? entry.characterBId : entry.characterAId;
    return {
      relationshipId: entry.relationshipId,
      withId: other,
      withName: name(other),
      type: entry.type,
      status: entry.status,
    };
  });

  // ── What they have been through ───────────────────────────────────────────
  const before = at < 0 ? [] : ordered.slice(0, at);
  const memories = before
    .map((entry, index) => ({ scene: entry, index }))
    .filter(({ scene: entry }) => entry.characterIds.map(String).includes(characterId))
    .reverse()
    .slice(0, MEMORY_LIMIT)
    .map(({ scene: entry, index }) => ({
      sceneId: entry.id as string,
      title: entry.title,
      position: index + 1,
      scenesAgo: at - index,
    }));

  // ── What is bearing on them now ───────────────────────────────────────────
  const pressures = derivePressures({
    characterId,
    timeline,
    ordered,
    at,
    facts,
    state,
    relationships,
  });

  const chapter = chapters.find((entry) => (entry.id as string) === scene.chapterId);
  const notRecorded: string[] = [];
  if (character.goals.length === 0) notRecorded.push("no goals are recorded for this character");
  if (personality.length === 0) {
    notRecorded.push("no confirmed personality traits — nothing to check behaviour against");
  }
  if (knowledge.length === 0 && facts.length > 0) {
    notRecorded.push("nothing is recorded about what this character knows at this point");
  }
  if (relationships.length === 0) notRecorded.push("no relationships are recorded");
  if (state.presence === "unknown") {
    notRecorded.push("the project does not record where this character is entering the scene");
  }

  return {
    characterId,
    name: character.name,
    sceneId,
    sceneTitle: scene.title,
    ...(chapter === undefined ? {} : { chapterTitle: chapter.title }),
    position: at + 1,
    profile: {
      description: character.description,
      role: character.role,
      goals: character.goals,
      notes: character.notes,
    },
    personality,
    physical: {
      status: state.status,
      presence: state.presence,
      ...(state.locationId === undefined ? {} : { locationId: state.locationId }),
      ...(locationName === undefined ? {} : { locationName }),
      ...(state.travellingTo === undefined ? {} : { travellingTo: state.travellingTo }),
      inventory: state.inventory,
    },
    knowledge,
    notKnownCount: notKnown,
    relationships,
    memories,
    pressures,
    circumstances: {
      sceneTitle: scene.title,
      purpose: scene.purpose,
      presentCharacterIds: scene.characterIds.map(String),
      presentCharacterNames: scene.characterIds.map((id) => name(id as string)),
      ...(scene.locationId === undefined ? {} : { locationId: scene.locationId as string }),
      objectIds: scene.objectIds.map(String),
    },
    notRecorded,
  };
}

/**
 * What the record says is pressing on this character right now.
 *
 * Deliberately narrow and deterministic: something they have just learned,
 * something that has just changed between them and someone else, and a
 * physical condition. A "pressure" inferred from prose would be a reading, and
 * the model can offer those separately.
 */
function derivePressures(input: {
  characterId: string;
  timeline: Awaited<ReturnType<StoryRepository["getStoryTimeline"]>>;
  ordered: readonly Scene[];
  at: number;
  facts: ReadonlyArray<{ id: unknown; statement: string }>;
  state: { status: string; presence: string };
  relationships: CharacterSnapshot["relationships"];
}): CharacterSnapshot["pressures"] {
  const out: Array<{ statement: string; basis: string }> = [];
  const recent =
    input.at < 0
      ? []
      : input.ordered.slice(Math.max(0, input.at - RECENT_PRESSURE_WINDOW), input.at);

  for (const scene of recent) {
    for (const transition of input.timeline.transitionsAtScene(scene.id as string)) {
      if (transition.kind === "knowledge_changed" && transition.subjectId === input.characterId) {
        const fact = input.facts.find((entry) => (entry.id as string) === transition.value);
        out.push({
          statement: `Has just learned: ${fact?.statement ?? transition.value}`,
          basis: `knowledge transition in ${scene.title}`,
        });
      }
      if (
        (transition.kind === "relationship_status" || transition.kind === "relationship_event") &&
        input.relationships.some((entry) => entry.relationshipId === transition.subjectId)
      ) {
        const other = input.relationships.find(
          (entry) => entry.relationshipId === transition.subjectId,
        );
        out.push({
          statement: `Something has just changed with ${other?.withName ?? "someone"}: ${transition.value}`,
          basis: `relationship transition in ${scene.title}`,
        });
      }
    }
  }

  // `active` is the default a character carries when nothing has changed, so
  // it is not a pressure. Anything else is.
  if (input.state.status !== "active") {
    out.push({
      statement: `Recorded as ${input.state.status} entering this scene`,
      basis: "character status",
    });
  }
  if (input.state.presence === "travelling") {
    out.push({ statement: "In transit entering this scene", basis: "character presence" });
  }
  return out;
}

/** The snapshot as a model reads it — a structured briefing, not a transcript. */
export function renderSnapshot(snapshot: CharacterSnapshot): string {
  const lines: string[] = [
    `${snapshot.name}, entering "${snapshot.sceneTitle}"${
      snapshot.chapterTitle === undefined ? "" : ` (${snapshot.chapterTitle})`
    } — scene ${String(snapshot.position)} of the book.`,
    "",
    "WHO THEY ARE",
    snapshot.profile.description === ""
      ? "(no description recorded)"
      : snapshot.profile.description,
    ...(snapshot.profile.role === "" ? [] : [`Role: ${snapshot.profile.role}`]),
  ];

  if (snapshot.personality.length > 0) {
    lines.push("", "CONFIRMED PERSONALITY — the author's own, not a reading");
    for (const trait of snapshot.personality) {
      lines.push(`- [${trait.dimension.replace(/_/g, " ")}] ${trait.statement}`);
    }
  }

  if (snapshot.profile.goals.length > 0) {
    lines.push("", "WHAT THEY WANT");
    for (const goal of snapshot.profile.goals) lines.push(`- ${goal}`);
  }

  lines.push(
    "",
    "WHERE AND WHAT THEY ARE, ENTERING THE SCENE",
    `Status: ${snapshot.physical.status}. Presence: ${snapshot.physical.presence}.`,
    ...(snapshot.physical.locationName === undefined
      ? []
      : [`At: ${snapshot.physical.locationName}`]),
    ...(snapshot.physical.inventory.length === 0
      ? []
      : [`Carrying: ${snapshot.physical.inventory.join(", ")}`]),
  );

  lines.push("", "WHAT THEY KNOW — and only what they know");
  if (snapshot.knowledge.length === 0) {
    lines.push("(nothing recorded)");
  } else {
    for (const item of snapshot.knowledge) {
      lines.push(
        `- ${item.statement} (${item.state}${item.sourceType === undefined ? "" : `, ${item.sourceType}`})`,
      );
    }
  }
  if (snapshot.notKnownCount > 0) {
    lines.push(
      `${String(snapshot.notKnownCount)} other proposition(s) are established in the story that this character does NOT hold. They are deliberately not shown to you: this character cannot act on them.`,
    );
  }

  if (snapshot.relationships.length > 0) {
    lines.push("", "WHO PEOPLE ARE TO THEM, AT THIS POINT");
    for (const entry of snapshot.relationships) {
      lines.push(
        `- ${entry.withName}: ${entry.type}${entry.status === "" ? "" : ` (${entry.status})`}`,
      );
    }
  }

  if (snapshot.memories.length > 0) {
    lines.push("", "WHAT THEY HAVE BEEN THROUGH, MOST RECENT FIRST");
    for (const memory of snapshot.memories) {
      lines.push(`- ${memory.title} (${String(memory.scenesAgo)} scene(s) ago)`);
    }
  }

  if (snapshot.pressures.length > 0) {
    lines.push("", "WHAT IS PRESSING ON THEM NOW");
    for (const pressure of snapshot.pressures) lines.push(`- ${pressure.statement}`);
  }

  lines.push(
    "",
    "THE SCENE",
    `"${snapshot.circumstances.sceneTitle}"`,
    ...(snapshot.circumstances.purpose.length === 0
      ? []
      : [`What it is for: ${snapshot.circumstances.purpose.join("; ")}`]),
    `Present: ${snapshot.circumstances.presentCharacterNames.join(", ")}`,
  );

  if (snapshot.notRecorded.length > 0) {
    lines.push(
      "",
      "WHAT THE PROJECT DOES NOT RECORD — do not fill these in",
      ...snapshot.notRecorded.map((gap) => `- ${gap}`),
    );
  }

  return lines.join("\n");
}

export type { Character };
