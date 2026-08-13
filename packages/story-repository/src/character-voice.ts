import type {
  CharacterVoiceExample,
  CharacterVoiceProfile,
  SimilarityBand,
  VoiceAttribute,
  VoiceAttributes,
} from "@jellytind/domain";
import { VOICE_ATTRIBUTES, statedAttributes } from "@jellytind/domain";

/**
 * Deterministic measurement of recorded dialogue.
 *
 * **These are measurements of the sample, not of the character.** If a writer
 * has recorded four lines for Elias, the contraction rate is the contraction
 * rate of those four lines and nothing more. Every result carries the number of
 * utterances it was drawn from so a reader can weigh it, and anything that
 * cannot be measured from what is here is reported as not measured rather than
 * defaulted to zero (docs/CHARACTER_VOICE.md).
 */

export interface VoiceMetrics {
  readonly utterances: number;
  readonly words: number;
  /** Mean words per utterance. */
  readonly meanLength: number;
  /** Share of utterances that are questions. */
  readonly questionRate: number;
  /** Contractions per hundred words. */
  readonly contractionRate: number;
  /** Ellipses and dashes per hundred words — hesitation and interruption. */
  readonly breakRate: number;
  /** Mean word length, a rough proxy for vocabulary register. */
  readonly meanWordLength: number;
  /** Filler terms per hundred words, when the writer named any. */
  readonly fillerRate: number | null;
  /** Profanity per hundred words, when the writer named any. */
  readonly profanityRate: number | null;
  /** What could not be measured, and why. */
  readonly notMeasured: readonly string[];
}

const CONTRACTION = /\b\w+['’](?:t|s|re|ve|ll|d|m)\b/giu;
const BREAKS = /(\.\.\.|…|—|--)/gu;

export function measureDialogue(
  lines: readonly string[],
  options?: { fillerTerms?: readonly string[]; profanityTerms?: readonly string[] },
): VoiceMetrics {
  const utterances = lines.filter((line) => line.trim() !== "");
  const joined = utterances.join(" ");
  const words = joined.split(/\s+/u).filter((w) => w !== "");
  const wordCount = words.length;
  const notMeasured: string[] = [];

  const per100 = (n: number) => (wordCount === 0 ? 0 : (n / wordCount) * 100);

  const fillerTerms = options?.fillerTerms ?? [];
  const profanityTerms = options?.profanityTerms ?? [];
  if (fillerTerms.length === 0) {
    notMeasured.push("filler words — none named for this character");
  }
  if (profanityTerms.length === 0) {
    // Deliberately no built-in list: what counts as profanity is a matter of
    // register and setting, and shipping one would apply a stranger's judgement
    // to someone's novel.
    notMeasured.push("profanity — no terms named for this project");
  }

  return {
    utterances: utterances.length,
    words: wordCount,
    meanLength: utterances.length === 0 ? 0 : round(wordCount / utterances.length),
    questionRate:
      utterances.length === 0
        ? 0
        : round(utterances.filter((u) => u.trimEnd().endsWith("?")).length / utterances.length),
    contractionRate: round(per100((joined.match(CONTRACTION) ?? []).length)),
    breakRate: round(per100((joined.match(BREAKS) ?? []).length)),
    meanWordLength:
      wordCount === 0
        ? 0
        : round(words.reduce((sum, w) => sum + w.replace(/\W/gu, "").length, 0) / wordCount),
    fillerRate: fillerTerms.length === 0 ? null : round(per100(countTerms(joined, fillerTerms))),
    profanityRate:
      profanityTerms.length === 0 ? null : round(per100(countTerms(joined, profanityTerms))),
    notMeasured,
  };
}

function countTerms(text: string, terms: readonly string[]): number {
  let total = 0;
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    total += (
      text.match(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu")) ?? []
    ).length;
  }
  return total;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// ── Differentiation ─────────────────────────────────────────────────────────

export interface MetricComparison {
  readonly metric: string;
  readonly a: number | null;
  readonly b: number | null;
  readonly close: boolean;
}

export interface VoiceSimilarity {
  readonly aId: string;
  readonly bId: string;
  readonly band: SimilarityBand;
  /** Always present, always in these words. This is not a measurement. */
  readonly caveat: string;
  readonly sharedTendencies: readonly string[];
  readonly differences: readonly string[];
  readonly metrics: readonly MetricComparison[];
  /** How much dialogue each side was judged on. */
  readonly basis: string;
  readonly notMeasured: readonly string[];
}

/**
 * Below this many words a passage cannot support these statistics: a four-word
 * line has a mean word length, but it is noise, and reporting it as a departure
 * from the character's voice would be inventing a finding. Too small to measure
 * is said out loud rather than answered anyway.
 */
export const MIN_WORDS_FOR_CHECK = 12;

/** How close two rates must be to count as shared, per metric. */
const TOLERANCE: Readonly<Record<string, number>> = {
  meanLength: 3,
  questionRate: 0.15,
  contractionRate: 1.5,
  breakRate: 1.5,
  meanWordLength: 0.5,
  fillerRate: 1,
  profanityRate: 0.5,
};

/**
 * Compare two characters' recorded voices.
 *
 * Reports a **band**, never a percentage, and says out loud how much dialogue
 * it looked at. Two characters with three lines each will read as similar
 * whatever is true of them, and the caveat has to carry that.
 */
export function compareVoices(
  a: { profile: CharacterVoiceProfile; lines: readonly string[] },
  b: { profile: CharacterVoiceProfile; lines: readonly string[] },
): VoiceSimilarity {
  const ma = measureDialogue(a.lines, {
    ...(a.profile.fillerTerms !== undefined ? { fillerTerms: a.profile.fillerTerms } : {}),
    ...(a.profile.profanityTerms !== undefined ? { profanityTerms: a.profile.profanityTerms } : {}),
  });
  const mb = measureDialogue(b.lines, {
    ...(b.profile.fillerTerms !== undefined ? { fillerTerms: b.profile.fillerTerms } : {}),
    ...(b.profile.profanityTerms !== undefined ? { profanityTerms: b.profile.profanityTerms } : {}),
  });

  const metrics: MetricComparison[] = [];
  for (const key of Object.keys(TOLERANCE)) {
    const va = ma[key as keyof VoiceMetrics] as number | null;
    const vb = mb[key as keyof VoiceMetrics] as number | null;
    const comparable = typeof va === "number" && typeof vb === "number";
    metrics.push({
      metric: key,
      a: comparable ? va : null,
      b: comparable ? vb : null,
      close: comparable && Math.abs(va - vb) <= (TOLERANCE[key] ?? 0),
    });
  }

  const comparable = metrics.filter((m) => m.a !== null);
  const closeCount = comparable.filter((m) => m.close).length;
  const ratio = comparable.length === 0 ? 0 : closeCount / comparable.length;
  const band: SimilarityBand = ratio >= 0.75 ? "high" : ratio >= 0.45 ? "moderate" : "low";

  const shared: string[] = [];
  const differences: string[] = [];
  for (const m of comparable) {
    const label = HUMAN[m.metric] ?? m.metric;
    if (m.close) shared.push(`similar ${label}`);
    else differences.push(`${label}: ${String(m.a)} vs ${String(m.b)}`);
  }

  // What the writer stated, as opposed to what the lines happen to show.
  for (const key of VOICE_ATTRIBUTES) {
    const av = a.profile.attributes[key];
    const bv = b.profile.attributes[key];
    if (av === undefined || bv === undefined) continue;
    if (av.value.trim().toLowerCase() === bv.value.trim().toLowerCase()) {
      shared.push(`both described as "${av.value}" for ${key.replace(/_/g, " ")}`);
    }
  }

  const thin = ma.utterances < 5 || mb.utterances < 5;
  return {
    aId: a.profile.characterId,
    bId: b.profile.characterId,
    band,
    caveat:
      "Heuristic, from the dialogue recorded for each character. Not a measurement of the characters themselves." +
      (thin ? " Based on very few lines — treat with caution." : ""),
    sharedTendencies: shared,
    differences,
    metrics,
    basis: `${String(ma.utterances)} recorded line(s) for ${a.profile.characterId}, ${String(mb.utterances)} for ${b.profile.characterId}.`,
    notMeasured: [...new Set([...ma.notMeasured, ...mb.notMeasured])],
  };
}

const HUMAN: Readonly<Record<string, string>> = {
  meanLength: "utterance length",
  questionRate: "question frequency",
  contractionRate: "contraction use",
  breakRate: "hesitation and interruption",
  meanWordLength: "word length",
  fillerRate: "filler-word use",
  profanityRate: "profanity frequency",
};

// ── Voice check ─────────────────────────────────────────────────────────────

export interface VoiceCheckFinding {
  readonly metric: string;
  readonly passage: number;
  readonly established: number;
  readonly note: string;
}

export interface CharacterVoiceCheck {
  readonly characterId: string;
  readonly findings: readonly VoiceCheckFinding[];
  readonly established: VoiceMetrics;
  readonly passage: VoiceMetrics;
  readonly statedAttributes: readonly VoiceAttribute[];
  readonly basis: string;
  readonly notMeasured: readonly string[];
}

/**
 * Check a passage of dialogue against what the character's recorded lines do.
 *
 * This does not say the passage is wrong. It says where it departs from the
 * established sample, which is a fact about two sets of numbers; whether the
 * departure is a mistake or a character having a bad night is the writer's call
 * — and if voice shifts are recorded, the caller should measure against the
 * voice at that point in the book rather than the baseline.
 */
export function checkCharacterVoice(
  profile: CharacterVoiceProfile,
  establishedLines: readonly string[],
  passageLines: readonly string[],
  attributes: VoiceAttributes,
): CharacterVoiceCheck {
  const options = {
    ...(profile.fillerTerms !== undefined ? { fillerTerms: profile.fillerTerms } : {}),
    ...(profile.profanityTerms !== undefined ? { profanityTerms: profile.profanityTerms } : {}),
  };
  const established = measureDialogue(establishedLines, options);
  const passage = measureDialogue(passageLines, options);

  const findings: VoiceCheckFinding[] = [];
  const tooSmall: string[] = [];
  if (passage.words < MIN_WORDS_FOR_CHECK) {
    tooSmall.push(
      `the passage is ${String(passage.words)} word(s) — too short to compare rates against (needs ${String(MIN_WORDS_FOR_CHECK)})`,
    );
  }
  if (established.words < MIN_WORDS_FOR_CHECK) {
    tooSmall.push(
      `only ${String(established.words)} word(s) of dialogue are recorded for this character — too few to compare against`,
    );
  }

  if (tooSmall.length === 0 && established.utterances > 0 && passage.utterances > 0) {
    for (const [key, tolerance] of Object.entries(TOLERANCE)) {
      const e = established[key as keyof VoiceMetrics] as number | null;
      const p = passage[key as keyof VoiceMetrics] as number | null;
      if (typeof e !== "number" || typeof p !== "number") continue;
      if (Math.abs(e - p) <= tolerance) continue;
      findings.push({
        metric: HUMAN[key] ?? key,
        passage: p,
        established: e,
        note: `${HUMAN[key] ?? key} differs from the recorded lines (${String(p)} vs ${String(e)}).`,
      });
    }
  }

  return {
    characterId: profile.characterId,
    findings,
    established,
    passage,
    statedAttributes: statedAttributes(attributes),
    basis:
      established.utterances === 0
        ? "No dialogue recorded for this character yet, so nothing could be compared."
        : `Compared against ${String(established.utterances)} recorded line(s).`,
    notMeasured: [...new Set([...established.notMeasured, ...passage.notMeasured, ...tooSmall])],
  };
}

/** Pull the example texts a character has, newest first, capped. */
export function representativeLines(
  examples: readonly CharacterVoiceExample[],
  limit = 12,
): string[] {
  return examples
    .filter((e) => e.representative)
    .slice(-limit)
    .map((e) => e.text);
}
