import type { Chapter, Scene } from "@jellytind/domain";
import { EvidenceCollector } from "./evidence";
import { countWords, type ProjectSnapshot } from "./project";
import { DebugError, type DebugTrace, type PacingDebugRequest } from "./types";

/**
 * Pacing debugging.
 *
 * Everything here is a **measurement**. A chapter three times the length of its
 * neighbours is a fact; whether that is a problem depends on what the chapter is
 * doing, and a system that graded it would be wrong about half the books ever
 * written — the same reasoning that keeps thread dormancy ungraded
 * (docs/NARRATIVE_THREADS.md).
 *
 * Word counts come from the chapter files, which is the only place prose lives.
 * A chapter's words are attributed to the chapter, never split across its
 * scenes: inventing per-scene numbers would make the totals look more precise
 * than they are.
 */
export async function tracePacing(
  request: PacingDebugRequest,
  project: ProjectSnapshot,
): Promise<DebugTrace> {
  const found = new EvidenceCollector();
  const chapters = inRange(project, request);
  if (chapters.length === 0) {
    throw new DebugError(
      "nothing_to_trace",
      "That range contains no chapters, so there is no pacing to measure.",
    );
  }

  const words = new Map<string, number>();
  for (const chapter of chapters) {
    const text = await project.reader.readProjectFile(chapter.filePath);
    words.set(chapter.id as string, countWords(text ?? ""));
  }

  const scenesOf = new Map<string, Scene[]>();
  for (const scene of project.ordered) {
    const chapterId = scene.chapterId as string | undefined;
    if (chapterId === undefined) continue;
    const existing = scenesOf.get(chapterId);
    if (existing === undefined) scenesOf.set(chapterId, [scene]);
    else existing.push(scene);
  }

  // ── Chapter by chapter ────────────────────────────────────────────────────

  for (const chapter of chapters) {
    const id = chapter.id as string;
    const scenes = scenesOf.get(id) ?? [];
    const count = words.get(id) ?? 0;
    const withoutPurpose = scenes.filter((s) => s.purpose.length === 0);
    const threads = new Set(scenes.flatMap((s) => s.plotThreadIds.map(String)));

    found.add({
      system: "structure",
      statement: `${chapter.title} (${id}): ${String(count)} words across ${String(scenes.length)} scene(s).`,
      detail: [
        `status ${chapter.status}`,
        `${String(threads.size)} thread(s) present`,
        withoutPurpose.length === 0
          ? "every scene records a purpose"
          : `${String(withoutPurpose.length)} scene(s) record no purpose`,
      ].join(" · "),
      chapterId: id,
      entities: [id],
    });

    for (const scene of scenes) {
      found.add({
        system: "structure",
        statement: `${scene.id as string} — "${scene.title}": ${scene.purpose.length > 0 ? scene.purpose.join("; ") : "no purpose recorded"}`,
        detail: `${String(scene.characterIds.length)} character(s) · ${String(scene.plotThreadIds.length)} thread(s) · status ${scene.status}`,
        sceneId: scene.id as string,
        chapterId: id,
        entities: [scene.id as string],
      });
    }
  }

  // ── Distribution ──────────────────────────────────────────────────────────

  const counts = chapters.map((c) => words.get(c.id as string) ?? 0);
  const total = counts.reduce((sum, n) => sum + n, 0);
  const sorted = [...counts].sort((a, b) => a - b);
  const middle = median(sorted);

  found.measure({
    label: "Words across the range",
    value: total,
    unit: "words",
    basis: `Chapter prose for ${String(chapters.length)} chapter(s).`,
    entities: chapters.map((c) => c.id as string),
  });
  found.measure({
    label: "Median chapter length",
    value: middle,
    unit: "words",
    basis: "Middle value of the chapter word counts in the range.",
    entities: [],
  });
  const shortest = sorted[0];
  const longest = sorted.at(-1);
  if (sorted.length > 1 && shortest !== undefined && longest !== undefined) {
    found.measure({
      label: "Longest chapter as a multiple of the shortest",
      value: shortest === 0 ? 0 : Math.round((longest / shortest) * 100) / 100,
      unit: "×",
      basis:
        shortest === 0
          ? "The shortest chapter has no prose, so the ratio is not defined."
          : `${String(longest)} words against ${String(shortest)}.`,
      entities: [],
    });
  }

  // Chapters far from the middle, stated as distance rather than as a verdict.
  for (const chapter of chapters) {
    const count = words.get(chapter.id as string) ?? 0;
    if (middle === 0 || count === 0) continue;
    const ratio = count / middle;
    if (ratio >= 2 || ratio <= 0.5) {
      found.measure({
        label: `${chapter.title} against the median`,
        value: Math.round(ratio * 100) / 100,
        unit: "×",
        basis: `${String(count)} words against a median of ${String(middle)}. Distance only — whether it is wrong depends on what the chapter is doing.`,
        entities: [chapter.id as string],
      });
    }
  }

  // ── Thread activity, chapter by chapter ───────────────────────────────────

  for (const chapter of chapters) {
    const scenes = scenesOf.get(chapter.id as string) ?? [];
    const steps = scenes
      .flatMap((scene) => project.timeline.transitionsAtScene(scene.id as string))
      .filter((t) => t.kind === "thread_appearance" || t.kind === "thread_status");
    found.add({
      system: "plot_threads",
      statement: `${chapter.title}: ${String(steps.length)} recorded thread step(s).`,
      detail:
        steps.length === 0
          ? "No scene in this chapter is recorded as moving a thread."
          : steps
              .map((t) => `${project.label(t.subjectId)} ${t.value} in ${t.sceneId}`)
              .join(" | "),
      chapterId: chapter.id as string,
      entities: [...new Set(steps.map((t) => t.subjectId))],
    });
  }

  // ── What is not recorded ──────────────────────────────────────────────────

  found.didNotInspect(
    "Conflict, tension and stakes per scene — the domain records no such fields, so nothing here measures them.",
  );
  found.didNotInspect(
    "Sentence and paragraph rhythm inside scenes — that needs a reading of the prose, not a count of it.",
  );
  const unpurposed = project.ordered.filter(
    (s) =>
      s.purpose.length === 0 &&
      chapters.some((c) => (c.id as string) === (s.chapterId as string | undefined)),
  );
  if (unpurposed.length > 0) {
    found.didNotInspect(
      `What ${String(unpurposed.length)} scene(s) in this range are for — no purpose is recorded for them.`,
    );
  }

  return {
    mode: "pacing",
    problem: request.problem,
    scope: found.scope(
      `${String(chapters.length)} chapter(s): ${chapters.map((c) => c.title).join(", ")}.`,
    ),
    evidence: found.evidence,
    measurements: found.measurements,
    excerpts: found.excerpts,
  };
}

function inRange(project: ProjectSnapshot, request: PacingDebugRequest): readonly Chapter[] {
  if (request.chapterId !== undefined) {
    const one = project.chapterById(request.chapterId);
    if (one === undefined) {
      throw new DebugError(
        "target_not_found",
        `${request.chapterId} is not a chapter in this project.`,
      );
    }
    return [one];
  }
  const ordered = project.chapters;
  const from =
    request.fromChapterId === undefined
      ? 0
      : ordered.findIndex((c) => (c.id as string) === request.fromChapterId);
  const to =
    request.toChapterId === undefined
      ? ordered.length - 1
      : ordered.findIndex((c) => (c.id as string) === request.toChapterId);
  if (from < 0 || to < 0) {
    throw new DebugError(
      "target_not_found",
      "One end of that chapter range is not a chapter in this project.",
    );
  }
  return ordered.slice(Math.min(from, to), Math.max(from, to) + 1);
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : Math.round((((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2) * 100) / 100;
}
