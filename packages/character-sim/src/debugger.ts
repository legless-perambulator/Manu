import type { BehaviourTest } from "@jellytind/domain";
import { renderSnapshot, type CharacterSnapshot } from "./snapshot";

/**
 * The Character Simulator, as Story Debugger evidence.
 *
 * _Mara's decision to enter the house feels forced_ is a `character_motivation`
 * debug; _would Mara enter the house alone here?_ is a behaviour test. They are
 * the same question asked from two directions, over the same reconstructed
 * state, so the simulator hands its findings back in the debugger's own
 * evidence shape rather than growing a second display for them
 * (docs/STORY_DEBUGGER.md).
 *
 * The shape is declared structurally rather than imported: the debugger sits
 * below this package and does not know it exists.
 */
export interface EvidenceLike {
  readonly id: string;
  readonly system: string;
  readonly statement: string;
  readonly detail?: string;
  readonly sceneId?: string;
  readonly entities: readonly string[];
}

/**
 * A behaviour test rendered as evidence a diagnosis can cite.
 *
 * Deterministic findings only. The model's judgement is *not* included: a
 * diagnosis citing another model's reading as evidence would be citing itself,
 * and the debugger's whole contract is that claims rest on what the project
 * records (docs/STORY_DEBUGGER.md).
 */
export function behaviourEvidence(test: BehaviourTest, startAt = 1): EvidenceLike[] {
  const out: EvidenceLike[] = [];
  let index = startAt;
  const next = () => `E${String(index++)}`;

  for (const contradiction of test.contradictions) {
    if (contradiction.derivation !== "deterministic") continue;
    out.push({
      id: next(),
      system: "character_simulation",
      statement: contradiction.statement,
      ...(contradiction.detail === undefined ? {} : { detail: contradiction.detail }),
      sceneId: test.sceneId,
      entities: [...(contradiction.entities ?? [test.characterId])],
    });
  }

  for (const factor of test.established) {
    if (factor.derivation !== "deterministic") continue;
    out.push({
      id: next(),
      system: "character_simulation",
      statement: factor.statement,
      detail: `${factor.source}${factor.detail === undefined ? "" : ` — ${factor.detail}`}`,
      sceneId: test.sceneId,
      entities: [...(factor.entities ?? [test.characterId])],
    });
  }

  for (const gap of test.notChecked) {
    out.push({
      id: next(),
      system: "character_simulation",
      statement: `Not checked: ${gap}`,
      sceneId: test.sceneId,
      entities: [test.characterId],
    });
  }

  return out;
}

/**
 * The compiled character, for a motivation debug's diagnosis to read.
 *
 * Same briefing the simulator gives a model, so the two answers are made from
 * the same material and can be compared.
 */
export function motivationBriefing(snapshot: CharacterSnapshot): string {
  return renderSnapshot(snapshot);
}
