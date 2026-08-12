import { entityKindOf, isDependencyNode } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import type {
  AffectedEntityRef,
  ManuscriptReference,
  RefactorAnalysis,
  RefactorRequest,
  RefactorRisk,
} from "./types";
import { RefactorError } from "./types";

/**
 * What a requested change reaches — found, not guessed.
 *
 * Dependency discovery runs through the structured systems: the entity graph
 * for references, the causality graph for blast radius, the story-state
 * timeline for knowledge, the test store for assertions. Manuscript discovery
 * runs through the search index. A model is never asked *what is affected*,
 * because the project already knows and a model would only be wrong more
 * expensively (docs/STORY_REFACTOR.md).
 */
export async function analyseRefactor(
  repo: StoryRepository,
  request: RefactorRequest,
): Promise<RefactorAnalysis> {
  const targets = await resolveTargets(repo, request);
  const summaries = await repo.listEntitySummaries();
  const name = new Map(summaries.map((s) => [s.id, s.name || s.id]));
  const kindOf = new Map(summaries.map((s) => [s.id, s.kind as string]));

  const affected = new Map<string, AffectedEntityRef>();
  const add = (id: string, why: string, direct: boolean): void => {
    if (targets.includes(id)) return;
    const existing = affected.get(id);
    if (existing !== undefined && existing.direct) return;
    affected.set(id, {
      id,
      kind: kindOf.get(id) ?? entityKindOf(id) ?? "unknown",
      name: name.get(id) ?? id,
      why,
      direct,
    });
  };

  // ── Structured references: who points at the targets ──────────────────────

  for (const target of targets) {
    for (const edge of await repo.findReferences(target)) {
      add(edge.fromId, `references it as ${edge.field}`, true);
    }
  }

  // ── Knowledge, relationships and the scenes it appears in ─────────────────

  const transitions = await repo.listStateTransitions();
  const touching = transitions.filter(
    (t) =>
      targets.includes(t.subjectId) ||
      targets.includes(t.value) ||
      (t.sourceEntityId !== undefined && targets.includes(t.sourceEntityId)),
  );
  for (const transition of touching) {
    add(transition.sceneId, "records a state change involving it", true);
  }

  const relationships = await repo.listRelationships();
  for (const relationship of relationships) {
    if (
      targets.includes(relationship.characterAId as string) ||
      targets.includes(relationship.characterBId as string)
    ) {
      add(relationship.id as string, "is a relationship one of them is part of", true);
    }
  }

  const scenes = await repo.listScenes();
  const touchedScenes: string[] = [];
  for (const scene of scenes) {
    const named = [
      ...scene.characterIds.map(String),
      ...scene.objectIds.map(String),
      ...scene.plotThreadIds.map(String),
      ...scene.factIds.map(String),
      scene.pov as string | undefined,
    ];
    if (named.some((id) => id !== undefined && targets.includes(id))) {
      add(scene.id as string, "is a scene it appears in", true);
      touchedScenes.push(scene.id as string);
    }
  }

  /**
   * What those scenes are carrying.
   *
   * A relationship does not point at a plot thread and a thread does not point
   * at a relationship — they meet in the scenes both appear in. Without this
   * hop, changing what two characters are to each other would report no threads
   * at all, which is exactly the consequence a writer needs warned about.
   */
  for (const sceneId of touchedScenes) {
    const scene = scenes.find((s) => (s.id as string) === sceneId);
    if (scene === undefined) continue;
    for (const carried of [
      ...scene.plotThreadIds.map(String),
      ...scene.factIds.map(String),
      ...scene.objectIds.map(String),
    ]) {
      add(carried, `is carried by ${sceneId}, a scene it appears in`, false);
    }
  }

  const setups = await repo.listSetups();
  for (const setup of setups) {
    const named = [...setup.setupSceneIds.map(String), ...setup.payoffSceneIds.map(String)];
    if (named.some((id) => touchedScenes.includes(id))) {
      add(setup.id as string, "is planted or paid off in a scene it appears in", false);
    }
  }

  // ── Registered causality ──────────────────────────────────────────────────

  const graphTargets = [...targets.filter((id) => isDependencyNode(id)), ...touchedScenes];
  const primary = targets.find((id) => isDependencyNode(id)) ?? touchedScenes[0];
  const blastRadius = primary === undefined ? null : await repo.calculateBlastRadius(primary);

  for (const target of graphTargets) {
    for (const step of await repo.getDependentsOf(target)) {
      add(step.effectId, `depends on ${target} (${step.kind.replace(/_/g, " ")})`, true);
    }
    for (const id of await repo.getTransitiveDependents(target)) {
      add(id, `depends on ${target} through the causality graph`, false);
    }
  }

  // ── Story tests that assert about it ──────────────────────────────────────

  const tests = await repo.listStoryTests();
  const storyTestIds = tests
    .filter(
      (test) =>
        JSON.stringify(test.assertion).includes(targets.join("|")) || namesAny(test, targets),
    )
    .map((test) => test.id as string);

  // ── The manuscript ────────────────────────────────────────────────────────

  const manuscriptReferences = await findInManuscript(repo, termsFor(request, name));

  // ── Risks ─────────────────────────────────────────────────────────────────

  const risks = deterministicRisks({
    request,
    affected: [...affected.values()],
    manuscriptReferences,
    knowledgeTransitions: touching.length,
    storyTestIds,
    label: (id) => name.get(id) ?? id,
  });

  const counts: Record<string, number> = {};
  for (const entry of affected.values()) {
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  }
  counts.knowledge_transitions = touching.length;
  counts.manuscript_files = manuscriptReferences.length;

  return {
    kind: request.kind,
    summary: describeRequest(request, (id) => name.get(id) ?? id),
    instruction: request.instruction ?? describeRequest(request, (id) => name.get(id) ?? id),
    targets,
    affected: [...affected.values()].sort((a, b) => a.id.localeCompare(b.id)),
    counts,
    manuscriptReferences,
    knowledgeTransitionIds: touching.map((t) => t.id),
    blastRadius,
    highRisk: risks.filter((r) => r.level === "high").flatMap((r) => r.entities),
    risks,
    storyTestIds,
  };
}

/** Which entities the request is about. Everything else is reached from these. */
async function resolveTargets(repo: StoryRepository, request: RefactorRequest): Promise<string[]> {
  const require = async (id: string): Promise<string> => {
    if ((await repo.getEntity(id)) === null) {
      throw new RefactorError("target_not_found", `${id} is not in this project.`);
    }
    return id;
  };

  switch (request.kind) {
    case "rename_entity":
      return [await require(request.entityId)];
    case "change_character_attribute":
      return [await require(request.characterId)];
    case "move_story_event":
      return [await require(request.sceneId), await require(request.toChapterId)];
    case "change_relationship": {
      const relationship = await repo.getEntity<{
        characterAId: string;
        characterBId: string;
      }>(await require(request.relationshipId));
      return [
        request.relationshipId,
        ...(relationship === null ? [] : [relationship.characterAId, relationship.characterBId]),
      ];
    }
  }
}

/** The words the change puts in play, for searching the prose. */
function termsFor(request: RefactorRequest, name: ReadonlyMap<string, string>): string[] {
  switch (request.kind) {
    case "rename_entity": {
      const current = name.get(request.entityId);
      return current === undefined ? [] : [current];
    }
    case "change_relationship":
      return [...(request.oldTerms ?? [])];
    case "change_character_attribute":
      return [...(request.oldTerms ?? [])];
    case "move_story_event":
      return [];
  }
}

/**
 * Where the manuscript says the words that are changing.
 *
 * Through the search index rather than by scanning files, so retrieval is the
 * one that already exists (docs/SEARCH.md). Counted per file, because "eight
 * scenes mention this" is what a writer needs to decide.
 */
async function findInManuscript(
  repo: StoryRepository,
  terms: readonly string[],
): Promise<ManuscriptReference[]> {
  if (terms.length === 0) return [];
  const chapters = await repo.listChapters();
  const byPath = new Map(chapters.map((c) => [c.filePath, c.id as string]));
  const found = new Map<string, ManuscriptReference>();

  for (const term of terms) {
    for (const chapter of chapters) {
      const text = await repo.readProjectFile(chapter.filePath);
      if (text === null) continue;
      const occurrences = countOccurrences(text, term);
      if (occurrences === 0) continue;

      const key = `${chapter.filePath}|${term}`;
      found.set(key, {
        path: chapter.filePath,
        chapterId: byPath.get(chapter.filePath) as string,
        term,
        occurrences,
        excerpt: excerptAround(text, term),
      });
    }
  }
  return [...found.values()];
}

/** Whole-word, case-sensitive: a rename should not turn "Marcus" inside a word. */
export function occurrencePattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu");
}

function countOccurrences(text: string, term: string): number {
  return [...text.matchAll(occurrencePattern(term))].length;
}

function excerptAround(text: string, term: string, radius = 90): string {
  const match = occurrencePattern(term).exec(text);
  if (match === null) return "";
  const at = match.index;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + term.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

function namesAny(
  test: { assertion: unknown; scope: unknown },
  targets: readonly string[],
): boolean {
  const json = `${JSON.stringify(test.assertion)}${JSON.stringify(test.scope)}`;
  return targets.some((id) => json.includes(id));
}

/**
 * Risks the structured systems can state as fact.
 *
 * Nothing here is a judgement. "Chapter 4 says the word eleven times" is a
 * count; whether that makes the change hard is the writer's call, informed by
 * whatever a model adds afterwards under its own label.
 */
function deterministicRisks(input: {
  request: RefactorRequest;
  affected: readonly AffectedEntityRef[];
  manuscriptReferences: readonly ManuscriptReference[];
  knowledgeTransitions: number;
  storyTestIds: readonly string[];
  label: (id: string) => string;
}): RefactorRisk[] {
  const risks: RefactorRisk[] = [];
  const { affected, manuscriptReferences, knowledgeTransitions, storyTestIds } = input;

  const threads = affected.filter((a) => a.kind === "plot_thread");
  if (threads.length > 0) {
    risks.push({
      level: "high",
      summary: `${String(threads.length)} plot thread(s) rest on what is changing.`,
      detail: threads.map((t) => `${t.name} (${t.id}) — ${t.why}`).join("; "),
      entities: threads.map((t) => t.id),
      source: "structured",
    });
  }

  const facts = affected.filter((a) => a.kind === "fact");
  if (facts.length > 0) {
    risks.push({
      level: "high",
      summary: `${String(facts.length)} recorded fact(s) involve it.`,
      detail: facts.map((f) => `${f.name} (${f.id})`).join("; "),
      entities: facts.map((f) => f.id),
      source: "structured",
    });
  }

  if (knowledgeTransitions > 0) {
    risks.push({
      level: "medium",
      summary: `${String(knowledgeTransitions)} recorded state transition(s) name it.`,
      detail:
        "Who knew what, and when, is reconstructed from these. A change here moves the reconstruction with it.",
      entities: [],
      source: "structured",
    });
  }

  const heavy = manuscriptReferences.filter((r) => r.occurrences >= 3);
  for (const reference of heavy) {
    risks.push({
      level: "medium",
      summary: `${reference.path} uses "${reference.term}" ${String(reference.occurrences)} times.`,
      detail: reference.excerpt,
      entities: reference.chapterId === undefined ? [] : [reference.chapterId],
      source: "structured",
    });
  }

  if (storyTestIds.length > 0) {
    risks.push({
      level: "high",
      summary: `${String(storyTestIds.length)} story test(s) assert about it.`,
      detail: `They will be run again after the change: ${storyTestIds.join(", ")}.`,
      entities: [...storyTestIds],
      source: "structured",
    });
  }

  if (input.request.kind === "move_story_event") {
    risks.push({
      level: "high",
      summary: "Moving a scene moves everything anchored to it.",
      detail:
        "Knowledge, positions, object placements and thread steps are anchored to scenes and are replayed in story order. Moving the scene changes where each of them takes effect, which is what the build and the story tests will show.",
      entities: [input.request.sceneId],
      source: "structured",
    });
  }

  return risks;
}

/** The change in one line. */
export function describeRequest(
  request: RefactorRequest,
  label: (id: string) => string = (id) => id,
): string {
  switch (request.kind) {
    case "rename_entity":
      return `${label(request.entityId)} → ${request.newName}`;
    case "change_relationship":
      return `${label(request.relationshipId)}: → ${request.newType}`;
    case "change_character_attribute":
      return `${label(request.characterId)}: ${request.field} → ${
        Array.isArray(request.newValue) ? request.newValue.join("; ") : String(request.newValue)
      }`;
    case "move_story_event":
      return `${label(request.sceneId)} → ${label(request.toChapterId)}`;
  }
}
