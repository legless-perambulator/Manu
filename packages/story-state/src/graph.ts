import type { Fact, Scene } from "@jellytind/domain";
import { holdsAsTrue, type FactKnowledgeGraph, type InformationAsymmetry } from "./knowledge";
import type { StoryTimeline } from "./timeline";
import type { StateBoundary, TimelineView } from "./types";

/**
 * The knowledge graph: everyone's position on a proposition at one moment.
 *
 * Built on top of the timeline rather than stored, so it is always consistent
 * with the transitions and always answerable at any boundary.
 */
export function factKnowledgeGraph(
  timeline: StoryTimeline,
  fact: Pick<Fact, "id" | "objectiveTruth">,
  asOf: StateBoundary,
  options: { characterIds?: readonly string[]; view?: TimelineView } = {},
): FactKnowledgeGraph {
  const view = options.view ?? {};
  const characterIds = options.characterIds ?? timeline.knownCharacterIds(view);

  return {
    factId: fact.id,
    objectiveTruth: fact.objectiveTruth,
    holders: characterIds.map((characterId) => {
      const record = timeline.knows(characterId, fact.id, asOf, view);
      if (record === null) {
        return {
          characterId,
          state: "unknown" as const,
          sourceType: "unknown" as const,
          isFalseBelief: false,
        };
      }
      return {
        characterId,
        state: record.state,
        sourceType: record.sourceType,
        ...(record.sourceEntityId !== undefined ? { sourceEntityId: record.sourceEntityId } : {}),
        ...(record.acquiredAtSceneId !== undefined
          ? { acquiredAtSceneId: record.acquiredAtSceneId }
          : {}),
        ...(record.certainty !== undefined ? { certainty: record.certainty } : {}),
        // A false belief is holding as true something the world says is false.
        isFalseBelief: holdsAsTrue(record.state) && !fact.objectiveTruth,
      };
    }),
  };
}

/**
 * Every position a character holds that the world contradicts — believing a
 * false proposition, or rejecting a true one.
 */
export function falseBeliefsAt(
  timeline: StoryTimeline,
  facts: ReadonlyMap<string, Fact>,
  asOf: StateBoundary,
  options: { characterIds?: readonly string[]; view?: TimelineView } = {},
): Array<{ characterId: string; factId: string; kind: "believes_false" | "rejects_true" }> {
  const view = options.view ?? {};
  const characterIds = options.characterIds ?? timeline.knownCharacterIds(view);
  const out: Array<{
    characterId: string;
    factId: string;
    kind: "believes_false" | "rejects_true";
  }> = [];

  for (const characterId of characterIds) {
    for (const record of timeline.characterStateAt(characterId, asOf, view).knowledge) {
      const fact = facts.get(record.factId);
      if (fact === undefined) continue;
      if (holdsAsTrue(record.state) && !fact.objectiveTruth) {
        out.push({ characterId, factId: record.factId, kind: "believes_false" });
      } else if (record.state === "disbelieved" && fact.objectiveTruth) {
        out.push({ characterId, factId: record.factId, kind: "rejects_true" });
      }
    }
  }
  return out;
}

/**
 * Where the characters in a scene do not share what they hold.
 *
 * This is the dramatic-irony signal: who is in the room holding something the
 * others are not. Restricted to the scene's own cast, because asymmetry between
 * people who are not present is not tension, it is bookkeeping.
 */
export function informationAsymmetriesAt(
  timeline: StoryTimeline,
  scene: Scene,
  asOf: StateBoundary,
  view: TimelineView = {},
): InformationAsymmetry[] {
  const present = [
    ...new Set([
      ...(scene.pov === undefined ? [] : [scene.pov as string]),
      ...(scene.characterIds as readonly string[]),
    ]),
  ];
  if (present.length < 2) return [];

  const out: InformationAsymmetry[] = [];
  for (const factId of timeline.knownFactIds(view)) {
    const holders: string[] = [];
    const outsiders: string[] = [];
    for (const characterId of present) {
      const record = timeline.knows(characterId, factId, asOf, view);
      if (record !== null && holdsAsTrue(record.state)) holders.push(characterId);
      else outsiders.push(characterId);
    }
    if (holders.length > 0 && outsiders.length > 0) out.push({ factId, holders, outsiders });
  }
  return out;
}
