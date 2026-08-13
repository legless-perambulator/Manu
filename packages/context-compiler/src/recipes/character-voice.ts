import type { Character } from "@jellytind/domain";
import { statedAttributes } from "@jellytind/domain";
import { PRIORITY, type Candidate } from "../candidate";
import type { ProjectReader } from "../reader";
import { provenance } from "./shared";

/**
 * Character voice as compiled context.
 *
 * The acceptance test for this whole subsystem is that a dialogue task can tell
 * Elias's voice from Mara's **from project data**, not from their character
 * descriptions. So what goes in is the recorded voice: the attributes the
 * writer stated, and actual lines the character has said.
 *
 * Emotional state is deliberately **not** duplicated here. It is already
 * compiled into the `storyState` section from scene-anchored transitions, and
 * the compiler consumes what exists rather than re-deriving it
 * ([STORY_COMPILER.md](STORY_COMPILER.md)).
 *
 * Budget matters: examples are capped, and the POV character gets more of them
 * than someone with two lines in the scene. Handing a model forty lines of
 * everyone's dialogue would crowd out the scene it is meant to be writing.
 */

/** Examples per character: enough to hear a rhythm, not enough to drown the scene. */
const EXAMPLES_FOR_POV = 6;
const EXAMPLES_FOR_OTHERS = 3;

export async function characterVoiceCandidates(
  reader: ProjectReader,
  options: {
    characters: readonly Character[];
    povId?: string;
    sceneId?: string;
    relatedIds?: string[];
  },
): Promise<Candidate[]> {
  if (reader.characterVoice === undefined) return [];

  const candidates: Candidate[] = [];
  for (const [index, character] of options.characters.entries()) {
    const isPov = character.id === options.povId;
    const voice = await reader.characterVoice({
      characterId: character.id,
      ...(options.sceneId !== undefined ? { sceneId: options.sceneId } : {}),
      limit: isPov ? EXAMPLES_FOR_POV : EXAMPLES_FOR_OTHERS,
    });
    if (voice === null) continue;

    const stated = statedAttributes(voice.attributes);
    if (stated.length === 0 && voice.examples.length === 0) continue;

    const lines: string[] = [`How ${character.name} speaks.`];

    if (stated.length > 0) {
      lines.push("");
      for (const key of stated) {
        const attribute = voice.attributes[key];
        if (attribute === undefined) continue;
        const note = attribute.note !== undefined ? ` (${attribute.note})` : "";
        lines.push(`- ${key.replace(/_/g, " ")}: ${attribute.value}${note}`);
      }
    }

    // A shift that has already happened is part of the voice now; saying which
    // one stops a model reading the change as an inconsistency to smooth out.
    if (voice.appliedShifts.length > 0) {
      lines.push("", "This voice has changed during the book:");
      for (const shift of voice.appliedShifts) lines.push(`- ${shift}`);
    }

    if (voice.examples.length > 0) {
      lines.push("", "Lines they have actually said:");
      for (const example of voice.examples) lines.push(`- ${example}`);
    }

    candidates.push({
      id: `VOICE_${character.id}`,
      kind: "file",
      label: `${character.name} — voice`,
      section: "styleRules",
      // The POV character's voice sits above the others'.
      priority: PRIORITY.style + (isPov ? 0 : 1 + index),
      provenance: provenance(
        "character_voice",
        `recorded speech profile for ${character.id}, who ${isPov ? "narrates" : "speaks in"} this scene`,
        [character.id, ...(options.relatedIds ?? [])],
      ),
      full: lines.join("\n"),
    });
  }
  return candidates;
}
