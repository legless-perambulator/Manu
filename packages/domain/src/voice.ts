/**
 * The Author Voice system: a persistent, inspectable model of how a writer
 * writes.
 *
 * The point is that it is **structured**, not a paragraph of instructions
 * bolted onto every prompt. A dialogue edit does not need the writer's
 * preferences about landscape description, and shipping all of it every time
 * both wastes budget and dilutes the parts that matter. Every item is filed
 * under a category and a scope so the Context Compiler can retrieve exactly the
 * relevant slice (docs/AUTHOR_VOICE.md).
 */

export const VOICE_CATEGORIES = [
  "prose",
  "dialogue",
  "description",
  "pacing",
  "interiority",
  "figurative_language",
  "sentence_structure",
  "narrative_distance",
  "humour",
  "punctuation",
  "formatting",
] as const;

export type VoiceCategory = (typeof VOICE_CATEGORIES)[number];

/**
 * Where a preference applies. Narrower scopes win: a project may contradict a
 * writer's general habit, and a character's dialogue may contradict the
 * project.
 */
export const VOICE_SCOPES = ["global", "project", "pov", "character"] as const;
export type VoiceScope = (typeof VOICE_SCOPES)[number];

/** Lower binds looser; the highest-precedence scope wins a contradiction. */
export const SCOPE_PRECEDENCE: Readonly<Record<VoiceScope, number>> = Object.freeze({
  global: 0,
  project: 1,
  pov: 2,
  character: 3,
});

export type VoiceRuleId = string & { readonly __brand: "VoiceRuleId" };
export type VoiceTendencyId = string & { readonly __brand: "VoiceTendencyId" };
export type VoiceSampleId = string & { readonly __brand: "VoiceSampleId" };

/** A rule either asks for something or forbids it. Nothing else. */
export const RULE_KINDS = ["prefer", "avoid"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

/**
 * A rule the writer stated themselves. Never inferred, never auto-edited —
 * this is the writer's own voice about their voice.
 */
export interface VoiceRule {
  readonly id: VoiceRuleId;
  readonly kind: RuleKind;
  readonly category: VoiceCategory;
  readonly scope: VoiceScope;
  /** For pov/character scope: whose voice this is about. */
  readonly appliesToId?: string;
  /** The rule as the writer wrote it: "Avoid explaining dialogue subtext." */
  readonly statement: string;
  /**
   * An optional literal phrase or regular expression the rule can be checked
   * against mechanically. "Avoid 'couldn't help but'" is checkable; "prefer
   * physical observation before internal reflection" is not, and carries no
   * pattern. What can be checked is checked; the rest is a reading
   * (docs/STORY_COMPILER.md).
   */
  readonly pattern?: string;
  readonly enabled: boolean;
  readonly createdAt: string;
}

/**
 * How a sample of prose relates to the writer's intended voice.
 *
 * **Never assume imported prose is what the writer wants.** A manuscript
 * contains first drafts, placeholder scenes and passages the writer already
 * dislikes. Only stances the writer chose deliberately count as evidence of
 * desired style; `unassessed` is the default and contributes nothing.
 */
export const SAMPLE_STANCES = [
  "unassessed",
  "representative",
  "favourite",
  "approved_ai",
  "rejected_ai",
  "correction",
  "exercise",
  "not_representative",
] as const;
export type SampleStance = (typeof SAMPLE_STANCES)[number];

/** Stances that are evidence of what the writer *wants*. */
export const POSITIVE_STANCES: readonly SampleStance[] = [
  "representative",
  "favourite",
  "approved_ai",
  "correction",
  "exercise",
];

/** Stances that are evidence of what the writer does *not* want. */
export const NEGATIVE_STANCES: readonly SampleStance[] = ["rejected_ai", "not_representative"];

export function isPositiveEvidence(stance: SampleStance): boolean {
  return POSITIVE_STANCES.includes(stance);
}
export function isNegativeEvidence(stance: SampleStance): boolean {
  return NEGATIVE_STANCES.includes(stance);
}
/** `unassessed` is neither: silence about a passage is not an opinion of it. */
export function isEvidence(stance: SampleStance): boolean {
  return isPositiveEvidence(stance) || isNegativeEvidence(stance);
}

export interface VoiceSample {
  readonly id: VoiceSampleId;
  readonly stance: SampleStance;
  readonly text: string;
  readonly category?: VoiceCategory;
  readonly scope: VoiceScope;
  readonly appliesToId?: string;
  /** Where it came from: a manuscript path, a proposal id, or the writer. */
  readonly source?: string;
  /** For a correction: what the model wrote before the writer fixed it. */
  readonly replacedText?: string;
  /** For a rejection: why, when the writer said. */
  readonly note?: string;
  readonly createdAt: string;
}

export const TENDENCY_STATUSES = ["proposed", "confirmed", "rejected"] as const;
export type TendencyStatus = (typeof TENDENCY_STATUSES)[number];

/**
 * Something a model noticed about the writer's prose.
 *
 * Always labelled INFERRED, always carrying the evidence it rests on, and never
 * used as if the writer had said it until they confirm it. A tendency the
 * writer has not looked at is a proposal, not a preference.
 */
export interface VoiceTendency {
  readonly id: VoiceTendencyId;
  readonly category: VoiceCategory;
  readonly scope: VoiceScope;
  readonly appliesToId?: string;
  readonly statement: string;
  readonly status: TendencyStatus;
  /** The sample IDs this reading was drawn from. */
  readonly evidenceSampleIds: readonly VoiceSampleId[];
  /** A human-readable account: "27 selected representative passages." */
  readonly evidence: string;
  readonly modelId?: string;
  readonly createdAt: string;
  readonly reviewedAt?: string;
}

export interface AuthorVoiceProfile {
  readonly rules: readonly VoiceRule[];
  readonly tendencies: readonly VoiceTendency[];
  readonly samples: readonly VoiceSample[];
}

/**
 * The categories worth retrieving for a given kind of work.
 *
 * This is the whole reason the profile is categorised. Rewriting a line of
 * dialogue does not need the writer's feelings about figurative language, and
 * sending them anyway costs budget and buries the rules that apply.
 */
export const CATEGORIES_FOR_OPERATION: Readonly<Record<string, readonly VoiceCategory[]>> =
  Object.freeze({
    dialogue: ["dialogue", "punctuation", "narrative_distance", "humour", "prose"],
    description: ["description", "figurative_language", "sentence_structure", "prose"],
    interiority: ["interiority", "narrative_distance", "prose", "sentence_structure"],
    continue_scene: ["prose", "pacing", "sentence_structure", "narrative_distance", "dialogue"],
    rewrite_scene: ["prose", "pacing", "sentence_structure", "narrative_distance", "dialogue"],
    rewrite_selection: ["prose", "sentence_structure", "punctuation"],
  });

/** Everything, for the inspector and for operations with no narrower need. */
export function categoriesFor(operation?: string): readonly VoiceCategory[] {
  if (operation === undefined) return VOICE_CATEGORIES;
  return CATEGORIES_FOR_OPERATION[operation] ?? VOICE_CATEGORIES;
}

export function describeRule(rule: VoiceRule): string {
  return `${rule.kind === "avoid" ? "Avoid" : "Prefer"}: ${rule.statement}`;
}

/**
 * Order voice items for presentation to a model: the writer's own rules first,
 * then confirmed tendencies, and within each the narrowest scope last so it
 * reads as the final word.
 */
export function scopeRank(scope: VoiceScope): number {
  return SCOPE_PRECEDENCE[scope];
}
