import type { Fact, Scene } from "@jellytind/domain";
import { holdsAsTrue, isTransfer, requiresSourceKnowledge } from "./knowledge";
import type { StoryTimeline } from "./timeline";
import type { TimelineView } from "./types";

/**
 * Deterministic knowledge checks.
 *
 * The foundation for the Story Compiler's continuity work, exposed as a reusable
 * API rather than wired to any UI: given a timeline and the project's scenes,
 * report where the recorded information state contradicts itself. Every check
 * here is decidable from the data — no model is involved and none is needed
 * (docs/STORY_STATE.md; docs/STORY_COMPILER.md).
 */
export type ViolationKind =
  /** Someone passed on information they did not hold. */
  | "told_without_knowing"
  /** The teller was not in the scene where they supposedly told it. */
  | "source_not_present"
  /** The learner was not in the scene where they supposedly learned it. */
  | "learner_not_present"
  /** A character acquired knowledge of a true fact before it became true. */
  | "knowledge_before_fact"
  /** A scene puts a fact on the page that its POV character does not hold. */
  | "referenced_without_knowledge"
  /** Two transitions at one scene disagree about the same position. */
  | "contradictory_transitions";

export type ViolationSeverity = "error" | "warning";

export interface KnowledgeViolation {
  readonly kind: ViolationKind;
  readonly severity: ViolationSeverity;
  readonly sceneId: string;
  readonly characterId?: string;
  readonly factId: string;
  readonly message: string;
}

export interface CheckInput {
  readonly timeline: StoryTimeline;
  readonly scenes: readonly Scene[];
  readonly facts: ReadonlyMap<string, Fact>;
  readonly view?: TimelineView;
}

/**
 * Check the project's information state for contradictions.
 *
 * Findings are graded. An `error` is a statement the data cannot support — a
 * character telling someone a thing they had no position on. A `warning` is a
 * legitimate-but-notable pattern: a scene referencing a fact its POV does not
 * hold is often dramatic irony rather than a mistake, so it is reported without
 * being called wrong.
 */
export function checkKnowledgeViolations(input: CheckInput): KnowledgeViolation[] {
  const { timeline, scenes, facts } = input;
  const view = input.view ?? {};
  const bySceneId = new Map(scenes.map((scene) => [scene.id as string, scene]));
  const out: KnowledgeViolation[] = [];

  for (const sceneId of timeline.sceneOrder) {
    const scene = bySceneId.get(sceneId);
    const present = scene === undefined ? new Set<string>() : castOf(scene);
    const before = { sceneId, position: "before" } as const;
    const seen = new Map<string, string>();

    for (const step of timeline.transitionsAtScene(sceneId)) {
      if (step.kind !== "knowledge_changed") continue;
      if (step.confirmationStatus === "rejected") continue;
      if (step.confirmationStatus === "proposed" && view.include !== "with_proposed") continue;

      const learner = step.subjectId;
      const factId = step.value;
      const state = step.knowledgeState ?? "known";
      const sourceType = step.sourceType ?? "unknown";
      const from = step.sourceEntityId;

      // Two transitions at one scene claiming different positions.
      const key = `${learner}:${factId}`;
      const already = seen.get(key);
      if (already !== undefined && already !== state) {
        out.push({
          kind: "contradictory_transitions",
          severity: "error",
          sceneId,
          characterId: learner,
          factId,
          message: `${sceneId} records ${learner} as both "${already}" and "${state}" about ${factId}.`,
        });
      }
      seen.set(key, state);

      if (scene !== undefined && present.size > 0 && !present.has(learner)) {
        out.push({
          kind: "learner_not_present",
          severity: "warning",
          sceneId,
          characterId: learner,
          factId,
          message: `${learner} changes position on ${factId} in ${sceneId}, but is not among the scene's characters.`,
        });
      }

      // The transfer check: whoever passed this on in good faith must have held
      // it first. Deception is exempt — see `HONEST_TRANSFER_SOURCES`.
      if (isTransfer(sourceType) && from !== undefined && from.startsWith("CHAR_")) {
        const teller = timeline.knows(from, factId, before, view);
        if (
          requiresSourceKnowledge(sourceType) &&
          (teller === null || !holdsAsTrue(teller.state))
        ) {
          out.push({
            kind: "told_without_knowing",
            severity: "error",
            sceneId,
            characterId: from,
            factId,
            message:
              `${from} is recorded as the source of ${learner} learning ${factId} in ${sceneId}, ` +
              `but ${from} ${teller === null ? "has no position on it" : `only "${teller.state}" it`} entering that scene.`,
          });
        }
        if (scene !== undefined && present.size > 0 && !present.has(from)) {
          out.push({
            kind: "source_not_present",
            severity: "warning",
            sceneId,
            characterId: from,
            factId,
            message: `${from} is the source of ${factId} in ${sceneId}, but is not among the scene's characters.`,
          });
        }
      }

      // Learning a true fact before the story establishes it.
      const fact = facts.get(factId);
      if (holdsAsTrue(state) && fact !== undefined && fact.objectiveTruth) {
        const establishedBefore = timeline
          .establishedFactsAt({ sceneId, position: "after" }, view)
          .includes(factId);
        const everEstablished = timeline
          .establishedFactsAt(
            {
              sceneId: timeline.sceneOrder[timeline.sceneOrder.length - 1] ?? sceneId,
              position: "after",
            },
            view,
          )
          .includes(factId);
        if (everEstablished && !establishedBefore) {
          out.push({
            kind: "knowledge_before_fact",
            severity: "error",
            sceneId,
            characterId: learner,
            factId,
            message: `${learner} holds ${factId} in ${sceneId}, but the story does not establish it until later.`,
          });
        }
      }
    }

    // A scene that puts a fact on the page nobody in it holds.
    //
    // This used to test the POV character and nothing else, which made it
    // unreachable for the ordinary case: `pov` is optional and most scenes do
    // not set one, so a scene could reference a fact no character had ever
    // learned and the build stayed silent. That was the one planted defect the
    // audit's compiler probe did not catch (MANU-034).
    //
    // With a POV the POV is the test, because a fact on the page of a scene
    // told from inside someone's head is a fact that person is expected to
    // hold. Without one, the question is whether *anybody* present holds it —
    // reporting a fact nobody in the room knows, rather than picking a
    // character arbitrarily.
    if (scene !== undefined) {
      const povId = scene.pov === undefined ? null : (scene.pov as string);
      const cast = povId === null ? [...castOf(scene)] : [povId];
      // A scene with no cast at all is expository or off-page narration. Nobody
      // can hold anything, and saying so every time would be noise.
      if (cast.length > 0) {
        for (const factId of scene.factIds as readonly string[]) {
          const holder = cast.find((characterId) => {
            const after = timeline.knows(characterId, factId, { sceneId, position: "after" }, view);
            return after !== null && holdsAsTrue(after.state);
          });
          if (holder !== undefined) continue;

          out.push({
            kind: "referenced_without_knowledge",
            severity: "warning",
            sceneId,
            ...(povId === null ? {} : { characterId: povId }),
            factId,
            message:
              povId === null
                ? `${sceneId} references ${factId}, but none of its characters (${cast.join(", ")}) ` +
                  `hold it even by the end of the scene. Intentional dramatic irony, or a continuity slip?`
                : `${sceneId} references ${factId}, but its POV character ${povId} does not hold it ` +
                  `even by the end of the scene. Intentional dramatic irony, or a continuity slip?`,
          });
        }
      }
    }
  }

  return out;
}

function castOf(scene: Scene): Set<string> {
  return new Set([
    ...(scene.pov === undefined ? [] : [scene.pov as string]),
    ...(scene.characterIds as readonly string[]),
  ]);
}
