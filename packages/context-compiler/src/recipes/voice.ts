import type { VoiceRule, VoiceTendency } from "@jellytind/domain";
import { describeRule } from "@jellytind/domain";
import { PRIORITY, type Candidate } from "../candidate";
import type { ProjectReader } from "../reader";
import { provenance } from "./shared";

/**
 * Author Voice as compiled context.
 *
 * The profile is retrieved **by operation**, not wholesale. Rewriting a line of
 * dialogue pulls the writer's dialogue, punctuation and narrative-distance
 * preferences; it does not pull their feelings about landscape description.
 * Sending the whole profile every time would spend budget on rules that do not
 * apply and bury the ones that do (docs/AUTHOR_VOICE.md).
 *
 * The writer's own rules and a model's confirmed readings are rendered as
 * separate items, so the model receiving them can tell an instruction from an
 * observation — and so the writer, reading the Context tab, can too.
 */
export async function voiceCandidates(
  reader: ProjectReader,
  options: {
    operation?: string;
    characterId?: string;
    povCharacterId?: string;
    relatedIds?: string[];
  },
): Promise<Candidate[]> {
  if (reader.authorVoice === undefined) return [];
  const voice = await reader.authorVoice({
    ...(options.operation !== undefined ? { operation: options.operation } : {}),
    ...(options.characterId !== undefined ? { characterId: options.characterId } : {}),
    ...(options.povCharacterId !== undefined ? { povCharacterId: options.povCharacterId } : {}),
  });

  const related = options.relatedIds ?? [];
  const candidates: Candidate[] = [];

  if (voice.rules.length > 0) {
    candidates.push({
      id: "AUTHOR_VOICE_RULES",
      kind: "file",
      label: "Author voice — your rules",
      section: "styleRules",
      // Above generic style files: a rule the writer stated outranks a document
      // they once wrote about style.
      priority: PRIORITY.style - 1,
      provenance: provenance(
        "style_rule",
        `author voice rules for ${options.operation ?? "this operation"}, stated by the writer`,
        related,
      ),
      full: renderRules(voice.rules),
    });
  }

  if (voice.tendencies.length > 0) {
    candidates.push({
      id: "AUTHOR_VOICE_TENDENCIES",
      kind: "file",
      label: "Author voice — confirmed tendencies",
      section: "styleRules",
      priority: PRIORITY.style,
      provenance: provenance(
        "style_rule",
        "observed tendencies in the writer's prose, which the writer has confirmed",
        related,
      ),
      full: renderTendencies(voice.tendencies),
    });
  }

  return candidates;
}

function renderRules(rules: readonly VoiceRule[]): string {
  const lines = ["The author's stated preferences. Follow these."];
  for (const rule of rules) {
    const scope = rule.scope === "project" ? "" : ` [${rule.scope}]`;
    lines.push(`- ${describeRule(rule)}${scope}`);
  }
  return lines.join("\n");
}

function renderTendencies(tendencies: readonly VoiceTendency[]): string {
  const lines = [
    "Tendencies observed in the author's prose and confirmed by them.",
    "These describe how they write; they are not instructions to imitate mechanically.",
  ];
  for (const tendency of tendencies) {
    lines.push(`- ${tendency.statement}`);
  }
  return lines.join("\n");
}
