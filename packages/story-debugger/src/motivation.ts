import { holdsAsTrue } from "@jellytind/story-state";
import { EvidenceCollector } from "./evidence";
import { precedingScenes, type ProjectSnapshot } from "./project";
import { addExcerpt } from "./reveal";
import { DebugError, type DebugTrace, type MotivationDebugRequest } from "./types";

const DEFAULT_LOOK_BACK = 5;

/**
 * Motivation debugging: _Mara's decision to enter the house feels forced._
 *
 * A decision reads as earned when it follows from what the character wants,
 * what they know and who they are to the people involved. Three of those four
 * are recorded — goals, knowledge, relationships, prior behaviour — so the
 * trace reconstructs the character as they stand *entering* the scene, which is
 * the only state that can explain a choice made inside it.
 *
 * The sharpest deterministic signal lives here: a scene whose purpose turns on
 * a proposition the character does not hold at that point. That is not a
 * matter of taste — the manuscript is asking someone to act on information they
 * have not been given.
 */
export async function traceMotivation(
  request: MotivationDebugRequest,
  project: ProjectSnapshot,
): Promise<DebugTrace> {
  const found = new EvidenceCollector();

  const scene = project.sceneById(request.sceneId);
  if (scene === undefined) {
    throw new DebugError("target_not_found", `${request.sceneId} is not a scene in this project.`);
  }
  const characters = await project.reader.listCharacters();
  const character = characters.find((c) => (c.id as string) === request.characterId);
  if (character === undefined) {
    throw new DebugError(
      "target_not_found",
      `${request.characterId} is not a character in this project.`,
    );
  }

  const chapter = project.chapterOf(request.sceneId);
  const before = { sceneId: request.sceneId, position: "before" } as const;

  // ── What they want ────────────────────────────────────────────────────────

  if (character.goals.length > 0) {
    found.add({
      system: "structure",
      statement: `${character.name} wants: ${character.goals.join("; ")}`,
      detail: `role: ${character.role === "" ? "unrecorded" : character.role}`,
      entities: [character.id as string],
    });
  } else {
    found.add({
      system: "structure",
      statement: `No goals are recorded for ${character.name}.`,
      detail:
        "Nothing states what they are trying to do, so nothing here can say whether this choice serves it.",
      entities: [character.id as string],
    });
  }

  // ── What the scene asks of them ───────────────────────────────────────────

  found.add({
    system: "structure",
    statement: `${request.sceneId} — "${scene.title}": ${scene.purpose.length > 0 ? scene.purpose.join("; ") : "no purpose recorded"}`,
    detail: [
      `status ${scene.status}`,
      scene.pov === undefined ? "no POV recorded" : `POV ${project.label(scene.pov as string)}`,
      scene.locationId === undefined
        ? "no location recorded"
        : `at ${project.label(scene.locationId as string)}`,
    ].join(" · "),
    sceneId: request.sceneId,
    ...(chapter !== undefined ? { chapterId: chapter.id as string } : {}),
    entities: [request.sceneId, character.id as string],
  });

  // ── Where they are and how they are ───────────────────────────────────────

  const state = project.timeline.characterStateAt(character.id as string, before);
  found.add({
    system: "story_state",
    statement: `Entering the scene, ${character.name} is ${state.status}, ${state.locationId === undefined ? "nowhere recorded" : `at ${project.label(state.locationId)}`}.`,
    detail: `presence ${state.presence}; last recorded location ${state.lastKnownLocationId === undefined ? "none" : project.label(state.lastKnownLocationId)}`,
    sceneId: request.sceneId,
    entities: [character.id as string],
  });

  // ── What they know ────────────────────────────────────────────────────────

  const knowledge = project.timeline.characterKnowledgeBeforeScene(
    character.id as string,
    request.sceneId,
  );
  if (knowledge.length > 0) {
    for (const record of knowledge) {
      found.add({
        system: "knowledge",
        statement: `${character.name} ${record.state} "${project.label(record.factId)}" entering the scene.`,
        detail: `acquired in ${record.acquiredAtSceneId ?? "an unrecorded scene"} (${record.sourceType})`,
        sceneId: request.sceneId,
        entities: [character.id as string, record.factId],
      });
    }
  } else {
    found.add({
      system: "knowledge",
      statement: `${character.name} holds no recorded position on anything entering the scene.`,
      detail: "No knowledge transition reaches this point for them.",
      sceneId: request.sceneId,
      entities: [character.id as string],
    });
  }

  // ── Does the scene rest on something they do not know? ────────────────────

  const held = new Set(knowledge.filter((k) => holdsAsTrue(k.state)).map((k) => k.factId));
  const unheld = scene.factIds.map(String).filter((factId) => !held.has(factId));
  for (const factId of unheld) {
    const record = knowledge.find((k) => k.factId === factId);
    found.add({
      system: "knowledge",
      statement: `The scene puts "${project.label(factId)}" on the page, and ${character.name} does not hold it entering the scene.`,
      detail:
        record === undefined
          ? "They have no recorded position on it at all."
          : `They ${record.state} it.`,
      sceneId: request.sceneId,
      entities: [character.id as string, factId],
    });
  }
  if (scene.factIds.length > 0 && unheld.length === 0) {
    found.add({
      system: "knowledge",
      statement: `${character.name} holds every proposition the scene puts on the page.`,
      detail: scene.factIds.map((id) => project.label(id as string)).join("; "),
      sceneId: request.sceneId,
      entities: [character.id as string, ...scene.factIds.map(String)],
    });
  }
  found.measure({
    label: "Propositions the scene uses that the character does not hold",
    value: unheld.length,
    unit: "facts",
    basis: `Scene.factIds minus what ${character.name} holds as true entering ${request.sceneId}.`,
    entities: [character.id as string, request.sceneId],
  });

  // ── Who the other people in the scene are to them ─────────────────────────

  const relationships = await project.reader.listRelationships();
  const others = scene.characterIds.map(String).filter((id) => id !== (character.id as string));
  for (const otherId of others) {
    const rel = relationships.find(
      (r) =>
        ((r.characterAId as string) === (character.id as string) &&
          (r.characterBId as string) === otherId) ||
        ((r.characterBId as string) === (character.id as string) &&
          (r.characterAId as string) === otherId),
    );
    if (rel === undefined) {
      found.add({
        system: "relationships",
        statement: `No relationship is recorded between ${character.name} and ${project.label(otherId)}, who are both in the scene.`,
        sceneId: request.sceneId,
        entities: [character.id as string, otherId],
      });
      continue;
    }
    const at = project.timeline.relationshipStateAt(
      {
        id: rel.id as string,
        characterAId: rel.characterAId as string,
        characterBId: rel.characterBId as string,
        type: rel.type,
        ...(rel.status !== undefined ? { status: rel.status } : {}),
      },
      before,
    );
    found.add({
      system: "relationships",
      statement: `Entering the scene, ${character.name} and ${project.label(otherId)} are "${at.type}"${at.status === "" ? "" : ` (${at.status})`}.`,
      detail:
        at.events.length === 0
          ? "No milestone recorded before this scene."
          : at.events.map((e) => `${e.sceneId}: ${e.kind}`).join(" | "),
      sceneId: request.sceneId,
      entities: [rel.id as string, character.id as string, otherId],
    });
  }

  // ── What they have been doing ─────────────────────────────────────────────

  const lookBack = request.lookBack ?? DEFAULT_LOOK_BACK;
  const priors = project.ordered
    .slice(0, project.positionOf(request.sceneId))
    .filter(
      (s) =>
        s.characterIds.map(String).includes(character.id as string) ||
        (s.pov as string | undefined) === (character.id as string),
    )
    .slice(-lookBack);

  for (const prior of priors) {
    found.add({
      system: "structure",
      statement: `${prior.id as string} — "${prior.title}": ${prior.purpose.length > 0 ? prior.purpose.join("; ") : "no purpose recorded"}`,
      detail: `${String(project.positionOf(request.sceneId) - project.positionOf(prior.id as string))} scene(s) earlier`,
      sceneId: prior.id as string,
      entities: [prior.id as string, character.id as string],
    });
  }
  if (priors.length === 0) {
    found.add({
      system: "structure",
      statement: `No earlier scene records ${character.name} on the page.`,
      detail: "There is no prior behaviour to compare this decision against.",
      entities: [character.id as string],
    });
  }
  found.note(precedingScenes(project, request.sceneId, lookBack).map((s) => s.id as string));

  await addExcerpt(project, found, scene, "The scene in question");

  found.didNotInspect(
    "Whether the prose dramatises the decision convincingly — that is a reading, not a record.",
  );
  if (character.goals.length === 0) {
    found.didNotInspect(
      `Whether the choice serves ${character.name}'s goals — none are recorded to compare against.`,
    );
  }

  return {
    mode: "character_motivation",
    problem: request.problem,
    scope: found.scope(
      `${character.name} entering ${request.sceneId}, and their ${String(priors.length)} preceding scene(s).`,
    ),
    evidence: found.evidence,
    measurements: found.measurements,
    excerpts: found.excerpts,
  };
}
