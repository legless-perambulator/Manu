/**
 * Character voice: how each person in the book actually speaks.
 *
 * A character description says who someone is. It does not tell a model that
 * Elias answers in four words and never contracts, while Mara circles a
 * question for three sentences before refusing it. That difference is what
 * makes dialogue sound like two people, and it has to live in project data
 * rather than in a paragraph of prose nobody can check
 * (docs/CHARACTER_VOICE.md).
 */

/** Qualitative dimensions of a speaking voice. All optional, always. */
export const VOICE_ATTRIBUTES = [
  "formality",
  "vocabulary",
  "sentence_length",
  "directness",
  "contractions",
  "profanity",
  "humour",
  "regional_language",
  "interruptions",
  "filler_words",
  "metaphor_usage",
  "emotional_openness",
  "evasiveness",
] as const;

export type VoiceAttribute = (typeof VOICE_ATTRIBUTES)[number];

/**
 * An attribute's value is the writer's own words — "clipped, military",
 * "never swears except at his brother" — not a number on a scale. A voice is
 * not a slider, and forcing one would make the profile lie.
 */
export interface VoiceAttributeValue {
  readonly value: string;
  readonly note?: string;
}

export type VoiceAttributes = Partial<Record<VoiceAttribute, VoiceAttributeValue>>;

export type VoiceExampleId = string & { readonly __brand: "VoiceExampleId" };
export type VoiceShiftId = string & { readonly __brand: "VoiceShiftId" };

/**
 * A line the character actually says, kept with where it came from.
 *
 * The source matters: an example a writer cannot navigate back to is an
 * assertion, and six months later nobody remembers whether it was the voice
 * they wanted or a first draft they meant to fix.
 */
export interface CharacterVoiceExample {
  readonly id: VoiceExampleId;
  readonly characterId: string;
  readonly text: string;
  /** Where it is in the book. */
  readonly sceneId?: string;
  readonly chapterId?: string;
  readonly filePath?: string;
  /** Why this one was chosen, when the writer said. */
  readonly note?: string;
  /** Whether it still represents the voice, or is kept as a counter-example. */
  readonly representative: boolean;
  readonly createdAt: string;
}

/**
 * A point where the voice changes, anchored to a scene.
 *
 * **Voice is not assumed static.** A character who has lost a brother by
 * chapter 30 does not talk the way they did in chapter 2, and a system that
 * flags the change as an inconsistency is worse than no system. Shifts are
 * scene-anchored transitions, replayed to reconstruct the voice at any moment —
 * the same shape as everything else in Story State ([STORY_STATE.md]).
 */
export interface CharacterVoiceShift {
  readonly id: VoiceShiftId;
  readonly characterId: string;
  /** The scene from which this shift is in force. */
  readonly fromSceneId: string;
  readonly description: string;
  /** Attributes this shift changes; unmentioned ones carry forward. */
  readonly attributes: VoiceAttributes;
  readonly createdAt: string;
}

export interface CharacterVoiceProfile {
  readonly characterId: string;
  /** The baseline voice, before any shift. */
  readonly attributes: VoiceAttributes;
  /**
   * Words the writer counts as profanity for this project. Supplied by them,
   * never assumed: what counts is a matter of register and setting, and a
   * built-in list would be someone else's judgement applied to their book.
   */
  readonly profanityTerms?: readonly string[];
  /** Characteristic filler words, for the same reason. */
  readonly fillerTerms?: readonly string[];
  readonly notes?: string;
  readonly updatedAt: string;
}

/**
 * The voice as it stands at a given scene: the baseline with every shift
 * anchored at or before that scene applied in order.
 */
export function voiceAt(
  profile: CharacterVoiceProfile,
  shifts: readonly CharacterVoiceShift[],
  sceneOrder: readonly string[],
  sceneId?: string,
): { attributes: VoiceAttributes; applied: readonly CharacterVoiceShift[] } {
  const limit = sceneId === undefined ? sceneOrder.length : sceneOrder.indexOf(sceneId);
  const upTo = limit < 0 ? sceneOrder.length : limit;

  const applied = shifts
    .filter((shift) => {
      const at = sceneOrder.indexOf(shift.fromSceneId);
      return at >= 0 && at <= upTo;
    })
    .sort((a, b) => sceneOrder.indexOf(a.fromSceneId) - sceneOrder.indexOf(b.fromSceneId));

  let attributes: VoiceAttributes = { ...profile.attributes };
  for (const shift of applied) {
    attributes = { ...attributes, ...shift.attributes };
  }
  return { attributes, applied };
}

/** Attributes a writer has actually filled in. Nothing is invented for them. */
export function statedAttributes(attributes: VoiceAttributes): VoiceAttribute[] {
  return VOICE_ATTRIBUTES.filter((key) => attributes[key] !== undefined);
}

/**
 * How alike two voices are, as a band.
 *
 * Never a percentage. A percentage implies a measurement with a defined error,
 * and there is no such thing for "do these two people sound the same" — the
 * number would look scientific and mean nothing (docs/CHARACTER_VOICE.md).
 */
export const SIMILARITY_BANDS = ["low", "moderate", "high"] as const;
export type SimilarityBand = (typeof SIMILARITY_BANDS)[number];

export function describeBand(band: SimilarityBand): string {
  return band === "high"
    ? "High similarity"
    : band === "moderate"
      ? "Moderate similarity"
      : "Low similarity";
}
