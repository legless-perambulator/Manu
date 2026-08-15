import type {
  MappingConfidence,
  MappingEvidence,
  MappingProposal,
  MappingSourceChapter,
} from "./types";

/**
 * The deterministic extractors: everything mapping can learn by parsing,
 * before any model runs (§4, §5, §9–§13).
 *
 * These are heuristics and say so — every proposal carries qualitative
 * confidence and the evidence it stands on, and anything genuinely ambiguous
 * arrives as `needs_review` rather than as a quiet guess.
 */

const DIALOGUE_VERBS =
  "said|asked|replied|whispered|muttered|snapped|answered|called|shouted|murmured|added|agreed|admitted|insisted";

/** Words that look like names at sentence starts but almost never are. */
const NAME_STOPWORDS = new Set(
  (
    "The A An And But Or So Then There This That These Those It Its He She They We You I His Her Their My Your Our " +
    "When Where What Who Why How If Not No Yes Now Here After Before Behind Above Below Inside Outside Once Still " +
    "Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August " +
    "September October November December Chapter Part Prologue Epilogue Mr Mrs Ms Dr Miss At In On To From For By " +
    "As Of With Without Perhaps Maybe Something Someone Nothing Nobody Everything Everyone Even Every All Some Any " +
    "Only Just Suddenly Finally Later Soon Tonight Today Tomorrow Yesterday"
  ).split(" "),
);

const HONORIFIC =
  /^(?:Detective|Inspector|Sergeant|Captain|Professor|Doctor|Father|Sister|Aunt|Uncle|Lady|Lord|Mr|Mrs|Ms|Miss|Dr)\.?$/;

const PLACE_WORDS =
  "Manor|House|Hall|Station|Church|Inn|Wing|Library|Cellar|Garden|Bridge|Harbour|Harbor|Street|Road|Lane|Tower|Castle|Vault|Attic|Kitchen|Study|Office|Hotel|Village|Town|City|Forest|Wood|Woods|River|Cliff|Bay|Lighthouse";
const PLACE_TAIL = new RegExp(`\\b(?:${PLACE_WORDS})$`);

interface NameStats {
  name: string;
  mentions: number;
  midSentence: number;
  dialogue: number;
  chapters: Set<number>;
}

function evidence(
  chapters: readonly MappingSourceChapter[],
  chapterIndexes: Iterable<number>,
  quote?: string,
): MappingEvidence[] {
  const out: MappingEvidence[] = [];
  for (const index of chapterIndexes) {
    const chapter = chapters.find((held) => held.index === index);
    if (chapter !== undefined) {
      out.push({
        chapterIndex: index,
        chapterTitle: chapter.title,
        ...(quote !== undefined && out.length === 0 ? { quote } : {}),
      });
    }
    if (out.length >= 5) break; // Evidence is a sample, not a concordance.
  }
  return out;
}

/** Collect candidate person names with their signals, chapter by chapter. */
export function collectNameStats(
  chapters: readonly MappingSourceChapter[],
): Map<string, NameStats> {
  const stats = new Map<string, NameStats>();
  const note = (name: string, chapter: number, kind: "mention" | "mid" | "dialogue") => {
    const key = name.trim();
    if (key === "") return;
    const held = stats.get(key) ?? {
      name: key,
      mentions: 0,
      midSentence: 0,
      dialogue: 0,
      chapters: new Set<number>(),
    };
    held.mentions += 1;
    if (kind === "mid") held.midSentence += 1;
    if (kind === "dialogue") {
      held.dialogue += 1;
      held.midSentence += 1;
    }
    held.chapters.add(chapter);
    stats.set(key, held);
  };

  const namePattern =
    /\b((?:Detective|Inspector|Sergeant|Captain|Professor|Doctor|Father|Sister|Aunt|Uncle|Lady|Lord|Mr\.?|Mrs\.?|Ms\.?|Miss|Dr\.?)\s+[A-Z][a-z]+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
  const dialoguePattern = new RegExp(
    `(?:["”]\\s*(?:${DIALOGUE_VERBS})\\s+((?:[A-Z][a-z]+\\s)?[A-Z][a-z]+))|(?:\\b([A-Z][a-z]+(?:\\s[A-Z][a-z]+)?)\\s+(?:${DIALOGUE_VERBS})\\b)`,
    "g",
  );

  for (const chapter of chapters) {
    const text = chapter.text;
    let match: RegExpExecArray | null;
    namePattern.lastIndex = 0;
    while ((match = namePattern.exec(text)) !== null) {
      const raw = (match[1] as string).replace(/\s+/g, " ");
      const words = raw.split(" ");
      const first = words[0] as string;
      if (words.length === 1 && NAME_STOPWORDS.has(first)) continue;
      if (words.length === 2 && NAME_STOPWORDS.has(first) && !HONORIFIC.test(first)) {
        // "The Manor", "But Mara" — keep only the second word as a candidate.
        if (!NAME_STOPWORDS.has(words[1] as string)) {
          const before = text.slice(Math.max(0, match.index - 2), match.index);
          const mid = !/(^|[.!?]\s*)$/.test(before);
          note(words[1] as string, chapter.index, mid ? "mid" : "mention");
        }
        continue;
      }
      if (words.length === 2 && NAME_STOPWORDS.has(words[1] as string)) continue;
      const before = text.slice(Math.max(0, match.index - 2), match.index);
      const midSentence = !/(^|[.!?]["”]?\s*)$/.test(before) && match.index !== 0;
      note(raw, chapter.index, midSentence ? "mid" : "mention");
    }
    dialoguePattern.lastIndex = 0;
    while ((match = dialoguePattern.exec(text)) !== null) {
      const speaker = (match[1] ?? match[2] ?? "").replace(/\s+/g, " ").trim();
      const first = speaker.split(" ")[0] as string;
      if (speaker !== "" && (!NAME_STOPWORDS.has(first) || HONORIFIC.test(first))) {
        note(speaker, chapter.index, "dialogue");
      }
    }
  }
  return stats;
}

/** True when `short` reads as a shorter way of saying `full`. */
function isNameSubset(short: string, full: string): boolean {
  if (short === full) return false;
  const strip = (name: string) => name.replace(HONORIFIC_PREFIX, "").trim();
  const shortWords = new Set(strip(short).split(" "));
  const fullWords = new Set(strip(full).split(" "));
  if (shortWords.size >= fullWords.size) return false;
  for (const word of shortWords) if (!fullWords.has(word)) return false;
  return true;
}
const HONORIFIC_PREFIX =
  /^(?:Detective|Inspector|Sergeant|Captain|Professor|Doctor|Father|Sister|Aunt|Uncle|Lady|Lord|Mr\.?|Mrs\.?|Ms\.?|Miss|Dr\.?)\s+/;

export interface CharacterCandidate {
  readonly canonical: string;
  readonly aliases: readonly string[];
  readonly ambiguousAliases: ReadonlyArray<{ alias: string; candidates: readonly string[] }>;
  readonly mentions: number;
  readonly dialogue: number;
  readonly chapters: readonly number[];
}

/**
 * Character candidates with alias resolution (§9, §11): "Mara",
 * "Detective Ellison" and "Ellison" all resolve to "Mara Ellison" when the
 * evidence supports exactly one owner; a short name two characters could own
 * stays ambiguous and demands review rather than a guess.
 */
export function characterCandidates(
  chapters: readonly MappingSourceChapter[],
): CharacterCandidate[] {
  const stats = [...collectNameStats(chapters).values()].filter((held) => {
    const stripped = held.name.replace(HONORIFIC_PREFIX, "");
    // "West Wing" and "Blackthorn Manor" are places, not people.
    if (PLACE_TAIL.test(stripped)) return false;
    // A First Last bigram is a strong name signal wherever it sits in the
    // sentence; a lone capitalised word needs mid-sentence or dialogue proof.
    if (stripped.includes(" ")) return held.mentions >= 2;
    return held.midSentence >= 2 || held.dialogue >= 1;
  });

  const fullNames = stats.filter((held) => held.name.replace(HONORIFIC_PREFIX, "").includes(" "));
  const shortNames = stats.filter((held) => !held.name.replace(HONORIFIC_PREFIX, "").includes(" "));
  const honorificShort = stats.filter(
    (held) =>
      HONORIFIC_PREFIX.test(held.name) && !held.name.replace(HONORIFIC_PREFIX, "").includes(" "),
  );
  void honorificShort;

  const canonicals = new Map<
    string,
    { aliases: Set<string>; ambiguous: Map<string, string[]>; stats: NameStats[] }
  >();
  for (const full of fullNames) {
    canonicals.set(full.name, { aliases: new Set(), ambiguous: new Map(), stats: [full] });
  }

  const unmatched: NameStats[] = [];
  for (const short of shortNames) {
    const owners = fullNames.filter((full) => isNameSubset(short.name, full.name));
    if (owners.length === 1) {
      const owner = canonicals.get((owners[0] as NameStats).name);
      owner?.aliases.add(short.name);
      owner?.stats.push(short);
    } else if (owners.length > 1) {
      for (const owner of owners) {
        canonicals.get(owner.name)?.ambiguous.set(
          short.name,
          owners.map((held) => held.name),
        );
      }
    } else {
      unmatched.push(short);
    }
  }
  // A name with no longer form is its own character ("Elias").
  for (const short of unmatched) {
    canonicals.set(short.name, { aliases: new Set(), ambiguous: new Map(), stats: [short] });
  }

  return [...canonicals.entries()]
    .map(([canonical, group]) => {
      const chapterSet = new Set<number>();
      let mentions = 0;
      let dialogue = 0;
      for (const held of group.stats) {
        mentions += held.mentions;
        dialogue += held.dialogue;
        for (const chapter of held.chapters) chapterSet.add(chapter);
      }
      return {
        canonical,
        aliases: [...group.aliases],
        ambiguousAliases: [...group.ambiguous.entries()].map(([alias, candidates]) => ({
          alias,
          candidates,
        })),
        mentions,
        dialogue,
        chapters: [...chapterSet].sort((a, b) => a - b),
      };
    })
    .sort((a, b) => b.mentions - a.mentions);
}

function confidenceFor(candidate: CharacterCandidate): MappingConfidence {
  if (candidate.mentions >= 6 && candidate.chapters.length >= 2) return "high";
  if (candidate.mentions >= 3) return "medium";
  return "low";
}

export function characterProposals(chapters: readonly MappingSourceChapter[]): MappingProposal[] {
  const proposals: MappingProposal[] = [];
  for (const candidate of characterCandidates(chapters)) {
    const confidence = confidenceFor(candidate);
    proposals.push({
      id: `character:${candidate.canonical}`,
      category: "character",
      status: confidence === "low" ? "needs_review" : "proposed",
      confidence,
      origin: "deterministic",
      summary:
        `${candidate.canonical} — ${candidate.mentions} mentions across ` +
        `${candidate.chapters.length} chapter(s)` +
        (candidate.dialogue > 0 ? `, speaks ${candidate.dialogue} time(s)` : ""),
      evidence: evidence(chapters, candidate.chapters),
      payload: {
        name: candidate.canonical,
        aliases: candidate.aliases,
        mentions: candidate.mentions,
        dialogue: candidate.dialogue,
        chapters: candidate.chapters,
      },
    });
    for (const alias of candidate.aliases) {
      proposals.push({
        id: `alias:${alias}→${candidate.canonical}`,
        category: "alias",
        status: "proposed",
        confidence: "high",
        origin: "deterministic",
        summary: `"${alias}" is ${candidate.canonical}`,
        evidence: evidence(chapters, candidate.chapters),
        payload: { alias, canonical: candidate.canonical },
      });
    }
    for (const ambiguous of candidate.ambiguousAliases) {
      const id = `alias:${ambiguous.alias}?`;
      if (!proposals.some((held) => held.id === id)) {
        proposals.push({
          id,
          category: "alias",
          status: "needs_review",
          confidence: "low",
          origin: "deterministic",
          summary: `"${ambiguous.alias}" could be ${ambiguous.candidates.join(" or ")}`,
          evidence: evidence(chapters, candidate.chapters),
          payload: { alias: ambiguous.alias, candidates: ambiguous.candidates },
        });
      }
    }
  }
  return proposals;
}

/**
 * Story role, argued from signals rather than mention count alone (§10):
 * appearance span, dialogue volume and co-presence with other characters all
 * weigh in, the evidence says which, and nothing here is immutable.
 */
export function importanceProposals(
  chapters: readonly MappingSourceChapter[],
  characters: readonly CharacterCandidate[],
): MappingProposal[] {
  const total = chapters.length;
  const scored = characters.map((candidate) => {
    const span = candidate.chapters.length / Math.max(1, total);
    const centrality =
      characters.filter(
        (other) =>
          other !== candidate &&
          other.chapters.some((chapter) => candidate.chapters.includes(chapter)),
      ).length / Math.max(1, characters.length - 1);
    const score = span * 2 + Math.min(1, candidate.dialogue / 20) + centrality;
    return { candidate, span, centrality, score };
  });
  const top = [...scored].sort((a, b) => b.score - a.score)[0];

  return scored.map(({ candidate, span, centrality, score }) => {
    const role =
      top !== undefined && candidate === top.candidate && span >= 0.5
        ? "protagonist"
        : candidate.chapters.length === 1
          ? "single-scene"
          : span >= 0.5
            ? "major"
            : span >= 0.2 || candidate.dialogue >= 5
              ? "supporting"
              : candidate.chapters.length >= 3
                ? "recurring"
                : "minor";
    return {
      id: `importance:${candidate.canonical}`,
      category: "importance" as const,
      status: "proposed" as const,
      confidence: "medium" as const,
      origin: "deterministic" as const,
      summary: `${candidate.canonical}: ${role}`,
      evidence: evidence(chapters, candidate.chapters),
      payload: {
        name: candidate.canonical,
        role,
        signals: {
          appearances: candidate.chapters.length,
          span: Number(span.toFixed(2)),
          dialogue: candidate.dialogue,
          relationshipCentrality: Number(centrality.toFixed(2)),
          score: Number(score.toFixed(2)),
        },
        explanation:
          `Appears in ${candidate.chapters.length} of ${total} chapters, ` +
          `speaks ${candidate.dialogue} time(s), shares scenes with ` +
          `${Math.round(centrality * Math.max(1, characters.length - 1))} other character(s). ` +
          `Not merely mention count; reclassify freely.`,
      },
    };
  });
}

export function locationProposals(
  chapters: readonly MappingSourceChapter[],
  characterNames: ReadonlySet<string>,
): MappingProposal[] {
  const pattern = new RegExp(
    `\\b(?:at|in|to|into|inside|near|beneath|below|under|toward|towards|from|around)\\s+(?:the\\s+)?([A-Z][a-z]+(?:\\s+(?:[A-Z][a-z]+|${PLACE_WORDS}))*)\\b|\\bthe\\s+([A-Z][a-z]*(?:${PLACE_WORDS}))\\b`,
    "g",
  );
  const counts = new Map<string, { mentions: number; chapters: Set<number> }>();
  for (const chapter of chapters) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(chapter.text)) !== null) {
      const name = ((match[1] ?? match[2]) as string).replace(/\s+/g, " ").trim();
      if (characterNames.has(name)) continue;
      if (name.split(" ").every((word) => !new RegExp(`^(?:${PLACE_WORDS})$`).test(word))) {
        // Keep only phrases that read as places: contain a place word, or are
        // multi-word proper nouns seen with spatial prepositions repeatedly.
        if (name.split(" ").length < 2) continue;
      }
      const held = counts.get(name) ?? { mentions: 0, chapters: new Set<number>() };
      held.mentions += 1;
      held.chapters.add(chapter.index);
      counts.set(name, held);
    }
  }

  const kept = [...counts.entries()].filter(
    ([, held]) => held.mentions >= 3 || held.chapters.size >= 2,
  );

  const proposals: MappingProposal[] = kept.map(([name, held]) => ({
    id: `location:${name}`,
    category: "location",
    status: "proposed",
    confidence: held.chapters.size >= 2 ? "high" : "medium",
    origin: "deterministic",
    summary: `${name} — ${held.mentions} mentions across ${held.chapters.size} chapter(s)`,
    evidence: evidence(chapters, held.chapters),
    payload: { name, mentions: held.mentions },
  }));

  // Hierarchy only where the prose states it: "the Library at Blackthorn
  // Manor". Anything less explicit would be invented geography (§12).
  const names = kept.map(([name]) => name);
  for (const chapter of chapters) {
    for (const child of names) {
      for (const parent of names) {
        if (child === parent) continue;
        const stated = new RegExp(
          `\\b(?:the\\s+)?${child}\\s+(?:at|of|in)\\s+(?:the\\s+)?${parent}\\b`,
        );
        const id = `location-parent:${child}→${parent}`;
        if (stated.test(chapter.text) && !proposals.some((held) => held.id === id)) {
          proposals.push({
            id,
            category: "location",
            status: "needs_review",
            confidence: "medium",
            origin: "deterministic",
            summary: `${child} is inside ${parent}`,
            evidence: evidence(chapters, [chapter.index]),
            payload: { name: child, parent },
          });
        }
      }
    }
  }
  return proposals;
}

const OBJECT_STOPWORDS = new Set(
  (
    "door doors hand hands eyes face voice head room air way look breath moment word words thing things " +
    "table chair window floor wall stairs steps night morning day evening time house man woman men women " +
    "letter letters paper glass cup bottle coat pocket"
  ).split(" "),
);

export function objectProposals(chapters: readonly MappingSourceChapter[]): MappingProposal[] {
  const transfer =
    /\b(?:took|take|gave|give|held|hold|handed|hand|carried|carry|hid|hide|found|find|stole|steal|pocketed|clutched|passed|slipped|wrapped|examined|showed)\s+(?:the|his|her|their|a|an)\s+([a-z]+)\b/g;
  const counts = new Map<
    string,
    { mentions: number; transfers: number; chapters: Set<number>; quote?: string }
  >();
  for (const chapter of chapters) {
    let match: RegExpExecArray | null;
    transfer.lastIndex = 0;
    while ((match = transfer.exec(chapter.text)) !== null) {
      const noun = (match[1] as string).trim();
      const headNoun = noun.split(" ").pop() as string;
      if (OBJECT_STOPWORDS.has(headNoun) || OBJECT_STOPWORDS.has(noun)) continue;
      const held = counts.get(noun) ?? { mentions: 0, transfers: 0, chapters: new Set<number>() };
      held.transfers += 1;
      held.chapters.add(chapter.index);
      if (held.quote === undefined) {
        held.quote = chapter.text.slice(Math.max(0, match.index - 20), match.index + 60).trim();
      }
      counts.set(noun, held);
    }
    // Bare recurrence also counts toward meaning, transfer or not.
    for (const [noun, held] of counts) {
      const mentions = chapter.text.match(new RegExp(`\\b${noun}\\b`, "g"));
      if (mentions !== null) {
        held.mentions += mentions.length;
        if (mentions.length > 0) held.chapters.add(chapter.index);
      }
    }
  }

  // Not every cup and chair (§13): recurrence across chapters plus at least
  // one narrative use, and even then the writer reviews the list.
  return [...counts.entries()]
    .filter(([, held]) => held.transfers >= 2 && held.chapters.size >= 2)
    .map(([noun, held]) => ({
      id: `object:${noun}`,
      category: "object" as const,
      status: "needs_review" as const,
      confidence: (held.transfers >= 3 ? "medium" : "low") as MappingConfidence,
      origin: "deterministic" as const,
      summary: `the ${noun} — handled ${held.transfers} time(s) across ${held.chapters.size} chapter(s)`,
      evidence: evidence(chapters, held.chapters, held.quote),
      payload: { name: noun, transfers: held.transfers },
    }));
}

/** Explicit scene breaks (§5): the marks the manuscript itself makes. */
export function sceneProposals(chapters: readonly MappingSourceChapter[]): MappingProposal[] {
  const proposals: MappingProposal[] = [];
  for (const chapter of chapters) {
    const segments = chapter.text
      .split(/^\s*(?:\*\s*\*\s*\*[\s*]*|#\s*#\s*#|~{3,})\s*$/m)
      .map((segment) => segment.trim())
      .filter((segment) => segment !== "");
    if (segments.length > 1) {
      proposals.push({
        id: `scene:${chapter.chapterId}`,
        category: "scene",
        status: "proposed",
        confidence: "high",
        origin: "deterministic",
        summary: `${chapter.title}: ${segments.length} scenes marked by explicit breaks`,
        evidence: [{ chapterIndex: chapter.index, chapterTitle: chapter.title }],
        payload: {
          chapterId: chapter.chapterId,
          chapterIndex: chapter.index,
          segments: segments.map((segment, index) => ({
            title: `${chapter.title} — scene ${index + 1}`,
            opening: segment.slice(0, 80),
          })),
        },
      });
    }
  }
  return proposals;
}
