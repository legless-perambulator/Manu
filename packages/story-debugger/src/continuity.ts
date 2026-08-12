import { describeObjectState, describeTransition } from "@jellytind/story-state";
import { EvidenceCollector } from "./evidence";
import type { ProjectSnapshot } from "./project";
import { DebugError, type ContinuityDebugRequest, type DebugTrace } from "./types";

/**
 * Continuity debugging: start from a compiler diagnostic and trace its cause.
 *
 * The Story Build says *what* is wrong. It does not say how the project got
 * there, and that is usually the harder half: "the revolver is at the manor and
 * nothing moves it" is a finding; "it was last recorded in the flat in
 * SCENE_0003, and no transfer follows" is the cause, and the cause is what a
 * writer fixes (docs/STORY_COMPILER.md).
 *
 * So this trace walks each entity the diagnostic names back through the system
 * that owns it, in story order, up to the scene where the finding landed.
 */
export async function traceContinuity(
  request: ContinuityDebugRequest,
  project: ProjectSnapshot,
): Promise<DebugTrace> {
  const found = new EvidenceCollector();

  const build =
    request.buildId !== undefined
      ? await project.reader.getBuild?.(request.buildId)
      : await project.reader.getLatestBuild?.();

  if (build === undefined || build === null) {
    throw new DebugError(
      "nothing_to_trace",
      request.buildId === undefined
        ? "This project has no builds yet, so there is no diagnostic to trace. Run a Story Build first."
        : `${request.buildId} is not a build in this project.`,
    );
  }

  const diagnostic = build.diagnostics.find((d) => d.id === request.diagnosticId);
  if (diagnostic === undefined) {
    throw new DebugError(
      "target_not_found",
      `Build ${build.id} has no diagnostic ${request.diagnosticId}. It may have been resolved since.`,
    );
  }

  found.add({
    system: "compiler",
    statement: `${diagnostic.severity.toUpperCase()} ${diagnostic.ruleId}: ${diagnostic.message}`,
    detail: diagnostic.evidence,
    ...(diagnostic.sceneId !== undefined ? { sceneId: diagnostic.sceneId } : {}),
    ...(diagnostic.chapterId !== undefined ? { chapterId: diagnostic.chapterId } : {}),
    entities: diagnostic.entities,
  });
  if (diagnostic.suggestedAction !== undefined) {
    found.add({
      system: "compiler",
      statement: `The build's suggested action: ${diagnostic.suggestedAction}`,
      detail: "A suggestion from the rule that found it. Nothing has applied it.",
      entities: diagnostic.entities,
    });
  }

  const limit =
    diagnostic.sceneId === undefined
      ? project.ordered.length
      : project.positionOf(diagnostic.sceneId);

  // ── Walk each entity back through the system that owns it ─────────────────

  for (const entityId of diagnostic.entities) {
    if (entityId.startsWith("OBJECT_")) traceObject(entityId, diagnostic.sceneId, project, found);
    else if (entityId.startsWith("CHAR_")) traceCharacter(entityId, limit, project, found);
    else if (entityId.startsWith("FACT_")) traceFact(entityId, project, found);
    else if (entityId.startsWith("THREAD_")) traceThread(entityId, project, found);
    else if (entityId.startsWith("REL_")) traceRelationship(entityId, project, found);
    else {
      found.add({
        system: "structure",
        statement: `${project.label(entityId)} (${entityId}) is named by the finding.`,
        detail: "No per-entity history is recorded for this kind.",
        entities: [entityId],
      });
    }
  }

  // ── The scene it landed in ────────────────────────────────────────────────

  if (diagnostic.sceneId !== undefined) {
    const scene = project.sceneById(diagnostic.sceneId);
    if (scene !== undefined) {
      found.add({
        system: "structure",
        statement: `It lands in ${diagnostic.sceneId} — "${scene.title}", ${String(limit + 1)} of ${String(project.ordered.length)} in story order.`,
        detail: scene.purpose.length > 0 ? scene.purpose.join("; ") : "no purpose recorded",
        sceneId: diagnostic.sceneId,
        entities: [diagnostic.sceneId],
      });
      const at = project.timeline.transitionsAtScene(diagnostic.sceneId);
      found.add({
        system: "story_state",
        statement: `${String(at.length)} state transition(s) are recorded in that scene.`,
        detail:
          at.length === 0
            ? "Nothing is recorded as changing there, which is often the cause rather than a detail."
            : at.map((t) => describeTransition(t)).join(" | "),
        sceneId: diagnostic.sceneId,
        entities: [...new Set(at.map((t) => t.subjectId))],
      });
    }
  }

  found.measure({
    label: "Other findings in the same build",
    value: build.diagnostics.length - 1,
    unit: "diagnostics",
    basis: `Build ${build.id} recorded ${String(build.diagnostics.length)} finding(s) in total.`,
    entities: [],
  });

  found.didNotInspect(
    "Whether the prose contradicts the record — the trace follows what is recorded, not what is written.",
  );

  return {
    mode: "continuity",
    problem: request.problem ?? diagnostic.message,
    scope: found.scope(
      `Diagnostic ${diagnostic.id} (${diagnostic.ruleId}) from build ${build.id}, and the recorded history of ${String(diagnostic.entities.length)} entity(ies) it names.`,
    ),
    evidence: found.evidence,
    measurements: found.measurements,
    excerpts: found.excerpts,
  };
}

function traceObject(
  objectId: string,
  sceneId: string | undefined,
  project: ProjectSnapshot,
  found: EvidenceCollector,
): void {
  const history = project.timeline.objectHistory(objectId);
  const transfers = project.timeline.objectTransfers(objectId);

  found.add({
    system: "story_state",
    statement: `${project.label(objectId)} has ${String(history.length)} recorded change(s).`,
    detail:
      history.length === 0
        ? "Nothing is recorded about where it is or who has it. Silence, not contradiction."
        : history.map((h) => `${h.sceneId}: ${h.kind} → ${h.to}`).join(" | "),
    entities: [objectId],
  });

  found.add({
    system: "story_state",
    statement: `${String(transfers.length)} transfer(s) explain its movement.`,
    detail:
      transfers.length === 0
        ? "No transfer is recorded, so nothing accounts for it changing hands or place."
        : transfers
            .map(
              (t) =>
                `${t.sceneId}: ${t.fromCharacterId ?? t.fromLocationId ?? "?"} → ${t.toCharacterId ?? t.toLocationId ?? "?"}`,
            )
            .join(" | "),
    entities: [objectId],
  });

  if (sceneId !== undefined) {
    const before = project.timeline.objectStateBeforeScene(objectId, sceneId);
    found.add({
      system: "story_state",
      statement: `Entering the scene, ${project.label(objectId)}: ${describeObjectState(before)}`,
      detail: "Reconstructed from the transitions in effect at that boundary.",
      sceneId,
      entities: [objectId],
    });

    // The gap itself: the last recorded position, and the silence after it.
    const last = history
      .filter((h) => project.positionOf(h.sceneId) < project.positionOf(sceneId))
      .at(-1);
    if (last !== undefined) {
      found.measure({
        label: `Scenes between the last recorded change to ${project.label(objectId)} and the finding`,
        value: project.positionOf(sceneId) - project.positionOf(last.sceneId),
        unit: "scenes",
        basis: `Last change in ${last.sceneId} (${last.kind}); finding in ${sceneId}.`,
        entities: [objectId, last.sceneId, sceneId],
      });
    }
  }
}

function traceCharacter(
  characterId: string,
  limit: number,
  project: ProjectSnapshot,
  found: EvidenceCollector,
): void {
  const upTo = project.ordered.slice(0, Math.max(0, limit) + 1);
  const steps = upTo
    .flatMap((scene) => project.timeline.transitionsAtScene(scene.id as string))
    .filter(
      (t) =>
        t.subjectId === characterId &&
        (t.kind === "character_location" || t.kind === "character_status"),
    );

  found.add({
    system: "story_state",
    statement: `${project.label(characterId)} has ${String(steps.length)} recorded position/status change(s) up to the finding.`,
    detail:
      steps.length === 0
        ? "Nothing places them anywhere, so anything asserting where they are rests on nothing."
        : steps.map((t) => `${t.sceneId}: ${t.kind} → ${project.label(t.value)}`).join(" | "),
    entities: [characterId],
  });
}

function traceFact(factId: string, project: ProjectSnapshot, found: EvidenceCollector): void {
  const steps = project.timeline.factKnowledgeTimeline(factId);
  found.add({
    system: "knowledge",
    statement: `"${project.label(factId)}" has ${String(steps.length)} recorded acquisition(s).`,
    detail:
      steps.length === 0
        ? "Nobody is recorded as ever holding it."
        : steps
            .map(
              (s) => `${s.sceneId}: ${project.label(s.characterId)} ${s.state} (${s.sourceType})`,
            )
            .join(" | "),
    entities: [factId],
  });
}

function traceThread(threadId: string, project: ProjectSnapshot, found: EvidenceCollector): void {
  const appearances = project.timeline.threadAppearances(threadId);
  found.add({
    system: "plot_threads",
    statement: `${project.label(threadId)} appears in ${String(appearances.length)} scene(s).`,
    detail:
      appearances.length === 0 ? "No scene is recorded as touching it." : appearances.join(" → "),
    entities: [threadId],
  });
}

function traceRelationship(
  relationshipId: string,
  project: ProjectSnapshot,
  found: EvidenceCollector,
): void {
  const history = project.timeline.relationshipHistory(relationshipId);
  found.add({
    system: "relationships",
    statement: `${project.label(relationshipId)} has ${String(history.length)} recorded change(s).`,
    detail:
      history.length === 0
        ? "It is whatever it was declared to be; nothing moves it."
        : history.map((c) => `${c.sceneId}: ${c.kind} ${c.label} → ${c.to}`).join(" | "),
    entities: [relationshipId],
  });
}
