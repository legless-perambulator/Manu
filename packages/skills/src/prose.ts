/**
 * Reading prose deterministically.
 *
 * Everything here counts what is on the page. Nothing infers intent, and
 * anything that cannot be established — who said an untagged line — is left
 * unattributed rather than guessed, because a dialogue report built on guessed
 * speakers is worse than one that admits what it could not tell.
 */

/** Chapter frontmatter and scene markers are structure, not prose. */
export function proseOf(raw: string): string {
  return raw
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/^[ \t]*<!--[ \t]*scene:[^>]*-->[ \t]*$/gm, "")
    .trim();
}

export function countWords(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words === null ? 0 : words.length;
}

/** Sentences, split on terminal punctuation. Good enough to count, not to parse. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…])["'"”’]?\s+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function paragraphsOf(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

export interface DialogueLine {
  readonly text: string;
  /** The character who says it, when a tag names one. Absent when untagged. */
  readonly speakerId?: string;
  /** The paragraph it was found in, for the writer to navigate back to. */
  readonly paragraph: number;
  readonly chapterId?: string;
  readonly sceneId?: string;
}

const QUOTE_PATTERN = /[“"]([^“”"]{2,})[”"]/g;

/** Verbs that mark a line of speech as attributed to whoever is named beside it. */
const SPEECH_VERBS =
  "said|says|asked|asks|replied|replies|answered|answers|whispered|whispers|shouted|shouts|murmured|murmurs|added|adds|told|tells|muttered|mutters|snapped|snaps|called|calls";

/**
 * Pull the quoted speech out of a passage, attributing what can be attributed.
 *
 * Attribution is deliberately conservative: a speaker is recorded only when a
 * known character's name sits beside a speech verb in the same paragraph. Every
 * other line keeps its text and stays unattributed, and the count of those is
 * reported so nobody mistakes partial coverage for a full reading.
 */
export function extractDialogue(
  text: string,
  characters: ReadonlyArray<{ id: string; name: string }>,
  where: { chapterId?: string; sceneId?: string } = {},
): DialogueLine[] {
  const out: DialogueLine[] = [];
  const paragraphs = paragraphsOf(text);

  for (const [index, paragraph] of paragraphs.entries()) {
    QUOTE_PATTERN.lastIndex = 0;
    const quotes: string[] = [];
    for (let m = QUOTE_PATTERN.exec(paragraph); m !== null; m = QUOTE_PATTERN.exec(paragraph)) {
      const said = (m[1] ?? "").trim();
      if (said !== "") quotes.push(said);
    }
    if (quotes.length === 0) continue;

    const speakerId = attributeSpeaker(paragraph, characters);
    for (const quote of quotes) {
      out.push({
        text: quote,
        ...(speakerId === null ? {} : { speakerId }),
        paragraph: index,
        ...(where.chapterId === undefined ? {} : { chapterId: where.chapterId }),
        ...(where.sceneId === undefined ? {} : { sceneId: where.sceneId }),
      });
    }
  }
  return out;
}

function attributeSpeaker(
  paragraph: string,
  characters: ReadonlyArray<{ id: string; name: string }>,
): string | null {
  for (const character of characters) {
    const first = character.name.split(/\s+/)[0];
    if (first === undefined || first.length < 2) continue;
    const name = escapeRegExp(first);
    // "said Mara" or "Mara said" — a name alone in the paragraph is not
    // attribution: she may be the one being spoken to.
    const tagged = new RegExp(`\\b(?:${SPEECH_VERBS})\\b[^.!?]{0,20}\\b${name}\\b`, "i");
    const leading = new RegExp(`\\b${name}\\b[^.!?]{0,20}\\b(?:${SPEECH_VERBS})\\b`, "i");
    if (tagged.test(paragraph) || leading.test(paragraph)) return character.id;
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Phrasings a model reaches for far more often than a novelist does.
 *
 * Every entry is a **pattern with a name**, not a rule about good prose: the
 * report says "this appears eleven times", and whether that is a problem is the
 * writer's call. The list is short and specific on purpose — a long list of
 * ordinary English would flag the whole manuscript and teach a writer to ignore
 * it (docs/WRITING_SKILLS.md).
 */
export const TENDENCY_PATTERNS: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly pattern: RegExp;
}> = [
  { id: "a_testament_to", label: '"a testament to"', pattern: /\ba testament to\b/gi },
  {
    id: "not_only_but",
    label: '"not only … but also"',
    pattern: /\bnot only\b[^.!?]{0,60}\bbut\b/gi,
  },
  { id: "it_is_worth", label: '"it is worth noting"', pattern: /\bit(?:'s| is) worth noting\b/gi },
  { id: "in_the_realm", label: '"in the realm of"', pattern: /\bin the realm of\b/gi },
  { id: "began_to", label: '"began to" / "started to"', pattern: /\b(?:began|started) to\b/gi },
  {
    id: "couldnt_help",
    label: '"couldn\'t help but"',
    pattern: /\bcould(?:n't| not) help but\b/gi,
  },
  { id: "sense_of", label: '"a sense of …"', pattern: /\ba sense of\b/gi },
  { id: "palpable", label: '"palpable"', pattern: /\bpalpable\b/gi },
  { id: "delve", label: '"delve"', pattern: /\bdelve[ds]?\b/gi },
  { id: "tapestry", label: '"tapestry"', pattern: /\btapestry\b/gi },
  {
    id: "navigate_complexities",
    label: '"navigate the complexities"',
    pattern: /\bnavigat\w+ the complexit\w+\b/gi,
  },
  { id: "little_did", label: '"little did (they) know"', pattern: /\blittle did \w+ know\b/gi },
  { id: "eyes_narrowed", label: '"eyes narrowed"', pattern: /\beyes narrowed\b/gi },
  { id: "breath_hitched", label: '"breath hitched"', pattern: /\bbreath (?:hitched|caught)\b/gi },
  {
    id: "voice_barely",
    label: '"voice barely above a whisper"',
    pattern: /\bbarely above a whisper\b/gi,
  },
];

export interface PatternHit {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  /** One example with enough around it to find the line. */
  readonly example: string;
}

export function scanTendencies(text: string): PatternHit[] {
  const hits: PatternHit[] = [];
  for (const entry of TENDENCY_PATTERNS) {
    entry.pattern.lastIndex = 0;
    const matches = [...text.matchAll(entry.pattern)];
    if (matches.length === 0) continue;
    const first = matches[0];
    const at = first?.index ?? 0;
    hits.push({
      id: entry.id,
      label: entry.label,
      count: matches.length,
      example: text
        .slice(Math.max(0, at - 40), at + 60)
        .replace(/\s+/g, " ")
        .trim(),
    });
  }
  return hits.sort((a, b) => b.count - a.count);
}

/** How often sentences open with the same word — a rhythm measurement. */
export function repeatedSentenceOpenings(
  sentences: readonly string[],
  minimum = 4,
): Array<{ word: string; count: number }> {
  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    const word = sentence.match(/^[\p{L}']+/u)?.[0]?.toLowerCase();
    if (word === undefined || word.length < 3) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= minimum)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
