import type { Scene } from "@jellytind/domain";
import { PRIORITY, type Candidate } from "../candidate";
import type { ProjectReader } from "../reader";
import { adjacentScenes } from "../sequence";
import { CompileError } from "../errors";
import {
  buildTimeline,
  involvedCharacters,
  knowledgeCandidates,
  relationshipCandidates,
  stateCandidates,
} from "./state";
import { buildChronology, temporalCandidates } from "./temporal";
import {
  byId,
  characterCandidate,
  locationCandidate,
  plotThreadCandidate,
  proseCandidate,
  provenance,
  readSnapshot,
  sceneCandidate,
  worldRuleCandidates,
  type ProjectSnapshot,
} from "./shared";

/**
 * **Scene Inspection** — understand one scene as it currently stands.
 *
 * Retrieves: the target scene, the previous and next scenes, the POV character,
 * the participating characters, the location, and the linked plot threads —
 * plus the prose of the chapter the scene sits in, since a scene's text lives
 * in its chapter's file.
 *
 * Everything here is reached by following the scene's own references, so
 * selection is deterministic and each element's provenance names the link that
 * pulled it in.
 */
export async function gatherSceneInspection(
  reader: ProjectReader,
  sceneId: string,
  snapshot?: ProjectSnapshot,
): Promise<{ candidates: Candidate[]; snapshot: ProjectSnapshot; scene: Scene }> {
  const snap = snapshot ?? (await readSnapshot(reader));
  const scene = byId(snap.scenes, sceneId);
  if (scene === undefined) {
    throw new CompileError("unknown_target", `No scene exists with ID "${sceneId}".`, {
      details: { targetId: sceneId },
    });
  }

  const candidates: Candidate[] = [
    sceneCandidate(
      scene,
      "target",
      PRIORITY.essential,
      provenance("target_entity", `the scene under inspection`),
    ),
  ];

  // Prose of the containing chapter.
  const chapter = scene.chapterId === undefined ? undefined : byId(snap.chapters, scene.chapterId);
  if (chapter !== undefined) {
    const prose = await proseCandidate(
      reader,
      chapter,
      provenance("target_prose", `prose of ${chapter.id}, the chapter containing ${scene.id}`, [
        scene.id,
        chapter.id,
      ]),
    );
    if (prose !== null) candidates.push(prose);
  }

  // Immediate narrative neighbours.
  const { previous, next } = adjacentScenes(snap.scenes, snap.chapters, scene.id);
  if (previous !== undefined) {
    candidates.push(
      sceneCandidate(
        previous,
        "adjacentScenes",
        PRIORITY.adjacent,
        provenance("previous_scene", `the scene immediately before ${scene.id}`, [scene.id]),
      ),
    );
  }
  if (next !== undefined) {
    candidates.push(
      sceneCandidate(
        next,
        "adjacentScenes",
        PRIORITY.adjacent,
        provenance("next_scene", `the scene immediately after ${scene.id}`, [scene.id]),
      ),
    );
  }

  // POV first, then the remaining participants.
  if (scene.pov !== undefined) {
    const pov = byId(snap.characters, scene.pov);
    if (pov !== undefined) {
      candidates.push(
        characterCandidate(
          pov,
          snap.relationships,
          PRIORITY.involved,
          provenance("pov_character", `POV character of ${scene.id}`, [scene.id]),
        ),
      );
    }
  }
  for (const id of scene.characterIds) {
    if (id === scene.pov) continue;
    const character = byId(snap.characters, id);
    if (character === undefined) continue;
    candidates.push(
      characterCandidate(
        character,
        snap.relationships,
        PRIORITY.involved + 1,
        provenance("participant_character", `participant in ${scene.id}`, [scene.id]),
      ),
    );
  }

  if (scene.locationId !== undefined) {
    const location = byId(snap.locations, scene.locationId);
    if (location !== undefined) {
      candidates.push(
        locationCandidate(
          location,
          PRIORITY.involved + 2,
          provenance("scene_location", `setting of ${scene.id}`, [scene.id]),
        ),
      );
    }
  }

  for (const id of scene.plotThreadIds) {
    const thread = byId(snap.plotThreads, id);
    if (thread === undefined) continue;
    candidates.push(
      plotThreadCandidate(
        thread,
        PRIORITY.threads,
        provenance("linked_plot_thread", `plot thread carried by ${scene.id}`, [scene.id]),
      ),
    );
  }

  // Story state as it stands entering the scene — the answer to "who is where
  // and who knows what" without re-reading the manuscript.
  const timeline = await buildTimeline(reader);
  const facts = new Map((await reader.listFacts()).map((f) => [f.id as string, f]));
  candidates.push(
    ...stateCandidates({
      timeline,
      facts,
      characterIds: involvedCharacters(scene),
      objectIds: [...scene.objectIds] as string[],
      sceneId: scene.id,
      position: "before",
      becauseOf: scene.id,
    }),
  );
  candidates.push(...knowledgeCandidates({ timeline, facts, scene }));
  candidates.push(
    ...relationshipCandidates({ timeline, relationships: snap.relationships, scene }),
  );

  // Where the scene sits in story-world time, and what the world had reached by
  // then. Manuscript adjacency above answers a different question, and in a
  // nonlinear story the two disagree (docs/TIMELINE.md).
  candidates.push(...temporalCandidates({ chronology: await buildChronology(reader), scene }));

  candidates.push(...worldRuleCandidates(snap.worldRules, scene.id));

  return { candidates, snapshot: snap, scene };
}
