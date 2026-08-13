import { skillByCommand } from "./skills";
import { SkillError, type SkillDefinition } from "./types";

/**
 * `/character-pass Mara`
 *
 * The fast path: a writer names a skill and the thing to run it on, and the
 * arguments are resolved against the project's own entities — because "Mara"
 * has to mean `CHAR_0007` before a workflow can start. The same parser handles
 * custom skills, since a custom skill is a skill.
 *
 * Natural language takes the other road: an agent reads the sentence and starts
 * the same run with the same inputs. This exists so the fast path needs no
 * model (docs/STORY_DEBUGGER.md — the `/debug` parser it mirrors).
 */

export interface EntitySummary {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
}

export interface ParsedSkillCommand {
  readonly skill: SkillDefinition;
  readonly inputs: Readonly<Record<string, string>>;
  /** What each argument was taken to mean, for the writer to check. */
  readonly resolved: readonly string[];
  /** Arguments that matched nothing, kept visible rather than ignored. */
  readonly unresolved: readonly string[];
}

const KIND_FOR_INPUT: Readonly<Record<string, string>> = {
  character: "character",
  chapter: "chapter",
  scene: "scene",
  plot_thread: "plot_thread",
};

export function parseSkillCommand(
  line: string,
  entities: readonly EntitySummary[],
  extra: readonly SkillDefinition[] = [],
): ParsedSkillCommand {
  const trimmed = line.trim();
  const words = trimmed.split(/\s+/).filter((word) => word !== "");
  const head = words[0];
  if (head === undefined) {
    throw new SkillError("unknown_skill", "Say which skill to run, e.g. /character-pass Mara.");
  }

  const skill = skillByCommand(head, extra);
  if (skill === null) {
    throw new SkillError("unknown_skill", `"${head}" is not a skill Manu has.`, {
      details: { command: head },
    });
  }

  const rest = words.slice(1);
  const inputs: Record<string, string> = {};
  const resolved: string[] = [];
  const unresolved: string[] = [];

  for (const word of rest) {
    // An explicit ID wins: a writer who typed CHAR_0007 meant CHAR_0007.
    const byId = entities.find((entity) => entity.id === word);
    const match =
      byId ??
      entities.find(
        (entity) =>
          entity.name.toLowerCase() === word.toLowerCase() ||
          entity.name.toLowerCase().split(/\s+/)[0] === word.toLowerCase(),
      );
    if (match === undefined) {
      unresolved.push(word);
      continue;
    }
    const slot = skill.inputs.find(
      (input) =>
        input.entityKind !== undefined &&
        KIND_FOR_INPUT[input.entityKind] === match.kind &&
        inputs[input.key] === undefined,
    );
    if (slot === undefined) {
      unresolved.push(word);
      continue;
    }
    inputs[slot.key] = match.id;
    resolved.push(`${word} → ${match.name} (${match.id})`);
  }

  const missing = skill.inputs.filter(
    (input) => input.required && (inputs[input.key] ?? "") === "",
  );
  if (missing.length > 0) {
    throw new SkillError(
      "missing_input",
      `${skill.name} needs ${missing.map((input) => input.label.toLowerCase()).join(" and ")}. ${
        unresolved.length > 0 ? `Nothing in the project matched: ${unresolved.join(", ")}.` : ""
      }`.trim(),
      { details: { skill: skill.id, missing: missing.map((input) => input.key) } },
    );
  }

  return { skill, inputs, resolved, unresolved };
}
