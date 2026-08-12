import type { Scene, Setup } from "@jellytind/domain";
import { describeDormancy } from "@jellytind/story-state";
import { EvidenceCollector } from "./evidence";
import { excerpt, precedingScenes, type ProjectSnapshot } from "./project";
import { DebugError, type DebugTrace, type RevealDebugRequest } from "./types";

const DEFAULT_LOOK_BACK = 12;

/**
 * Reveal debugging: _why doesn't Marcus's betrayal land?_
 *
 * A reveal is a contract with the reader. It works when the ground was prepared
 * and the reader could not get there early; it fails when the preparation is
 * missing, or when it was so heavy the reader arrived first. Both failures are
 * visible in recorded data — setups, thread lifecycle, knowledge transitions,
 * relationship history — provided nothing pretends to *judge* what it can only
 * *measure* (docs/STORY_DEBUGGER.md).
 *
 * So this trace answers: where is the reveal, what was planted for it, when did
 * the signals start, how far apart are they, and what does the manuscript hold
 * at each of those points. Whether nine scenes is too many is the writer's call,
 * informed — never replaced — by the model's reading.
 */
export async function traceReveal(
  request: RevealDebugRequest,
  project: ProjectSnapshot,
): Promise<DebugTrace> {
  const found = new EvidenceCollector();
  const setups = await project.reader.listSetups();

  const revealSceneId = resolveRevealScene(request, project, setups);
  const reveal = project.sceneById(revealSceneId);
  if (reveal === undefined) {
    throw new DebugError(
      "target_not_found",
      `${revealSceneId} is not a scene in this project, so there is no reveal to trace.`,
    );
  }

  const revealAt = project.positionOf(revealSceneId);
  const chapter = project.chapterOf(revealSceneId);

  found.add({
    system: "structure",
    statement: `The reveal is ${revealSceneId} — "${reveal.title}".`,
    detail: [
      `status ${reveal.status}`,
      `${String(revealAt + 1)} of ${String(project.ordered.length)} in story order`,
      reveal.purpose.length > 0 ? `purpose: ${reveal.purpose.join("; ")}` : "no purpose recorded",
    ].join(" · "),
    sceneId: revealSceneId,
    ...(chapter !== undefined ? { chapterId: chapter.id as string } : {}),
    entities: [revealSceneId, ...reveal.characterIds.map(String)],
  });

  // ── What was planted ──────────────────────────────────────────────────────

  const relevant = setups.filter((setup) => servesReveal(setup, request, revealSceneId));
  for (const setup of relevant) {
    const plantedAt = setup.setupSceneIds
      .map((id) => project.positionOf(id as string))
      .filter((at) => at >= 0);
    const earliest = plantedAt.length === 0 ? undefined : Math.min(...plantedAt);
    const paid = setup.payoffSceneIds.length > 0;

    found.add({
      system: "setups",
      statement: `${setup.id}: "${setup.description}" — planted in ${setup.setupSceneIds.length} scene(s), ${paid ? "paid off" : "not yet paid off"}.`,
      detail: [
        `subtlety ${setup.subtlety}`,
        setup.intendedInterpretation !== undefined
          ? `meant to read as: ${setup.intendedInterpretation}`
          : null,
        earliest === undefined
          ? null
          : `first planted ${String(revealAt - earliest)} scene(s) before the reveal`,
        setup.abandoned === true ? "recorded as abandoned" : null,
      ]
        .filter((part): part is string => part !== null)
        .join(" · "),
      ...(setup.setupSceneIds[0] !== undefined
        ? { sceneId: setup.setupSceneIds[0] as string }
        : {}),
      entities: [setup.id as string, ...setup.setupSceneIds.map(String)],
    });
  }

  if (relevant.length === 0) {
    found.add({
      system: "setups",
      statement: "No setup is recorded as serving this reveal.",
      detail:
        "Either nothing was planted, or what was planted was never registered as a setup. The two look identical from here.",
      sceneId: revealSceneId,
      entities: [revealSceneId],
    });
  }

  // ── The promises the reader is still holding ──────────────────────────────

  const openBefore = setups.filter(
    (setup) =>
      setup.abandoned !== true &&
      setup.payoffSceneIds.length === 0 &&
      setup.setupSceneIds.some((id) => {
        const at = project.positionOf(id as string);
        return at >= 0 && at < revealAt;
      }),
  );
  if (openBefore.length > 0) {
    found.add({
      system: "setups",
      statement: `${String(openBefore.length)} promise(s) made before the reveal are still outstanding at it.`,
      detail: openBefore.map((s) => `${s.id as string}: ${s.description}`).join(" | "),
      sceneId: revealSceneId,
      entities: openBefore.map((s) => s.id as string),
    });
  }

  // ── The signals, and how far ahead they start ─────────────────────────────

  const lookBack = request.lookBack ?? DEFAULT_LOOK_BACK;
  const before = precedingScenes(project, revealSceneId, lookBack);
  found.note(before.map((s) => s.id as string));

  const subjectId = request.characterId;
  const signals: Scene[] = [];
  for (const scene of before) {
    const carriesCharacter =
      subjectId !== undefined &&
      (scene.characterIds.map(String).includes(subjectId) || (scene.pov as string) === subjectId);
    const carriesFact =
      request.factId !== undefined && scene.factIds.map(String).includes(request.factId);
    const carriesThread =
      request.threadId !== undefined && scene.plotThreadIds.map(String).includes(request.threadId);
    const carriesSetup = relevant.some((setup) =>
      setup.setupSceneIds.map(String).includes(scene.id as string),
    );
    if (carriesCharacter || carriesFact || carriesThread || carriesSetup) signals.push(scene);
  }

  for (const scene of signals) {
    const at = project.positionOf(scene.id as string);
    const chapterOf = project.chapterOf(scene.id as string);
    found.add({
      system: "structure",
      statement: `${scene.id as string} — "${scene.title}" carries the reveal's material, ${String(revealAt - at)} scene(s) before it.`,
      detail: scene.purpose.length > 0 ? scene.purpose.join("; ") : "no purpose recorded",
      sceneId: scene.id as string,
      ...(chapterOf !== undefined ? { chapterId: chapterOf.id as string } : {}),
      entities: [scene.id as string],
    });
  }

  if (signals.length > 0) {
    const first = signals[0] as Scene;
    const firstAt = project.positionOf(first.id as string);
    const chapterSpan = new Set(
      [first, ...signals, reveal]
        .map((s) => project.chapterOf(s.id as string)?.id as string | undefined)
        .filter((id): id is string => id !== undefined),
    ).size;

    found.measure({
      label: "Scenes between the first signal and the reveal",
      value: revealAt - firstAt,
      unit: "scenes",
      basis: `First signal ${first.id as string}; reveal ${revealSceneId}; measured in story order across the ${String(lookBack)} scenes inspected.`,
      entities: [first.id as string, revealSceneId],
    });
    found.measure({
      label: "Chapters the signals span, including the reveal",
      value: chapterSpan,
      unit: "chapters",
      basis: "Distinct chapters containing a signal scene or the reveal.",
      entities: [revealSceneId],
    });
    found.measure({
      label: "Scenes carrying the reveal's material before it",
      value: signals.length,
      unit: "scenes",
      basis: `Scenes among the ${String(lookBack)} preceding that name the character, fact, thread or a serving setup.`,
      entities: [revealSceneId],
    });
  }

  // ── Who already knew ──────────────────────────────────────────────────────

  if (request.factId !== undefined) {
    const steps = project.timeline.factKnowledgeTimeline(request.factId);
    for (const step of steps) {
      const at = project.positionOf(step.sceneId);
      found.add({
        system: "knowledge",
        statement: `${project.label(step.characterId)} ${step.state} ${project.label(request.factId)} from ${step.sceneId}${at >= 0 && at < revealAt ? ", before the reveal" : ""}.`,
        detail: `source: ${step.sourceType}${step.sourceEntityId === undefined ? "" : ` (${project.label(step.sourceEntityId)})`}`,
        sceneId: step.sceneId,
        entities: [step.characterId, request.factId],
      });
    }
    if (steps.length === 0) {
      found.add({
        system: "knowledge",
        statement: `Nobody is recorded as ever learning ${project.label(request.factId)}.`,
        detail: "No knowledge transition names this proposition.",
        entities: [request.factId],
      });
    }
  }

  // ── The thread's life ─────────────────────────────────────────────────────

  const threadIds =
    request.threadId !== undefined
      ? [request.threadId]
      : reveal.plotThreadIds.map((id) => id as string);

  const threads = await project.reader.listPlotThreads();
  for (const threadId of threadIds) {
    const identity = threads.find((t) => (t.id as string) === threadId);
    if (identity === undefined) continue;
    const history = project.timeline.threadHistory(threadId, identity.status);
    const state = project.timeline.threadStateAt(
      { id: threadId, name: identity.name, status: identity.status },
      { sceneId: revealSceneId, position: "after" },
    );
    found.add({
      system: "plot_threads",
      statement: `Thread ${identity.name} is ${state.status} after the reveal, with ${String(history.length)} recorded step(s).`,
      detail:
        history.length === 0
          ? "No scene is recorded as touching it."
          : history
              .map((step) => `${step.sceneId}: ${step.interaction ?? step.status}`)
              .join(" → "),
      sceneId: revealSceneId,
      entities: [threadId],
    });

    const dormancy = project.timeline.threadDormancy(threadId, {
      sceneId: revealSceneId,
      position: "before",
    });
    found.add({
      system: "plot_threads",
      statement: `Entering the reveal, ${identity.name}: ${describeDormancy(dormancy)}`,
      detail: "Measured, not graded — how long a quiet stretch may run is the writer's call.",
      sceneId: revealSceneId,
      entities: [threadId],
    });
  }

  // ── The relationship the reveal breaks ────────────────────────────────────

  if (subjectId !== undefined) {
    const relationships = await project.reader.listRelationships();
    const involving = relationships.filter(
      (rel) =>
        (rel.characterAId as string) === subjectId || (rel.characterBId as string) === subjectId,
    );
    for (const rel of involving) {
      const at = project.timeline.relationshipBeforeScene(
        {
          id: rel.id as string,
          characterAId: rel.characterAId as string,
          characterBId: rel.characterBId as string,
          type: rel.type,
          ...(rel.status !== undefined ? { status: rel.status } : {}),
        },
        revealSceneId,
      );
      const history = project.timeline.relationshipHistory(rel.id as string);
      found.add({
        system: "relationships",
        statement: `${project.label(rel.characterAId as string)} and ${project.label(rel.characterBId as string)} are "${at.type}"${at.status === "" ? "" : ` (${at.status})`} entering the reveal.`,
        detail:
          history.length === 0
            ? "No recorded change: the relationship is whatever it was declared to be."
            : `${String(history.length)} recorded change(s): ${history.map((c) => `${c.sceneId} ${c.kind} ${c.label} → ${c.to}`).join(" | ")}`,
        sceneId: revealSceneId,
        entities: [rel.id as string, rel.characterAId as string, rel.characterBId as string],
      });
    }
  }

  // ── The prose, for the reveal and the nearest signals ─────────────────────

  await addExcerpt(project, found, reveal, "The reveal");
  for (const scene of signals.slice(-2)) {
    await addExcerpt(project, found, scene, "Signal");
  }

  if (subjectId === undefined) {
    found.didNotInspect(
      "Whose reveal this is was not given, so no character's signals or relationships were traced.",
    );
  }
  if (request.factId === undefined) {
    found.didNotInspect(
      "The revealed proposition was not given, so who already knew it was not traced.",
    );
  }
  found.didNotInspect(
    "What the prose implies to a first-time reader — no reader simulation exists yet (docs/SIMULATIONS.md).",
  );

  return {
    mode: "reveal",
    problem: request.problem,
    scope: found.scope(
      `Reveal ${revealSceneId} and the ${String(before.length)} scene(s) before it.`,
    ),
    evidence: found.evidence,
    measurements: found.measurements,
    excerpts: found.excerpts,
  };
}

/** Where the reveal happens: given, or the payoff of a setup that serves it. */
function resolveRevealScene(
  request: RevealDebugRequest,
  project: ProjectSnapshot,
  setups: readonly Setup[],
): string {
  if (request.revealSceneId !== undefined) return request.revealSceneId;

  const serving = setups.filter((setup) => servesReveal(setup, request, undefined));
  const payoffs = serving
    .flatMap((setup) => setup.payoffSceneIds.map((id) => id as string))
    .filter((id) => project.positionOf(id) >= 0);
  if (payoffs.length > 0) {
    return payoffs.reduce((latest, id) =>
      project.positionOf(id) > project.positionOf(latest) ? id : latest,
    );
  }

  if (request.threadId !== undefined) {
    const appearances = project.timeline.threadAppearances(request.threadId);
    const last = appearances.at(-1);
    if (last !== undefined) return last;
  }

  if (request.factId !== undefined) {
    const first = project.timeline.factKnowledgeTimeline(request.factId)[0];
    if (first !== undefined) return first.sceneId;
  }

  throw new DebugError(
    "nothing_to_trace",
    "Nothing identifies the reveal: name the scene, or a thread, fact or setup that leads to it.",
  );
}

function servesReveal(
  setup: Setup,
  request: RevealDebugRequest,
  revealSceneId: string | undefined,
): boolean {
  if (request.threadId !== undefined && (setup.targetThreadId as string) === request.threadId) {
    return true;
  }
  if (request.factId !== undefined && (setup.targetRevealId as string) === request.factId) {
    return true;
  }
  return revealSceneId !== undefined && setup.payoffSceneIds.map(String).includes(revealSceneId);
}

export async function addExcerpt(
  project: ProjectSnapshot,
  found: EvidenceCollector,
  scene: Scene,
  label: string,
): Promise<void> {
  const chapter = project.chapterOf(scene.id as string);
  if (chapter === undefined) return;
  const text = await project.reader.readProjectFile(chapter.filePath);
  if (text === null || text.trim() === "") return;
  // The prose lives in the chapter file, so this is the chapter's opening, not
  // the scene's alone. Say so: a model told it has one scene's words will
  // reason about the rest as though they were that scene's.
  found.excerpt({
    sceneId: scene.id as string,
    chapterId: chapter.id as string,
    label: `${label} — ${scene.title}, from the opening of chapter "${chapter.title}"`,
    text: excerpt(text),
  });
}
