import { orderScenes } from "@jellytind/domain";
import { CausalityGraph } from "@jellytind/story-causality";
import { filteredScenes } from "./point";
import type {
  CausalityEdgeModel,
  CausalityNodeModel,
  CausalityViewModel,
  CharacterArcModel,
  CharacterKnowledgeModel,
  FactKnowledgeModel,
  KnowledgeRowModel,
  RelationshipViewModel,
  StoryMapContext,
  StoryMapFilters,
  StoryPoint,
  ThreadViewModel,
  TimelineViewModel,
} from "./types";

/**
 * The six views (§2): pure projections of one canonical story. Each answers
 * a different question about the same entities, at the same stable IDs, and
 * none of them stores anything.
 */

/** A human label for any entity ID the map can encounter. */
export function labelOf(context: StoryMapContext, id: string): string {
  const found =
    context.characters.find((held) => held.id === id)?.name ??
    context.scenes.find((held) => held.id === id)?.title ??
    context.chapters.find((held) => held.id === id)?.title ??
    context.locations.find((held) => held.id === id)?.name ??
    context.threads.find((held) => held.id === id)?.name ??
    context.events.find((held) => held.id === id)?.name ??
    context.facts.find((held) => held.id === id)?.statement ??
    context.decisions.find((held) => held.id === id)?.description;
  return found ?? id;
}

/** The entity kind, read from the stable ID's prefix (§3). */
export const kindOfId = (id: string): string => (id.split("_")[0] ?? "").toLowerCase() || "unknown";

// ── Timeline (§10) ───────────────────────────────────────────────────────────

/**
 * Presentation order and story chronology, side by side. A scene whose
 * chronological rank precedes an earlier-told scene's rank is a flashback —
 * derived from the chronology, never guessed from titles.
 */
export function timelineView(
  context: StoryMapContext,
  filters: StoryMapFilters = {},
): TimelineViewModel {
  const kept = filteredScenes(context.scenes, context.chapters, filters);
  const chapterTitles = new Map(
    context.chapters.map((chapter) => [chapter.id as string, chapter.title]),
  );
  const chronRank = new Map(
    context.chronology.chronologicalOrder().map((node, index) => [node.id, index]),
  );
  const presentation = new Map(
    orderScenes(context.scenes, context.chapters).map((scene, index) => [
      scene.id as string,
      index,
    ]),
  );

  let highestSoFar = -1;
  const flashbacks = new Set<string>();
  for (const scene of orderScenes(context.scenes, context.chapters)) {
    const rank = chronRank.get(scene.id as string);
    if (rank === undefined) continue;
    if (rank < highestSoFar) flashbacks.add(scene.id as string);
    highestSoFar = Math.max(highestSoFar, rank);
  }

  const scenes = kept.map((scene) => {
    const chapterId = scene.chapterId as string | undefined;
    const rank = chronRank.get(scene.id as string);
    return {
      sceneId: scene.id as string,
      title: scene.title,
      ...(chapterId !== undefined ? { chapterId } : {}),
      ...(chapterId !== undefined && chapterTitles.get(chapterId) !== undefined
        ? { chapterTitle: chapterTitles.get(chapterId) as string }
        : {}),
      presentationIndex: presentation.get(scene.id as string) ?? 0,
      ...(rank !== undefined ? { chronologicalIndex: rank } : {}),
      isFlashback: flashbacks.has(scene.id as string),
      characterIds: scene.characterIds as readonly string[],
      ...(scene.locationId !== undefined ? { locationId: scene.locationId as string } : {}),
      threadIds: (scene.plotThreadIds ?? []) as readonly string[],
    };
  });

  const keptIds = new Set(scenes.map((scene) => scene.sceneId));
  const events =
    filters.showEvents === false
      ? []
      : context.events
          .filter((event) => event.sceneId === undefined || keptIds.has(event.sceneId as string))
          .map((event) => {
            const rank = chronRank.get(event.id as string);
            // Historical: placed before every scene the chronology can rank.
            const firstSceneRank = Math.min(
              ...scenes
                .map((scene) => scene.chronologicalIndex)
                .filter((held): held is number => held !== undefined),
              Number.POSITIVE_INFINITY,
            );
            return {
              eventId: event.id as string,
              name: event.name,
              ...(event.sceneId !== undefined ? { sceneId: event.sceneId as string } : {}),
              ...(rank !== undefined ? { chronologicalIndex: rank } : {}),
              isHistorical:
                event.sceneId === undefined && rank !== undefined && rank < firstSceneRank,
            };
          });

  // Parallel activity: one lane per character in view, their scene presences
  // in presentation order. Lanes come from the filter (or every character in
  // the kept scenes), never all cast of a 200k-word novel at once (§18).
  const laneCharacterIds =
    filters.characterIds ?? [...new Set(scenes.flatMap((scene) => scene.characterIds))].slice(0, 8);
  const lanes = laneCharacterIds
    .map((characterId) => {
      const character = context.characters.find((held) => held.id === characterId);
      return {
        characterId,
        name: character?.name ?? characterId,
        stops: scenes
          .filter((scene) => scene.characterIds.includes(characterId))
          .map((scene) => ({
            sceneId: scene.sceneId,
            presentationIndex: scene.presentationIndex,
            ...(scene.locationId !== undefined ? { locationId: scene.locationId } : {}),
          })),
      };
    })
    .filter((lane) => lane.stops.length > 0);

  return { scenes, events, lanes, unresolvable: context.chronology.contradictorySet() };
}

// ── Knowledge (§5) ───────────────────────────────────────────────────────────

/** Who stands where on one fact, at one story point. */
export function factKnowledgeView(
  context: StoryMapContext,
  factId: string,
  at: StoryPoint,
  filters: StoryMapFilters = {},
): FactKnowledgeModel {
  const characters =
    filters.characterIds !== undefined
      ? context.characters.filter((held) => filters.characterIds?.includes(held.id as string))
      : context.characters;
  const rows: KnowledgeRowModel[] = characters.map((character) => {
    const record = context.timeline.knows(character.id as string, factId, at);
    return {
      characterId: character.id as string,
      name: character.name,
      state: record?.state ?? "unknown",
      ...(record?.acquiredAtSceneId !== undefined
        ? { acquiredAtSceneId: record.acquiredAtSceneId }
        : {}),
      ...(record !== null ? { sourceType: record.sourceType } : {}),
      ...(record?.sourceEntityId !== undefined ? { sourceEntityId: record.sourceEntityId } : {}),
    };
  });
  return {
    factId,
    statement: labelOf(context, factId),
    at,
    rows,
  };
}

/** One character's information world at a point (§5). */
export function characterKnowledgeView(
  context: StoryMapContext,
  characterId: string,
  at: StoryPoint,
): CharacterKnowledgeModel {
  const state = context.timeline.characterStateAt(characterId, at);
  return {
    characterId,
    name: labelOf(context, characterId),
    at,
    holdings: state.knowledge
      .filter((record) => record.state !== "unknown")
      .map((record) => ({
        factId: record.factId,
        statement: labelOf(context, record.factId),
        state: record.state,
        ...(record.acquiredAtSceneId !== undefined
          ? { acquiredAtSceneId: record.acquiredAtSceneId }
          : {}),
        ...(record.sourceEntityId !== undefined ? { sourceEntityId: record.sourceEntityId } : {}),
      })),
  };
}

// ── Relationships (§6) ───────────────────────────────────────────────────────

export function relationshipView(
  context: StoryMapContext,
  at: StoryPoint,
  filters: StoryMapFilters = {},
): RelationshipViewModel {
  const keep = (characterId: string): boolean =>
    filters.characterIds === undefined || filters.characterIds.includes(characterId);
  const edges = context.relationships
    .filter(
      (relationship) =>
        keep(relationship.characterAId as string) || keep(relationship.characterBId as string),
    )
    .map((relationship) => {
      const state = context.timeline.relationshipStateAt(relationship, at);
      return {
        relationshipId: relationship.id as string,
        characterAId: state.characterAId,
        characterBId: state.characterBId,
        status: state.status,
        type: state.type,
        dimensions: Object.values(state.dimensions)
          .filter(
            (value): value is NonNullable<typeof value> =>
              value !== undefined && value.level !== undefined,
          )
          .map((value) => ({ dimension: value.dimension, value: value.level as string })),
        keyChangeSceneIds: [...new Set(state.events.map((event) => event.sceneId))],
      };
    });
  const nodeIds = [...new Set(edges.flatMap((edge) => [edge.characterAId, edge.characterBId]))];
  return {
    at,
    nodes: nodeIds.map((characterId) => ({
      characterId,
      name: labelOf(context, characterId),
    })),
    edges,
  };
}

// ── Causality (§7) ───────────────────────────────────────────────────────────

/**
 * The dependency neighbourhood of one entity: prerequisites so many steps up,
 * consequences so many steps down, expandable by asking again with more depth.
 */
export function causalityView(
  context: StoryMapContext,
  focusId: string,
  options: { readonly upDepth?: number; readonly downDepth?: number } = {},
): CausalityViewModel {
  const graph = new CausalityGraph(context.dependencies);
  const upDepth = options.upDepth ?? 2;
  const downDepth = options.downDepth ?? 2;

  const nodes = new Map<string, CausalityNodeModel>();
  const edges = new Map<string, CausalityEdgeModel>();
  const put = (id: string, distance: number): void => {
    const held = nodes.get(id);
    if (held === undefined || Math.abs(distance) < Math.abs(held.distance)) {
      nodes.set(id, { id, label: labelOf(context, id), kind: kindOfId(id), distance });
    }
  };
  put(focusId, 0);

  const walk = (fromId: string, direction: "up" | "down", depth: number): void => {
    if (depth === 0) return;
    const steps =
      direction === "down" ? graph.getDependents(fromId) : graph.getDependencies(fromId);
    for (const step of steps) {
      const nextId = direction === "down" ? step.effectId : step.causeId;
      const sign = direction === "down" ? 1 : -1;
      const from = nodes.get(fromId)?.distance ?? 0;
      put(nextId, from + sign);
      const dependency = context.dependencies.find((held) => held.id === step.dependencyId);
      edges.set(`${step.causeId}>${step.effectId}`, {
        causeId: step.causeId,
        effectId: step.effectId,
        kind: step.kind,
        description: dependency?.description ?? "",
      });
      if (nodes.size < 400) walk(nextId, direction, depth - 1);
    }
  };
  walk(focusId, "up", upDepth);
  walk(focusId, "down", downDepth);

  return {
    focusId,
    focusLabel: labelOf(context, focusId),
    nodes: [...nodes.values()].sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id)),
    edges: [...edges.values()],
    cyclic: graph.calculateBlastRadius(focusId, { maxDepth: downDepth }).cyclic,
  };
}

/** The §17 signature interaction: what a change to this entity may reach. */
export function blastRadiusView(context: StoryMapContext, entityId: string) {
  const graph = new CausalityGraph(context.dependencies);
  const radius = graph.calculateBlastRadius(entityId);
  return {
    ...radius,
    focusLabel: labelOf(context, entityId),
    affected: radius.affected.map((entry) => ({
      ...entry,
      label: labelOf(context, entry.id),
      kind: kindOfId(entry.id),
    })),
  };
}

// ── Plot threads (§8) ────────────────────────────────────────────────────────

export function threadView(context: StoryMapContext, threadId: string): ThreadViewModel {
  const ordered = orderScenes(context.scenes, context.chapters);
  const last = ordered.at(-1);
  const state =
    last === undefined
      ? null
      : context.timeline.threadStateAt(
          { id: threadId },
          { sceneId: last.id as string, position: "after" },
        );
  const touches = new Set([
    ...(state?.appearanceSceneIds ?? []),
    ...ordered
      .filter((scene) => ((scene.plotThreadIds ?? []) as readonly string[]).includes(threadId))
      .map((scene) => scene.id as string),
  ]);

  const chapters = [...context.chapters]
    .sort((a, b) => a.order - b.order)
    .map((chapter) => {
      const inChapter = ordered.filter((scene) => scene.chapterId === chapter.id);
      const touchSceneIds = inChapter
        .map((scene) => scene.id as string)
        .filter((sceneId) => touches.has(sceneId));
      return {
        chapterId: chapter.id as string,
        title: chapter.title,
        order: chapter.order,
        touchSceneIds,
        marks: touchSceneIds.map((sceneId) => ({
          sceneId,
          kind:
            sceneId === state?.introducedSceneId
              ? "introduced"
              : sceneId === state?.resolvedSceneId
                ? "resolved"
                : "advanced",
        })),
      };
    });

  // Dormancy: untouched chapters strictly between two touched ones.
  const touchedIndexes = chapters
    .map((chapter, index) => (chapter.touchSceneIds.length > 0 ? index : -1))
    .filter((index) => index !== -1);
  const dormantSpans: ThreadViewModel["dormantSpans"][number][] = [];
  for (let i = 0; i + 1 < touchedIndexes.length; i += 1) {
    const from = touchedIndexes[i] as number;
    const to = touchedIndexes[i + 1] as number;
    if (to - from > 1) {
      dormantSpans.push({
        fromChapterId: (chapters[from + 1] as (typeof chapters)[number]).chapterId,
        toChapterId: (chapters[to - 1] as (typeof chapters)[number]).chapterId,
        chapters: to - from - 1,
      });
    }
  }

  return {
    threadId,
    name: labelOf(context, threadId),
    status: state?.status ?? "planned",
    ...(state?.introducedSceneId !== undefined
      ? { introducedSceneId: state.introducedSceneId }
      : {}),
    ...(state?.resolvedSceneId !== undefined ? { resolvedSceneId: state.resolvedSceneId } : {}),
    chapters,
    dormantSpans,
  };
}

// ── Character arc (§9) ───────────────────────────────────────────────────────

/**
 * Qualitative milestones only (§9): what changed, in words, at which scene.
 * No invented numeric curves — the writer's own recorded changes, in order.
 */
export function characterArcView(context: StoryMapContext, characterId: string): CharacterArcModel {
  const ordered = orderScenes(context.scenes, context.chapters);
  const presentation = new Map(ordered.map((scene, index) => [scene.id as string, index]));
  const milestones: CharacterArcModel["milestones"][number][] = [];
  const push = (
    sceneId: string | undefined,
    kind: CharacterArcModel["milestones"][number]["kind"],
    label: string,
    aboutId?: string,
  ): void => {
    if (sceneId === undefined || !presentation.has(sceneId)) return;
    milestones.push({
      sceneId,
      presentationIndex: presentation.get(sceneId) ?? 0,
      kind,
      label,
      ...(aboutId !== undefined ? { aboutId } : {}),
    });
  };

  for (const transition of context.transitions) {
    if (transition.subjectId !== characterId) continue;
    if (transition.confirmationStatus === "rejected") continue;
    if (transition.kind === "character_status") {
      push(transition.sceneId, "status", `Becomes ${transition.value}`);
    }
    if (transition.kind === "character_location") {
      push(
        transition.sceneId,
        "location",
        `Arrives at ${labelOf(context, transition.value)}`,
        transition.value,
      );
    }
  }

  const last = ordered.at(-1);
  if (last !== undefined) {
    const end = { sceneId: last.id as string, position: "after" as const };
    for (const record of context.timeline.characterStateAt(characterId, end).knowledge) {
      if (record.state === "unknown") continue;
      push(
        record.acquiredAtSceneId,
        "knowledge",
        `${record.state === "believed" ? "Comes to believe" : "Learns"}: ${labelOf(context, record.factId)}`,
        record.factId,
      );
    }
    for (const relationship of context.relationships) {
      if (relationship.characterAId !== characterId && relationship.characterBId !== characterId)
        continue;
      const other =
        relationship.characterAId === characterId
          ? (relationship.characterBId as string)
          : (relationship.characterAId as string);
      const state = context.timeline.relationshipStateAt(relationship, end);
      for (const event of state.events) {
        push(
          event.sceneId,
          "relationship",
          `With ${labelOf(context, other)}: ${event.kind.replaceAll("_", " ")}`,
          other,
        );
      }
    }
  }

  for (const decision of context.decisions) {
    if (decision.characterId !== characterId) continue;
    push(decision.sceneId as string | undefined, "decision", `Decides: ${decision.description}`);
  }
  for (const event of context.events) {
    if (event.sceneId === undefined) continue;
    const scene = context.scenes.find((held) => held.id === event.sceneId);
    if (((scene?.characterIds ?? []) as readonly string[]).includes(characterId)) {
      push(event.sceneId as string, "event", event.name, event.id as string);
    }
  }

  const character = context.characters.find((held) => held.id === characterId);
  return {
    characterId,
    name: character?.name ?? characterId,
    goals: (character?.goals ?? []) as readonly string[],
    milestones: milestones.sort(
      (a, b) => a.presentationIndex - b.presentationIndex || a.label.localeCompare(b.label),
    ),
  };
}
