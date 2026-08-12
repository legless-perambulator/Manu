import { orderScenes } from "@jellytind/domain";
import type { Chapter, Fact, Relationship, Scene } from "@jellytind/domain";
import {
  describeRelationship,
  falseBeliefsAt,
  holdsAsTrue,
  informationAsymmetriesAt,
  StoryTimeline,
  type CharacterState,
  type ObjectState,
  type RelationshipState,
} from "@jellytind/story-state";
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
    lines.push("holds: nothing recorded");
  } else {
    lines.push("holds:");
    for (const entry of state.knowledge) {
      const fact = facts.get(entry.factId);
      const statement = fact?.statement ?? "(fact not found)";
      const via =
        entry.sourceEntityId === undefined
          ? entry.sourceType
          : `${entry.sourceType} by ${entry.sourceEntityId}`;
      const where =
        entry.acquiredAtSceneId === undefined ? "" : `, since ${entry.acquiredAtSceneId}`;
      // Say plainly when a character holds something the world contradicts.
      const truth =
        fact !== undefined && !fact.objectiveTruth && holdsAsTrue(entry.state)
          ? " — FALSE BELIEF: this is not true in the story world"
          : "";
      lines.push(`  - ${entry.state} ${entry.factId}: ${statement} [${via}${where}]${truth}`);
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

/**
 * Knowledge candidates for a scene: the information picture the writer actually
 * needs, not a dump of everything everyone knows.
 *
 * Three things are selected, each because a drafting or inspecting operation
 * would be wrong without it:
 *
 * - **false beliefs** held by anyone in the scene — a character acting on
 *   something untrue is a plot mechanism, and a model that does not know will
 *   quietly correct it;
 * - **information asymmetries** among the people present — who is holding
 *   something the others are not is where the tension lives;
 * - **the facts the scene itself references**, with everyone's position on them.
 *
 * Everything else is left out on purpose. Selecting the relevant subset is the
 * whole job (docs/CONTEXT_COMPILER.md).
 */
export function knowledgeCandidates(input: {
  readonly timeline: StoryTimeline;
  readonly facts: ReadonlyMap<string, Fact>;
  readonly scene: Scene;
  readonly maxAsymmetries?: number;
}): Candidate[] {
  const { timeline, facts, scene } = input;
  try {
    timeline.positionOf(scene.id);
  } catch {
    return [];
  }

  const asOf = { sceneId: scene.id as string, position: "before" } as const;
  const present = involvedCharacters(scene);
  const out: Candidate[] = [];

  const statement = (id: string): string => facts.get(id)?.statement ?? "(fact not found)";

  const beliefs = falseBeliefsAt(timeline, facts, asOf, { characterIds: present });
  if (beliefs.length > 0) {
    out.push({
      id: `false-beliefs@${scene.id}`,
      kind: "knowledge",
      label: "False beliefs in play",
      section: "storyState",
      priority: PRIORITY.state + 3,
      provenance: provenance(
        "false_belief",
        `beliefs held entering ${scene.id} that the story world contradicts`,
        [scene.id as string],
      ),
      full: [
        `FALSE BELIEFS ENTERING ${scene.id}`,
        ...beliefs.map((b) =>
          b.kind === "believes_false"
            ? `- ${b.characterId} believes ${b.factId} ("${statement(b.factId)}"), which is NOT true in the story world.`
            : `- ${b.characterId} rejects ${b.factId} ("${statement(b.factId)}"), which IS true in the story world.`,
        ),
      ].join("\n"),
    });
  }

  const asymmetries = informationAsymmetriesAt(timeline, scene, asOf).slice(
    0,
    input.maxAsymmetries ?? 8,
  );
  if (asymmetries.length > 0) {
    out.push({
      id: `asymmetry@${scene.id}`,
      kind: "knowledge",
      label: "Information asymmetries",
      section: "storyState",
      priority: PRIORITY.state + 4,
      provenance: provenance(
        "information_asymmetry",
        `what the characters in ${scene.id} do not share entering it`,
        [scene.id as string],
      ),
      full: [
        `INFORMATION ASYMMETRIES ENTERING ${scene.id}`,
        ...asymmetries.map(
          (a) =>
            `- ${a.factId} ("${statement(a.factId)}"): held by ${a.holders.join(", ")}; not held by ${a.outsiders.join(", ")}`,
        ),
      ].join("\n"),
    });
  }

  for (const factId of scene.factIds as readonly string[]) {
    const positions = present.map((characterId) => {
      const record = timeline.knows(characterId, factId, asOf);
      return record === null
        ? `${characterId}: no position`
        : `${characterId}: ${record.state} (${record.sourceType}${
            record.sourceEntityId === undefined ? "" : ` by ${record.sourceEntityId}`
          })`;
    });
    const fact = facts.get(factId);
    out.push({
      id: `knowledge:${factId}@${scene.id}`,
      kind: "knowledge",
      label: `Who holds ${factId}`,
      section: "storyState",
      priority: PRIORITY.state + 5,
      provenance: provenance(
        "fact_knowledge",
        `${scene.id} references ${factId}, so who holds it entering the scene matters`,
        [scene.id as string, factId],
      ),
      full: [
        `POSITIONS ON ${factId} ENTERING ${scene.id}`,
        `statement: ${statement(factId)}`,
        `objectively true in the story world: ${fact === undefined ? "unknown" : String(fact.objectiveTruth)}`,
        ...positions.map((line) => `- ${line}`),
      ].join("\n"),
    });
  }

  return out;
}

function renderRelationship(state: RelationshipState): string {
  const lines = [
    `RELATIONSHIP ${state.relationshipId} — ${state.characterAId} ↔ ${state.characterBId} ${boundaryWords(state.asOf)}`,
    `type: ${state.type}`,
  ];
  if (state.status !== "") lines.push(`status: ${state.status}`);
  if (state.description !== "") lines.push(`description: ${state.description}`);

  const dimensions = Object.values(state.dimensions).filter((d) => d !== undefined);
  for (const d of dimensions) {
    const value =
      d.level !== undefined && d.magnitude !== undefined
        ? `${d.level} (${String(d.magnitude)})`
        : (d.level ?? String(d.magnitude ?? ""));
    lines.push(
      `${d.dimension}: ${value} — since ${d.changedAtSceneId}${d.reason === undefined ? "" : `; ${d.reason}`}`,
    );
  }
  if (state.events.length > 0) {
    lines.push(
      `history: ${state.events.map((e) => `${e.kind.replace(/_/g, " ")} (${e.sceneId})`).join(", ")}`,
    );
  }
  return lines.join("\n");
}

/**
 * Relationship state between the characters in a scene, **as it stood entering
 * it**.
 *
 * The boundary is the whole point. Drafting Chapter 3 must never be handed
 * Chapter 20's fractured version of a friendship that is currently warm — that
 * would quietly write the ending into the beginning. Every relationship here is
 * reconstructed at the scene's entry boundary and says so in its provenance.
 *
 * Only pairs where *both* characters are in the scene are included: a
 * relationship neither participant is present for is not context, it is noise.
 */
export function relationshipCandidates(input: {
  readonly timeline: StoryTimeline;
  readonly relationships: readonly Relationship[];
  readonly scene: Scene;
  readonly becauseOf?: string;
}): Candidate[] {
  const { timeline, relationships, scene } = input;
  try {
    timeline.positionOf(scene.id);
  } catch {
    return [];
  }

  const becauseOf = input.becauseOf ?? (scene.id as string);
  const present = new Set(involvedCharacters(scene));
  const asOf = { sceneId: scene.id as string, position: "before" } as const;

  return relationships
    .filter((r) => present.has(r.characterAId) && present.has(r.characterBId))
    .map((r, index) => {
      const state = timeline.relationshipStateAt(r, asOf);
      return {
        id: `${r.id}@before:${scene.id}`,
        kind: "relationship_state",
        label: `${r.characterAId} ↔ ${r.characterBId}`,
        section: "storyState" as const,
        priority: PRIORITY.state + 6 + index,
        provenance: provenance(
          "relationship_state",
          `relationship between ${r.characterAId} and ${r.characterBId} ${boundaryWords(asOf)}, both of whom are in ${becauseOf}`,
          [becauseOf, r.id as string],
        ),
        full: renderRelationship(state),
        summary: describeRelationship(state),
      };
    });
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
