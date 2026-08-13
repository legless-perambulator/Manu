import type { Chapter, SkillFinding, SkillFindingKind } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import { proseOf } from "../prose";
import type { SkillContext, SkillOperation, StepOutcome } from "../types";

/** Build a finding, tying it to the step that produced it. */
export function finding(
  context: SkillContext,
  index: number,
  input: {
    kind: SkillFindingKind;
    statement: string;
    detail?: string;
    basis?: string;
    sceneIds?: readonly string[];
    entities?: readonly string[];
    source?: SkillFinding["source"];
  },
): SkillFinding {
  return {
    id: context.finding(index),
    kind: input.kind,
    statement: input.statement,
    ...(input.detail === undefined ? {} : { detail: input.detail }),
    ...(input.basis === undefined ? {} : { basis: input.basis }),
    ...(input.sceneIds === undefined ? {} : { sceneIds: input.sceneIds }),
    ...(input.entities === undefined ? {} : { entities: input.entities }),
    source: input.source ?? "deterministic",
    stepId: context.stepId,
  };
}

export interface ChapterProse {
  readonly chapterId: string;
  readonly title: string;
  readonly text: string;
  readonly words: number;
}

/** Chapter prose, in manuscript order — one chapter when one is named. */
export async function chapterProse(
  repo: StoryRepository,
  chapterId?: string,
): Promise<ChapterProse[]> {
  const chapters = (await repo.listChapters()).filter(
    (chapter) => chapterId === undefined || (chapter.id as string) === chapterId,
  );
  const out: ChapterProse[] = [];
  for (const chapter of chapters) {
    const raw = await repo.readProjectFile(chapter.filePath);
    const text = proseOf(raw ?? "");
    out.push({
      chapterId: chapter.id as string,
      title: chapter.title,
      text,
      words: text === "" ? 0 : (text.match(/\S+/g) ?? []).length,
    });
  }
  return out;
}

/** Display names for every entity, so a report never prints a bare ID. */
export async function labels(repo: StoryRepository): Promise<Map<string, string>> {
  const summaries = await repo.listEntitySummaries();
  return new Map(summaries.map((entry) => [entry.id, entry.name]));
}

export function chapterTitle(chapters: readonly Chapter[], id: string | undefined): string {
  return chapters.find((chapter) => (chapter.id as string) === id)?.title ?? id ?? "unplaced";
}

/**
 * A step that found nothing to work on.
 *
 * Deliberately its own outcome rather than an empty success: a report that says
 * "no dialogue was found" and one that says "dialogue looks fine" are different
 * claims, and only one of them is true here.
 */
export function nothingToDo(reason: string): StepOutcome {
  return { summary: reason, skipped: reason };
}

/** Declare an operation, with the boilerplate defaults filled in. */
export function operation(
  definition: Omit<SkillOperation, "requiresInput" | "reads" | "requiredTools"> &
    Partial<Pick<SkillOperation, "requiresInput" | "reads" | "requiredTools">>,
): SkillOperation {
  return {
    requiresInput: [],
    reads: [],
    requiredTools: [],
    ...definition,
  };
}
