import type { StoryRepository } from "@jellytind/story-repository";
import { occurrencePattern } from "./analyse";
import {
  RefactorError,
  type PlanStep,
  type RefactorAnalysis,
  type RefactorPlan,
  type RefactorRequest,
  type TextOccurrence,
} from "./types";

/**
 * Turn an analysis into an ordered plan.
 *
 * Every step names **stable entity IDs**, and no step renames one. A refactor
 * may change everything about a character except which character they are —
 * that is what makes references survive the operation at all
 * (docs/DOMAIN_MODEL.md).
 *
 * The plan is built deterministically. A model may add to it afterwards, and
 * what it adds is labelled; the structured half never depends on one, which is
 * why a project with no model configured can still rename a character
 * correctly.
 */
export async function planRefactor(
  repo: StoryRepository,
  request: RefactorRequest,
  analysis: RefactorAnalysis,
): Promise<RefactorPlan> {
  const steps: PlanStep[] = [];

  switch (request.kind) {
    case "rename_entity":
      steps.push(...(await planRename(repo, request, analysis)));
      break;
    case "change_relationship":
      steps.push(...(await planRelationship(repo, request, analysis)));
      break;
    case "change_character_attribute":
      steps.push(...(await planAttribute(repo, request, analysis)));
      break;
    case "move_story_event":
      steps.push(...planMove(request));
      break;
  }

  if (steps.length === 0) {
    throw new RefactorError(
      "nothing_to_do",
      "Nothing in the project would change. Check the target and the terms.",
    );
  }
  return { steps, modelNotes: [], consequences: [] };
}

// ── Rename ───────────────────────────────────────────────────────────────────

async function planRename(
  repo: StoryRepository,
  request: Extract<RefactorRequest, { kind: "rename_entity" }>,
  analysis: RefactorAnalysis,
): Promise<PlanStep[]> {
  const entity = await repo.getEntity<Record<string, unknown>>(request.entityId);
  if (entity === null) {
    throw new RefactorError("target_not_found", `${request.entityId} is not in this project.`);
  }
  const field = nameFieldOf(entity);
  const oldName = String(entity[field] ?? "");
  if (oldName === request.newName) {
    throw new RefactorError("nothing_to_do", `${request.entityId} is already called that.`);
  }

  const steps: PlanStep[] = [];
  const patch: Record<string, unknown> = { [field]: request.newName };

  // The old name stays as an alias by default: it is still what they used to
  // be called, and search should keep finding them by it.
  if (request.keepOldNameAsAlias !== false && Array.isArray(entity.aliases)) {
    const aliases = (entity.aliases as string[]).filter((a) => a !== request.newName);
    if (!aliases.includes(oldName)) aliases.push(oldName);
    patch.aliases = aliases;
  }

  steps.push({
    kind: "update_entity",
    entityId: request.entityId,
    patch,
    reason: `Display name changes; ${request.entityId} does not.`,
  });

  steps.push(
    ...(await textSteps(repo, analysis, oldName, request.newName, "The manuscript uses the name.")),
  );
  return steps;
}

/** Which field carries the display name for this kind of record. */
function nameFieldOf(entity: Record<string, unknown>): string {
  for (const field of ["name", "title", "statement", "description"]) {
    if (typeof entity[field] === "string") return field;
  }
  return "name";
}

// ── Relationship ─────────────────────────────────────────────────────────────

async function planRelationship(
  repo: StoryRepository,
  request: Extract<RefactorRequest, { kind: "change_relationship" }>,
  analysis: RefactorAnalysis,
): Promise<PlanStep[]> {
  const relationship = await repo.getEntity<{ type: string; status?: string }>(
    request.relationshipId,
  );
  if (relationship === null) {
    throw new RefactorError(
      "target_not_found",
      `${request.relationshipId} is not in this project.`,
    );
  }

  const steps: PlanStep[] = [
    {
      kind: "update_entity",
      entityId: request.relationshipId,
      patch: {
        type: request.newType,
        ...(request.newStatus !== undefined ? { status: request.newStatus } : {}),
        ...(request.newDescription !== undefined ? { description: request.newDescription } : {}),
      },
      reason: `The relationship's type changes; the pair, and their IDs, do not.`,
    },
  ];

  if (request.newTerm !== undefined) {
    for (const term of request.oldTerms ?? []) {
      steps.push(
        ...(await textSteps(
          repo,
          analysis,
          term,
          request.newTerm,
          `The prose calls them "${term}".`,
        )),
      );
    }
  }

  // Everything the old relation was load-bearing for. Named, not fixed: a
  // motive that no longer works is a rewrite, not a substitution.
  const dependants = analysis.affected.filter(
    (a) => a.kind === "plot_thread" || a.kind === "fact" || a.kind === "setup",
  );
  if (dependants.length > 0) {
    steps.push({
      kind: "manual",
      description: `Check what rested on the old relationship: ${dependants
        .map((d) => `${d.name} (${d.id})`)
        .join("; ")}.`,
      entities: dependants.map((d) => d.id),
      reason:
        "A motive built on the old relation does not become a motive built on the new one by substitution.",
    });
  }

  return steps;
}

// ── Attribute ────────────────────────────────────────────────────────────────

async function planAttribute(
  repo: StoryRepository,
  request: Extract<RefactorRequest, { kind: "change_character_attribute" }>,
  analysis: RefactorAnalysis,
): Promise<PlanStep[]> {
  const character = await repo.getEntity<Record<string, unknown>>(request.characterId);
  if (character === null) {
    throw new RefactorError("target_not_found", `${request.characterId} is not in this project.`);
  }

  const steps: PlanStep[] = [
    {
      kind: "update_entity",
      entityId: request.characterId,
      patch: {
        [request.field]:
          request.field === "goals"
            ? Array.isArray(request.newValue)
              ? request.newValue
              : [String(request.newValue)]
            : String(request.newValue),
      },
      reason: `${request.field} changes on ${request.characterId}.`,
    },
  ];

  if (request.newTerm !== undefined) {
    for (const term of request.oldTerms ?? []) {
      steps.push(
        ...(await textSteps(
          repo,
          analysis,
          term,
          request.newTerm,
          `The prose calls them a ${term}.`,
        )),
      );
    }
  }
  return steps;
}

// ── Move ─────────────────────────────────────────────────────────────────────

function planMove(request: Extract<RefactorRequest, { kind: "move_story_event" }>): PlanStep[] {
  return [
    {
      kind: "move_scene",
      sceneId: request.sceneId,
      toChapterId: request.toChapterId,
      reason: "The scene changes chapter; nothing anchored to it is re-anchored.",
    },
    {
      kind: "manual",
      description:
        "Read the scene's opening and the scene it now follows. Moving a scene rarely leaves its first paragraph right.",
      entities: [request.sceneId],
      reason: "Transitions between scenes are prose, and prose is not a field.",
    },
  ];
}

// ── Shared: deterministic text substitution ──────────────────────────────────

/**
 * Term substitutions, one step per chapter, with every occurrence located.
 *
 * Whole-word and case-sensitive: renaming Marcus must not rewrite the middle of
 * another word, and a substitution a writer cannot see the extent of is one
 * they cannot approve.
 */
async function textSteps(
  repo: StoryRepository,
  analysis: RefactorAnalysis,
  find: string,
  replace: string,
  reason: string,
): Promise<PlanStep[]> {
  const steps: PlanStep[] = [];
  const paths = [
    ...new Set(analysis.manuscriptReferences.filter((r) => r.term === find).map((r) => r.path)),
  ];

  for (const path of paths) {
    const text = await repo.readProjectFile(path);
    if (text === null) continue;
    const occurrences = locate(text, find, replace);
    if (occurrences.length === 0) continue;

    const chapterId = analysis.manuscriptReferences.find((r) => r.path === path)?.chapterId;
    steps.push({
      kind: "replace_text",
      path,
      ...(chapterId !== undefined ? { chapterId } : {}),
      find,
      replace,
      occurrences,
      reason,
    });
  }
  return steps;
}

/** Every occurrence, with enough surrounding text to judge the substitution. */
export function locate(text: string, find: string, replace: string, radius = 60): TextOccurrence[] {
  const out: TextOccurrence[] = [];
  for (const match of text.matchAll(occurrencePattern(find))) {
    const at = match.index;
    const start = Math.max(0, at - radius);
    const end = Math.min(text.length, at + find.length + radius);
    const head = text.slice(start, at);
    const tail = text.slice(at + find.length, end);
    out.push({
      start: at,
      end: at + find.length,
      before: `${head}${find}${tail}`.replace(/\s+/g, " ").trim(),
      after: `${head}${replace}${tail}`.replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

/** Apply a substitution to a whole file, deterministically. */
export function applyReplacement(text: string, find: string, replace: string): string {
  return text.replace(occurrencePattern(find), replace);
}
