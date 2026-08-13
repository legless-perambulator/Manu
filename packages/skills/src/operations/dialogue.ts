import type { CharacterVoiceProfile, SkillFinding } from "@jellytind/domain";
import { representativeLines } from "@jellytind/story-repository";
import { countWords, extractDialogue, round, type DialogueLine } from "../prose";
import type { SkillOperation } from "../types";
import { compareSpeakers } from "./character";
import { chapterProse, finding, labels, nothingToDo, operation } from "./shared";

/**
 * The `/dialogue-pass` workflow.
 *
 * Dialogue is pulled off the page deterministically, attributed only where a
 * speech tag names someone, and then measured against the voices the project
 * records. The one step that genuinely needs a reader — subtext — is the only
 * one that asks a model, and it is skipped rather than faked when none is
 * configured (docs/CHARACTER_VOICE.md).
 */

interface IdentifiedDialogue {
  readonly lines: readonly DialogueLine[];
  readonly attributed: number;
  readonly unattributed: number;
  readonly speakerIds: readonly string[];
  readonly chapterIds: readonly string[];
}

export const identifyDialogue = operation({
  id: "identify_dialogue",
  title: "Identify dialogue",
  kind: "deterministic",
  produces: "dialogue",
  requiredTools: ["read_chapter_prose", "list_characters"],
  async run(context) {
    const [characters, prose] = await Promise.all([
      context.repo.listCharacters(),
      chapterProse(context.repo, context.inputs.chapterId),
    ]);
    const names = characters.map((character) => ({
      id: character.id as string,
      name: character.name,
    }));

    const lines = prose.flatMap((chapter) =>
      extractDialogue(chapter.text, names, { chapterId: chapter.chapterId }),
    );
    if (lines.length === 0) {
      return nothingToDo("No quoted dialogue was found in the prose inspected.");
    }

    const attributed = lines.filter((line) => line.speakerId !== undefined);
    const speakerIds = [...new Set(attributed.map((line) => line.speakerId as string))];
    const data: IdentifiedDialogue = {
      lines,
      attributed: attributed.length,
      unattributed: lines.length - attributed.length,
      speakerIds,
      chapterIds: prose.map((chapter) => chapter.chapterId),
    };

    return {
      summary: `Identified ${String(lines.length)} line(s) of dialogue, ${String(attributed.length)} attributable to ${String(speakerIds.length)} character(s)`,
      data,
      measurements: [
        {
          label: "Dialogue lines",
          value: lines.length,
          unit: "lines",
          basis: `${String(prose.length)} chapter(s) of prose`,
        },
      ],
      ...(data.unattributed > 0
        ? {
            notMeasured: [
              `${String(data.unattributed)} line(s) carry no speech tag naming a character, so they were not attributed`,
            ],
          }
        : {}),
    };
  },
});

export const loadVoiceProfiles = operation({
  id: "load_voice_profiles",
  title: "Load Character Voice profiles",
  kind: "deterministic",
  reads: ["dialogue"],
  produces: "voices",
  requiredTools: ["get_character_voice"],
  contextRecipe: "character_voice",
  async run(context) {
    const dialogue = context.read<IdentifiedDialogue>("dialogue");
    if (dialogue === null) return nothingToDo("No dialogue identified, so no voices were loaded.");

    const names = await labels(context.repo);
    const loaded: Array<{
      characterId: string;
      name: string;
      hasProfile: boolean;
      examples: number;
    }> = [];
    const missing: string[] = [];

    for (const characterId of dialogue.speakerIds) {
      const [profile, examples] = await Promise.all([
        context.repo.characterVoices.getProfile(characterId),
        context.repo.characterVoices.listExamples(characterId),
      ]);
      loaded.push({
        characterId,
        name: names.get(characterId) ?? characterId,
        hasProfile: profile !== null,
        examples: examples.length,
      });
      if (profile === null) missing.push(names.get(characterId) ?? characterId);
    }

    const findings =
      missing.length === 0
        ? []
        : [
            finding(context, 0, {
              kind: "gap",
              statement: `No recorded voice for ${missing.join(", ")}.`,
              detail:
                "Differentiation can still be measured from their lines, but there is nothing stated to check the lines against.",
            }),
          ];

    return {
      summary: `Loaded ${String(loaded.filter((entry) => entry.hasProfile).length)} of ${String(loaded.length)} speaker profile(s)`,
      data: { speakers: loaded },
      findings,
    };
  },
});

/** Signals that a line is carrying information for the reader's benefit. */
const LONG_UTTERANCE_WORDS = 45;

export const inspectExposition = operation({
  id: "inspect_exposition",
  title: "Inspect exposition",
  kind: "deterministic",
  reads: ["dialogue"],
  produces: "exposition",
  async run(context) {
    const dialogue = context.read<IdentifiedDialogue>("dialogue");
    if (dialogue === null) return nothingToDo("No dialogue identified.");

    const names = await labels(context.repo);
    const long = dialogue.lines.filter((line) => countWords(line.text) >= LONG_UTTERANCE_WORDS);
    // "As you know, …" and its relatives: a character telling another something
    // they both already know is the reader being told.
    const asYouKnow = dialogue.lines.filter((line) =>
      /\bas you (?:know|remember|recall)\b|\bas i (?:told|said)\b|\byou already know\b/i.test(
        line.text,
      ),
    );

    const findings: SkillFinding[] = [];
    if (long.length > 0) {
      findings.push(
        finding(context, findings.length, {
          kind: "measurement",
          statement: `${String(long.length)} line(s) run past ${String(LONG_UTTERANCE_WORDS)} words.`,
          detail:
            "Length is not a fault — a monologue may be the point. This counts them so they can be looked at.",
          basis: "word counts of quoted speech",
          entities: [
            ...new Set(
              long.flatMap((line) => (line.speakerId === undefined ? [] : [line.speakerId])),
            ),
          ],
        }),
      );
    }
    for (const line of asYouKnow.slice(0, 6)) {
      findings.push(
        finding(context, findings.length, {
          kind: "attention",
          statement: `Dialogue addressed to someone who is said to already know it: "${line.text.slice(0, 80)}"`,
          detail:
            line.speakerId === undefined
              ? "Speaker not attributable from the tag."
              : `Spoken by ${names.get(line.speakerId) ?? line.speakerId}.`,
          basis: "phrase match on the line itself",
          ...(line.chapterId === undefined ? {} : { entities: [line.chapterId] }),
        }),
      );
    }

    return {
      summary: `Checked exposition — ${String(long.length)} long line(s), ${String(asYouKnow.length)} addressed to someone who already knows`,
      data: { longLines: long.length, asYouKnow: asYouKnow.length },
      findings,
    };
  },
});

export const inspectDifferentiation = operation({
  id: "inspect_differentiation",
  title: "Inspect differentiation",
  kind: "deterministic",
  reads: ["dialogue", "voices"],
  produces: "differentiation",
  requiredTools: ["compare_character_voices"],
  async run(context) {
    const dialogue = context.read<IdentifiedDialogue>("dialogue");
    if (dialogue === null) return nothingToDo("No dialogue identified.");
    if (dialogue.speakerIds.length < 2) {
      return nothingToDo(
        "Fewer than two speakers could be attributed, so no two voices could be compared.",
      );
    }

    const names = await labels(context.repo);
    const entries: Array<{ profile: CharacterVoiceProfile; lines: readonly string[] }> = [];
    for (const characterId of dialogue.speakerIds) {
      const [profile, examples] = await Promise.all([
        context.repo.characterVoices.getProfile(characterId),
        context.repo.characterVoices.listExamples(characterId),
      ]);
      const spoken = dialogue.lines
        .filter((line) => line.speakerId === characterId)
        .map((line) => line.text);
      entries.push({
        profile: profile ?? {
          characterId,
          attributes: {},
          updatedAt: new Date(0).toISOString(),
        },
        lines: [...representativeLines(examples, 50), ...spoken],
      });
    }

    const comparisons = compareSpeakers(entries);
    const close = comparisons.filter((comparison) => comparison.band === "high");

    const findings = close.map((comparison, index) =>
      finding(context, index, {
        kind: "attention",
        statement: `${names.get(comparison.aId) ?? comparison.aId} and ${names.get(comparison.bId) ?? comparison.bId} measure as close in voice.`,
        detail: [comparison.sharedTendencies.join("; "), comparison.caveat, comparison.basis]
          .filter((part) => part !== "")
          .join(" "),
        basis: "heuristic comparison of recorded and spoken lines — a band, never a percentage",
        entities: [comparison.aId, comparison.bId],
      }),
    );

    return {
      summary: `Compared ${String(comparisons.length)} pair(s) of speakers — ${String(close.length)} measure as close`,
      data: {
        comparisons: comparisons.map((comparison) => ({
          aId: comparison.aId,
          bId: comparison.bId,
          band: comparison.band,
          caveat: comparison.caveat,
          basis: comparison.basis,
          sharedTendencies: comparison.sharedTendencies,
        })),
      },
      findings,
    };
  },
});

export const inspectSubtext = operation({
  id: "inspect_subtext",
  title: "Inspect subtext",
  kind: "semantic",
  reads: ["dialogue"],
  produces: "subtext",
  contextRecipe: "scene_rewrite",
  async run(context) {
    if (context.analyst === null) {
      return nothingToDo("No model is configured, so subtext was not inspected.");
    }
    const dialogue = context.read<IdentifiedDialogue>("dialogue");
    if (dialogue === null) return nothingToDo("No dialogue identified.");

    const names = await labels(context.repo);
    const sample = dialogue.lines.slice(0, 120);
    const material = sample
      .map(
        (line) =>
          `${line.speakerId === undefined ? "(untagged)" : (names.get(line.speakerId) ?? line.speakerId)}: "${line.text}"`,
      )
      .join("\n");

    const notes = await context.analyst.read({
      instruction:
        "Find lines that state their own subtext — where a character says what they feel or want instead of showing it, or explains something the scene has already established. Quote the line. Do not rewrite it.",
      material,
      maxItems: 10,
    });

    const findings = notes.map((note, index) =>
      finding(context, index, {
        kind: "proposal",
        statement: note.statement,
        ...(note.detail === undefined ? {} : { detail: note.detail }),
        basis: `model reading (${context.analyst?.modelId ?? "model"}) of ${String(sample.length)} line(s) — nothing has been changed`,
        ...(note.entities === undefined ? {} : { entities: note.entities }),
        source: "model",
      }),
    );

    return {
      summary: `Model raised ${String(notes.length)} suggestion(s) about subtext`,
      data: { notes, linesRead: sample.length },
      findings,
      ...(sample.length < dialogue.lines.length
        ? {
            notMeasured: [
              `${String(dialogue.lines.length - sample.length)} further line(s) were not sent to the model`,
            ],
          }
        : {}),
    };
  },
});

/** Mean words per line, for the pacing skill's dialogue share. */
export function dialogueDensity(lines: readonly DialogueLine[]): number {
  return round(
    lines.length === 0
      ? 0
      : lines.reduce((sum, line) => sum + countWords(line.text), 0) / lines.length,
  );
}

export const DIALOGUE_OPERATIONS: readonly SkillOperation[] = [
  identifyDialogue,
  loadVoiceProfiles,
  inspectExposition,
  inspectDifferentiation,
  inspectSubtext,
];

export type { IdentifiedDialogue };
