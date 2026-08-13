import { ALIVE_STATUSES, SIMULATION_ADVISORY, heuristicBand } from "@jellytind/domain";
import type {
  BehaviourFactor,
  BehaviourTest,
  Contradiction,
  Counterfactual,
} from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import { renderSnapshot, snapshotAt, type CharacterSnapshot } from "./snapshot";
import { CharacterSimError, type CharacterAnalyst } from "./types";

/**
 * _Would Mara realistically enter the house alone here?_
 *
 * The test has two halves and keeps them apart on the page.
 *
 * The **deterministic half** finds what the project can settle: she is not in
 * this location, she is recorded deceased, she does not hold the fact the
 * action turns on, nobody recorded a goal she could be serving. Those are hard
 * contradictions — not opinions about characterisation, but the manuscript
 * asking someone to act on something they have not been given.
 *
 * The **model half** reads the action against who she is, and returns a band
 * with its reasoning and what would change it. It is a judgement and is
 * labelled one; there is no percentage, because a number with no instrument
 * behind it would be the most misleading thing on the screen.
 */

export interface BehaviourTestOptions {
  readonly analyst?: CharacterAnalyst | null;
  readonly now?: () => string;
}

export async function testBehaviour(
  repo: StoryRepository,
  input: { characterId: string; sceneId: string; proposedAction: string },
  options: BehaviourTestOptions = {},
): Promise<BehaviourTest> {
  const action = input.proposedAction.trim();
  if (action === "") {
    throw new CharacterSimError("no_action", "Say what the character is proposed to do.");
  }

  const snapshot = await snapshotAt(repo, input.characterId, input.sceneId);
  const established = establishedFactors(snapshot);
  const hard = await hardContradictions(repo, snapshot, action);
  const notChecked = [...snapshot.notRecorded];

  let supporting: readonly BehaviourFactor[] = [];
  let opposing: readonly BehaviourFactor[] = [];
  let soft: readonly Contradiction[] = [];
  let judgement: BehaviourTest["judgement"];
  let conditions: BehaviourTest["conditions"] = [];

  const analyst = options.analyst ?? null;
  if (analyst === null) {
    notChecked.push(
      "no model is configured, so nothing weighed the action against who this character is",
    );
  } else {
    const read = await analyst.weigh({
      snapshot,
      briefing: renderSnapshot(snapshot),
      proposedAction: action,
      established,
      hardContradictions: hard,
    });
    supporting = read.supporting;
    opposing = read.opposing;
    soft = read.contradictions;
    conditions = read.conditions;
    if (read.judgement !== null) {
      judgement = { ...read.judgement, modelId: analyst.modelId };
    }
  }

  const counts = {
    supporting: supporting.length,
    opposing: opposing.length,
    hardContradictions: hard.length,
  };

  return {
    characterId: snapshot.characterId,
    characterName: snapshot.name,
    sceneId: snapshot.sceneId,
    proposedAction: action,
    established,
    supporting,
    opposing,
    contradictions: [...hard, ...soft],
    ...(judgement === undefined ? {} : { judgement }),
    conditions,
    counts,
    basis: `${snapshot.name} as recorded entering "${snapshot.sceneTitle}" — ${String(snapshot.knowledge.length)} thing(s) known, ${String(snapshot.personality.length)} confirmed trait(s), ${String(snapshot.relationships.length)} relationship(s).`,
    notChecked,
    createdAt: (options.now ?? (() => new Date().toISOString()))(),
  };
}

/**
 * What the project records that bears on this, whatever the action is.
 *
 * The "relevant established factors" section: no judgement, no weighting —
 * these are simply the things a writer should have in front of them before
 * deciding whether the action is earned.
 */
export function establishedFactors(snapshot: CharacterSnapshot): BehaviourFactor[] {
  const out: BehaviourFactor[] = [];

  for (const trait of snapshot.personality) {
    out.push({
      statement: trait.statement,
      detail: `Confirmed ${trait.dimension.replace(/_/g, " ")}`,
      source: "author-confirmed personality",
      entities: [snapshot.characterId],
      derivation: "deterministic",
    });
  }
  for (const goal of snapshot.profile.goals) {
    out.push({
      statement: `Wants: ${goal}`,
      source: "character record",
      entities: [snapshot.characterId],
      derivation: "deterministic",
    });
  }
  for (const item of snapshot.knowledge) {
    out.push({
      statement: `Knows: ${item.statement}`,
      ...(item.sinceSceneId === undefined ? {} : { detail: `since ${item.sinceSceneId}` }),
      source: "knowledge at this scene",
      ...(item.sinceSceneId === undefined ? {} : { sceneIds: [item.sinceSceneId] }),
      derivation: "deterministic",
    });
  }
  for (const entry of snapshot.relationships) {
    out.push({
      statement: `${entry.withName}: ${entry.type}${entry.status === "" ? "" : ` — ${entry.status}`}`,
      source: "relationship at this scene",
      entities: [snapshot.characterId, entry.withId],
      derivation: "deterministic",
    });
  }
  for (const pressure of snapshot.pressures) {
    out.push({
      statement: pressure.statement,
      source: pressure.basis,
      derivation: "deterministic",
    });
  }
  if (snapshot.physical.status !== "active" || snapshot.physical.presence !== "unknown") {
    out.push({
      statement: `${snapshot.physical.status}, ${snapshot.physical.presence}${
        snapshot.physical.locationName === undefined ? "" : ` at ${snapshot.physical.locationName}`
      }`,
      source: "physical state at this scene",
      derivation: "deterministic",
    });
  }
  return out;
}

/**
 * Contradictions a program can settle.
 *
 * The sharpest is the knowledge one, borrowed from the Story Debugger: an
 * action whose premise names a proposition the character does not hold at this
 * point is the manuscript asking someone to act on information they have not
 * been given. That is not a matter of taste (docs/STORY_DEBUGGER.md).
 */
export async function hardContradictions(
  repo: StoryRepository,
  snapshot: CharacterSnapshot,
  action: string,
): Promise<Contradiction[]> {
  const out: Contradiction[] = [];
  const lower = action.toLowerCase();

  // ALIVE_STATUSES from the story-test vocabulary: active or inactive. Anything
  // else means the project says they cannot act here.
  if (!ALIVE_STATUSES.includes(snapshot.physical.status as (typeof ALIVE_STATUSES)[number])) {
    out.push({
      kind: "hard",
      statement: `${snapshot.name} is recorded ${snapshot.physical.status} entering this scene.`,
      derivation: "deterministic",
      entities: [snapshot.characterId],
    });
  }
  if (snapshot.physical.presence === "departed") {
    out.push({
      kind: "hard",
      statement: `${snapshot.name} is recorded as having left, and is not placed in this scene.`,
      detail: "A character who has departed is not at their last location any more.",
      derivation: "deterministic",
      entities: [snapshot.characterId],
    });
  }
  if (
    snapshot.circumstances.locationId !== undefined &&
    snapshot.physical.locationId !== undefined &&
    snapshot.physical.locationId !== snapshot.circumstances.locationId
  ) {
    out.push({
      kind: "hard",
      statement: `${snapshot.name} is recorded at ${snapshot.physical.locationName ?? snapshot.physical.locationId} entering a scene set somewhere else.`,
      derivation: "deterministic",
      entities: [snapshot.characterId, snapshot.circumstances.locationId],
    });
  }
  if (!snapshot.circumstances.presentCharacterIds.includes(snapshot.characterId)) {
    out.push({
      kind: "hard",
      statement: `${snapshot.name} is not recorded as being in this scene at all.`,
      derivation: "deterministic",
      entities: [snapshot.characterId, snapshot.sceneId],
    });
  }

  // An action that turns on something she has not been told.
  const facts = await repo.listFacts();
  const held = new Set(snapshot.knowledge.map((item) => item.factId));
  for (const fact of facts) {
    const factId = fact.id as string;
    if (held.has(factId)) continue;
    // Only where the action names the proposition — either by ID, or by
    // carrying enough of its distinctive words to be unmistakable.
    if (lower.includes(factId.toLowerCase()) || mentions(lower, fact.statement)) {
      out.push({
        kind: "hard",
        statement: `The action turns on something ${snapshot.name} does not know at this point: "${fact.statement}"`,
        detail: "Nothing recorded gives this character that information before this scene.",
        derivation: "deterministic",
        entities: [snapshot.characterId, factId],
      });
    }
  }
  return out;
}

/** Distinctive words shared between an action and a proposition. */
function mentions(action: string, statement: string): boolean {
  const words = statement
    .toLowerCase()
    .match(/[\p{L}\p{N}']{5,}/gu)
    ?.filter((word) => !COMMON.has(word));
  if (words === undefined || words.length === 0) return false;
  const hits = words.filter((word) => action.includes(word)).length;
  // Two distinctive words, or one where the proposition only has one.
  return hits >= Math.min(2, words.length);
}

const COMMON = new Set([
  "about",
  "after",
  "again",
  "because",
  "before",
  "between",
  "could",
  "every",
  "never",
  "other",
  "should",
  "still",
  "their",
  "there",
  "these",
  "thing",
  "those",
  "through",
  "where",
  "which",
  "while",
  "would",
]);

/**
 * _What would she most plausibly do instead?_
 *
 * Advisory, and nothing here touches the project. The alternatives are options
 * for the writer, and the caveat travels with them — a simulator that quietly
 * rewrote a scene to what a model found more plausible would be replacing the
 * author's judgement with its own.
 */
export async function whatWouldTheyDo(
  repo: StoryRepository,
  input: { characterId: string; sceneId: string; proposedAction: string; limit?: number },
  options: BehaviourTestOptions = {},
): Promise<Counterfactual> {
  const analyst = options.analyst ?? null;
  const snapshot = await snapshotAt(repo, input.characterId, input.sceneId);
  if (analyst === null) {
    return {
      characterId: snapshot.characterId,
      sceneId: snapshot.sceneId,
      alternatives: [],
      caveat: `No model is configured, so no alternative was proposed. ${SIMULATION_ADVISORY}`,
    };
  }

  const alternatives = await analyst.alternatives({
    snapshot,
    briefing: renderSnapshot(snapshot),
    proposedAction: input.proposedAction.trim(),
    limit: input.limit ?? 4,
  });

  return {
    characterId: snapshot.characterId,
    sceneId: snapshot.sceneId,
    alternatives,
    caveat: `A model's reading of what this character would do, from what the project records about them at this point. ${SIMULATION_ADVISORY}`,
    modelId: analyst.modelId,
  };
}

export { heuristicBand };
