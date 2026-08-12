import { indexLocations } from "@jellytind/domain";
import type { Chapter } from "@jellytind/domain";
import { PRIORITY, type Candidate } from "../candidate";
import { CompileError } from "../errors";
import type { ProjectReader } from "../reader";
import { renderChapter, summariseChapter } from "../render";
import { adjacentChapters, scenesOfChapter } from "../sequence";
import { buildTimeline, chapterInvolvement, stateCandidates } from "./state";
import {
  byId,
  characterCandidate,
  plotThreadCandidate,
  proseCandidate,
  provenance,
  readSnapshot,
  sceneCandidate,
  worldRuleCandidates,
  type ProjectSnapshot,
} from "./shared";

/** Thread statuses that are live at this point in the story. */
const ACTIVE_STATUSES = new Set(["introduced", "active", "escalating"]);

/**
 * **Chapter Inspection** — understand a whole chapter.
 *
 * Retrieves: the chapter's scenes, a summary of the previous and next chapters
 * where available, the characters involved across those scenes, and the plot
 * threads still active in them.
 *
 * Note what this recipe deliberately does *not* do: it does not pull the
 * neighbouring chapters' prose. At chapter scope that would be three chapters of
 * manuscript for one question. Neighbours arrive as summaries, which is why a
 * separate recipe exists rather than one universal strategy scaled up.
 */
export async function gatherChapterInspection(
  reader: ProjectReader,
  chapterId: string,
  snapshot?: ProjectSnapshot,
): Promise<{ candidates: Candidate[]; snapshot: ProjectSnapshot; chapter: Chapter }> {
  const snap = snapshot ?? (await readSnapshot(reader));
  const chapter = byId(snap.chapters, chapterId);
  if (chapter === undefined) {
    throw new CompileError("unknown_target", `No chapter exists with ID "${chapterId}".`, {
      details: { targetId: chapterId },
    });
  }

  const scenes = scenesOfChapter(snap.scenes, chapter.id);
  const candidates: Candidate[] = [
    {
      id: chapter.id,
      kind: "chapter",
      label: chapter.title,
      section: "target",
      priority: PRIORITY.essential,
      provenance: provenance("target_entity", "the chapter under inspection"),
      full: renderChapter(chapter, scenes),
      summary: summariseChapter(chapter, scenes),
      required: true,
    },
  ];

  const prose = await proseCandidate(
    reader,
    chapter,
    provenance("target_prose", `prose of ${chapter.id}`, [chapter.id]),
  );
  if (prose !== null) candidates.push(prose);

  for (const scene of scenes) {
    candidates.push(
      sceneCandidate(
        scene,
        "adjacentScenes",
        PRIORITY.adjacent,
        provenance("chapter_scene", `scene of ${chapter.id}`, [chapter.id]),
      ),
    );
  }

  // Neighbouring chapters as summaries, never as full prose.
  const { previous, next } = adjacentChapters(snap.chapters, chapter.id);
  for (const [neighbour, rule, word] of [
    [previous, "previous_chapter", "before"],
    [next, "next_chapter", "after"],
  ] as const) {
    if (neighbour === undefined) continue;
    const digest = summariseChapter(neighbour, scenesOfChapter(snap.scenes, neighbour.id));
    candidates.push({
      id: neighbour.id,
      kind: "chapter",
      label: neighbour.title,
      section: "adjacentScenes",
      priority: PRIORITY.adjacent + 1,
      provenance: provenance(rule, `summary of the chapter immediately ${word} ${chapter.id}`, [
        chapter.id,
      ]),
      full: digest,
      summary: digest,
    });
  }

  // Characters involved anywhere in the chapter — POV characters first.
  const povs = scenes.flatMap((scene) => (scene.pov === undefined ? [] : [scene.pov as string]));
  const participants = scenes.flatMap((scene) => scene.characterIds as readonly string[]);
  for (const id of new Set([...povs, ...participants])) {
    const character = byId(snap.characters, id);
    if (character === undefined) continue;
    const scenesWith = scenes
      .filter((scene) => scene.pov === id || scene.characterIds.includes(id as never))
      .map((scene) => scene.id);
    candidates.push(
      characterCandidate(
        character,
        snap.relationships,
        PRIORITY.involved + (povs.includes(id) ? 0 : 1),
        provenance(
          "chapter_character",
          `appears in ${String(scenesWith.length)} scene(s) of ${chapter.id}: ${scenesWith.join(", ")}`,
          [chapter.id, ...scenesWith],
        ),
      ),
    );
  }

  // Plot threads carried by the chapter's scenes, still live.
  const threadIds = [
    ...new Set(scenes.flatMap((scene) => scene.plotThreadIds as readonly string[])),
  ];
  for (const id of threadIds) {
    const thread = byId(snap.plotThreads, id);
    if (thread === undefined || !ACTIVE_STATUSES.has(thread.status)) continue;
    const scenesWith = scenes
      .filter((scene) => scene.plotThreadIds.includes(id as never))
      .map((scene) => scene.id);
    candidates.push(
      plotThreadCandidate(
        thread,
        PRIORITY.threads,
        provenance(
          "chapter_plot_thread",
          `active (${thread.status}) thread carried by ${scenesWith.join(", ")} in ${chapter.id}`,
          [chapter.id, ...scenesWith],
        ),
      ),
    );
  }

  // Story state as it stands entering the chapter's first scene.
  const involvement = chapterInvolvement(snap.scenes, chapter);
  if (involvement.firstScene !== undefined) {
    const timeline = await buildTimeline(reader);
    const facts = new Map((await reader.listFacts()).map((f) => [f.id as string, f]));
    candidates.push(
      ...stateCandidates({
        timeline,
        facts,
        locations: indexLocations(snap.locations),
        characterIds: involvement.characterIds,
        objectIds: involvement.objectIds,
        sceneId: involvement.firstScene.id,
        position: "before",
        becauseOf: chapter.id,
      }),
    );
  }

  candidates.push(...worldRuleCandidates(snap.worldRules, chapter.id));

  return { candidates, snapshot: snap, chapter };
}
