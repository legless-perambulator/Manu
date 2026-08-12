import { DEBUG_MODES, DebugError, type DebugMode, type DebugRequest } from "./types";

/**
 * `/debug betrayal Marcus`
 *
 * A writer says what is bothering them in their own words; the command turns
 * that into a structured request. The topic word chooses the mode and the
 * remaining words name the story things involved — resolved against the
 * project's own entities, because "Marcus" must mean `CHAR_0007` before
 * anything can be traced (docs/STORY_DEBUGGER.md).
 *
 * Natural language takes the other road: the agent reads the sentence and calls
 * `run_story_debug` with the same structured request. This parser exists so the
 * fast path does not need a model at all.
 */

/** Words a writer actually uses, mapped to the mode that investigates them. */
export const TOPIC_ALIASES: Readonly<Record<string, DebugMode>> = {
  reveal: "reveal",
  betrayal: "reveal",
  twist: "reveal",
  reversal: "reveal",
  surprise: "reveal",
  secret: "reveal",
  motivation: "character_motivation",
  motive: "character_motivation",
  decision: "character_motivation",
  choice: "character_motivation",
  behaviour: "character_motivation",
  behavior: "character_motivation",
  pacing: "pacing",
  pace: "pacing",
  rhythm: "pacing",
  length: "pacing",
  drag: "pacing",
  continuity: "continuity",
  diagnostic: "continuity",
  build: "continuity",
};

export interface EntitySummary {
  readonly id: string;
  readonly name: string;
}

export interface ParsedCommand {
  readonly request: DebugRequest;
  /** What each argument was taken to mean, for the writer to check. */
  readonly resolved: readonly string[];
  /** Arguments that matched nothing, kept visible rather than ignored. */
  readonly unresolved: readonly string[];
}

/**
 * Parse a `/debug` line against the project's entities.
 *
 * The whole line survives as the problem statement: a mode plus two IDs is not
 * what the writer said, and the model reading the report should see the words
 * they actually used.
 */
export function parseDebugCommand(line: string, entities: readonly EntitySummary[]): ParsedCommand {
  const trimmed = line
    .trim()
    .replace(/^\/debug\b/i, "")
    .trim();
  if (trimmed === "") {
    throw new DebugError(
      "bad_command",
      `Say what to investigate: /debug <topic> <who or what>. Topics: ${topicList()}.`,
    );
  }

  const words = trimmed.split(/\s+/);
  const topic = (words[0] as string).toLowerCase().replace(/[^a-z]/g, "");
  const mode = TOPIC_ALIASES[topic];
  if (mode === undefined) {
    throw new DebugError(
      "bad_command",
      `"${words[0] as string}" is not something this can investigate. Topics: ${topicList()}.`,
      { topic: words[0] },
    );
  }

  const rest = words.slice(1);
  const resolved: string[] = [];
  const unresolved: string[] = [];
  const hits: string[] = [];

  for (const word of rest) {
    // A diagnostic ID is a build fingerprint, not an entity, so it is carried
    // through as itself rather than reported as an unknown word.
    if (/^DIAG_[0-9a-f]+$/i.test(word)) {
      // Fingerprints are lowercase hex under an uppercase prefix.
      const id = `DIAG_${word.slice("DIAG_".length).toLowerCase()}`;
      hits.push(id);
      resolved.push(`${word} → build diagnostic ${id}`);
      continue;
    }
    const match = resolveEntity(word, entities);
    if (match === null) unresolved.push(word);
    else {
      hits.push(match.id);
      resolved.push(`${word} → ${match.name} (${match.id})`);
    }
  }

  return { request: build(mode, trimmed, hits), resolved, unresolved };
}

function build(mode: DebugMode, problem: string, hits: readonly string[]): DebugRequest {
  const pick = (prefix: string): string | undefined => hits.find((id) => id.startsWith(prefix));

  switch (mode) {
    case "reveal": {
      const scene = pick("SCENE_");
      const character = pick("CHAR_");
      const thread = pick("THREAD_");
      const fact = pick("FACT_");
      if (
        scene === undefined &&
        character === undefined &&
        thread === undefined &&
        fact === undefined
      ) {
        throw new DebugError(
          "bad_command",
          "Name whose reveal it is, or the scene, thread or fact it turns on — there is nothing to trace otherwise.",
        );
      }
      return {
        mode,
        problem,
        ...(scene !== undefined ? { revealSceneId: scene } : {}),
        ...(character !== undefined ? { characterId: character } : {}),
        ...(thread !== undefined ? { threadId: thread } : {}),
        ...(fact !== undefined ? { factId: fact } : {}),
      };
    }

    case "character_motivation": {
      const character = pick("CHAR_");
      const scene = pick("SCENE_");
      if (character === undefined || scene === undefined) {
        throw new DebugError(
          "bad_command",
          "Motivation debugging needs both a character and the scene the decision happens in.",
        );
      }
      return { mode, problem, characterId: character, sceneId: scene };
    }

    case "pacing": {
      const chapter = pick("CHAPTER_");
      return { mode, problem, ...(chapter !== undefined ? { chapterId: chapter } : {}) };
    }

    case "continuity": {
      // Diagnostic IDs are build fingerprints, not entity IDs, so they arrive
      // as an unresolved word rather than a match.
      const diagnosticId = hits.find((id) => id.startsWith("DIAG_"));
      if (diagnosticId === undefined) {
        throw new DebugError(
          "bad_command",
          "Continuity debugging starts from a build diagnostic. Open one in the Build panel and debug it from there.",
        );
      }
      return { mode, problem, diagnosticId };
    }
  }
}

/** Case-insensitive: an entity ID, an exact name, or a unique prefix. */
function resolveEntity(word: string, entities: readonly EntitySummary[]): EntitySummary | null {
  const upper = word.toUpperCase();
  const byId = entities.find((e) => e.id.toUpperCase() === upper);
  if (byId !== undefined) return byId;
  if (/^[A-Z]+_\d+$/.test(upper)) return null;

  const lower = word.toLowerCase();
  const exact = entities.filter((e) => e.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0] as EntitySummary;

  const partial = entities.filter((e) => e.name.toLowerCase().startsWith(lower));
  // A prefix that matches two characters names neither of them.
  return partial.length === 1 ? (partial[0] as EntitySummary) : null;
}

function topicList(): string {
  return DEBUG_MODES.map((mode) =>
    Object.entries(TOPIC_ALIASES)
      .filter(([, m]) => m === mode)
      .map(([word]) => word)
      .join("/"),
  ).join(", ");
}
