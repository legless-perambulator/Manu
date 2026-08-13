import { orderScenes } from "@jellytind/domain";
import type { CharacterId, CharacterVoiceProfile } from "@jellytind/domain";
import {
  compareVoices,
  measureDialogue,
  representativeLines,
  type VoiceSimilarity,
} from "@jellytind/story-repository";
import { extractDialogue, round } from "../prose";
import type { SkillOperation } from "../types";
import { chapterProse, finding, labels, nothingToDo, operation } from "./shared";

/**
 * The `/character-pass` workflow, one operation per step.
 *
 * Each step is a query against what the project already reconstructs — scene
 * membership, chronology, knowledge, relationships, recorded voice — and each
 * writes down what it found. Nothing here asks a model anything, which is why
 * a character pass is repeatable: run it twice on an unchanged project and it
 * says the same thing twice (docs/WRITING_SKILLS.md).
 */

interface LocatedScenes {
  readonly characterId: string;
  readonly name: string;
  readonly sceneIds: readonly string[];
  readonly povSceneIds: readonly string[];
  readonly positions: readonly number[];
  readonly totalScenes: number;
}

export const locateCharacterScenes = operation({
  id: "locate_character_scenes",
  title: "Locate every scene containing the character",
  kind: "deterministic",
  requiresInput: ["characterId"],
  produces: "scenes",
  requiredTools: ["get_scenes_by_character", "list_scenes", "list_chapters"],
  async run(context) {
    const characterId = context.inputs.characterId as string;
    const [scenes, chapters, all, names] = await Promise.all([
      context.repo.getScenesByCharacter(characterId as CharacterId),
      context.repo.listChapters(),
      context.repo.listScenes(),
      labels(context.repo),
    ]);
    if (scenes.length === 0) {
      return nothingToDo(
        `${names.get(characterId) ?? characterId} appears in no recorded scene, so there is nothing to pass over.`,
      );
    }

    const ordered = orderScenes(all, chapters).map((scene) => scene.id as string);
    const sceneIds = scenes.map((scene) => scene.id as string);
    const positions = sceneIds
      .map((id) => ordered.indexOf(id))
      .filter((at) => at >= 0)
      .sort((a, b) => a - b);
    const povSceneIds = scenes
      .filter((scene) => (scene.pov as string | undefined) === characterId)
      .map((scene) => scene.id as string);

    const data: LocatedScenes = {
      characterId,
      name: names.get(characterId) ?? characterId,
      sceneIds,
      povSceneIds,
      positions,
      totalScenes: ordered.length,
    };

    return {
      summary: `Located ${String(sceneIds.length)} scene(s), ${String(povSceneIds.length)} in their POV`,
      data,
      measurements: [
        {
          label: "Scenes containing the character",
          value: sceneIds.length,
          unit: "scenes",
          basis: `of ${String(ordered.length)} in the manuscript`,
        },
      ],
    };
  },
});

export const reconstructChronology = operation({
  id: "reconstruct_chronology",
  title: "Reconstruct chronology",
  kind: "deterministic",
  reads: ["scenes"],
  produces: "chronology",
  requiredTools: ["get_story_chronology"],
  async run(context) {
    const located = context.read<LocatedScenes>("scenes");
    if (located === null) return nothingToDo("No located scenes to place in time.");

    const chronology = await context.repo.getStoryChronology();
    const chronological = chronology.chronologicalSceneOrder();
    const theirs = new Set(located.sceneIds);
    const flashbacks = located.sceneIds.filter(
      (id) => chronology.has(id) && chronology.isFlashback(id),
    );

    // The longest run of scenes the character is absent from, in manuscript
    // order. A measurement — a character can be off the page for good reasons.
    let longestGap = 0;
    let gapAfter: string | undefined;
    for (let i = 1; i < located.positions.length; i += 1) {
      const gap = (located.positions[i] ?? 0) - (located.positions[i - 1] ?? 0) - 1;
      if (gap > longestGap) {
        longestGap = gap;
        gapAfter = located.sceneIds[i - 1];
      }
    }

    const data = {
      chronologicalPositions: chronological.filter((id) => theirs.has(id)),
      flashbacks,
      longestGap,
      ...(gapAfter === undefined ? {} : { gapAfter }),
      contradictory: chronology.contradictorySet().filter((id) => theirs.has(id)),
    };

    const findings = [];
    if (data.contradictory.length > 0) {
      findings.push(
        finding(context, findings.length, {
          kind: "conflict",
          statement: `${String(data.contradictory.length)} of their scenes cannot be placed in a consistent order.`,
          detail: "Recorded temporal relations contradict each other for these scenes.",
          basis: "story chronology",
          sceneIds: data.contradictory,
        }),
      );
    }

    return {
      summary: `Reconstructed chronology — ${String(flashbacks.length)} flashback scene(s), longest absence ${String(longestGap)} scene(s)`,
      data,
      findings,
      measurements: [
        {
          label: "Longest absence",
          value: longestGap,
          unit: "scenes",
          basis: "consecutive scenes in manuscript order without them",
        },
      ],
    };
  },
});

export const reconstructKnowledge = operation({
  id: "reconstruct_knowledge",
  title: "Reconstruct knowledge",
  kind: "deterministic",
  requiresInput: ["characterId"],
  produces: "knowledge",
  requiredTools: ["get_story_timeline", "list_facts"],
  async run(context) {
    const characterId = context.inputs.characterId as string;
    const [timeline, facts] = await Promise.all([
      context.repo.getStoryTimeline(),
      context.repo.listFacts(),
    ]);

    const acquisitions = facts
      .flatMap((fact) => timeline.knowledgeHistory(characterId, fact.id as string))
      .map((step) => ({
        factId: step.factId,
        statement: facts.find((f) => (f.id as string) === step.factId)?.statement ?? step.factId,
        state: step.state,
        sceneId: step.sceneId,
        sourceType: step.sourceType,
        ...(step.sourceEntityId === undefined ? {} : { sourceEntityId: step.sourceEntityId }),
      }));

    const findings = [];
    if (facts.length > 0 && acquisitions.length === 0) {
      findings.push(
        finding(context, 0, {
          kind: "gap",
          statement: "Nothing is recorded about what this character learns, or when.",
          detail: `The project holds ${String(facts.length)} fact(s) and no knowledge transition for them. That is a gap in the record, not necessarily in the story.`,
          basis: "knowledge transitions",
          entities: [characterId],
        }),
      );
    }

    return {
      summary: `Reconstructed knowledge — ${String(acquisitions.length)} recorded change(s) across ${String(facts.length)} fact(s)`,
      data: { acquisitions, factCount: facts.length },
      findings,
      ...(facts.length === 0
        ? { notMeasured: ["no facts recorded, so knowledge was not traced"] }
        : {}),
    };
  },
});

export const reconstructRelationships = operation({
  id: "reconstruct_relationships",
  title: "Reconstruct relationships",
  kind: "deterministic",
  requiresInput: ["characterId"],
  produces: "relationships",
  requiredTools: ["list_relationships", "get_relationship_history"],
  async run(context) {
    const characterId = context.inputs.characterId as string;
    const [relationships, names] = await Promise.all([
      context.repo.listRelationships(),
      labels(context.repo),
    ]);
    const theirs = relationships.filter(
      (relationship) =>
        (relationship.characterAId as string) === characterId ||
        (relationship.characterBId as string) === characterId,
    );
    if (theirs.length === 0) {
      return {
        summary: "No relationships recorded for this character",
        data: { relationships: [] },
        findings: [
          finding(context, 0, {
            kind: "gap",
            statement: "No relationship is recorded for this character.",
            detail:
              "Relationship change is where most character arcs are actually visible; nothing here means nothing was recorded.",
            entities: [characterId],
          }),
        ],
      };
    }

    const out = [];
    for (const relationship of theirs) {
      const history = await context.repo.getRelationshipHistory(relationship.id as string);
      const otherId =
        (relationship.characterAId as string) === characterId
          ? (relationship.characterBId as string)
          : (relationship.characterAId as string);
      out.push({
        id: relationship.id as string,
        with: names.get(otherId) ?? otherId,
        otherId,
        type: relationship.type,
        changes: history.map((change) => ({
          sceneId: change.sceneId,
          kind: change.kind,
          label: change.label,
          ...(change.from === undefined ? {} : { from: change.from }),
          to: change.to,
        })),
      });
    }

    const still = out.filter((entry) => entry.changes.length === 0);
    const findings = still.map((entry, index) =>
      finding(context, index, {
        kind: "gap",
        statement: `Nothing changes in the relationship with ${entry.with} across the whole book.`,
        detail:
          "No recorded change means none was recorded — the relationship may still move on the page.",
        entities: [characterId, entry.otherId],
      }),
    );

    const changes = out.reduce((sum, entry) => sum + entry.changes.length, 0);
    return {
      summary: `Reconstructed ${String(out.length)} relationship(s) with ${String(changes)} recorded change(s)`,
      data: { relationships: out },
      findings,
      measurements: [
        {
          label: "Recorded relationship changes",
          value: changes,
          unit: "changes",
          basis: `across ${String(out.length)} relationship(s)`,
        },
      ],
    };
  },
});

export const inspectCharacterDialogue = operation({
  id: "inspect_character_dialogue",
  title: "Inspect dialogue",
  kind: "deterministic",
  requiresInput: ["characterId"],
  reads: ["scenes"],
  produces: "characterDialogue",
  requiredTools: ["get_character_voice", "read_chapter_prose"],
  contextRecipe: "character_voice",
  async run(context) {
    const characterId = context.inputs.characterId as string;
    const [profile, examples, characters, prose] = await Promise.all([
      context.repo.characterVoices.getProfile(characterId),
      context.repo.characterVoices.listExamples(characterId),
      context.repo.listCharacters(),
      chapterProse(context.repo),
    ]);

    const recorded = representativeLines(examples, 50);
    const onThePage = prose.flatMap((chapter) =>
      extractDialogue(
        chapter.text,
        characters.map((c) => ({ id: c.id as string, name: c.name })),
        {
          chapterId: chapter.chapterId,
        },
      ).filter((line) => line.speakerId === characterId),
    );
    const lines = [...recorded, ...onThePage.map((line) => line.text)];

    if (lines.length === 0) {
      return {
        summary: "No dialogue found for this character",
        data: { lines: [], recorded: 0, fromManuscript: 0 },
        findings: [
          finding(context, 0, {
            kind: "gap",
            statement: "No dialogue could be attributed to this character.",
            detail:
              "Neither a recorded voice example nor a tagged line in the manuscript. Attribution needs a speech tag naming them; untagged lines are left alone rather than guessed at.",
            entities: [characterId],
          }),
        ],
        notMeasured: ["voice metrics need at least one attributable line"],
      };
    }

    const metrics = measureDialogue(lines, {
      ...(profile?.fillerTerms === undefined ? {} : { fillerTerms: profile.fillerTerms }),
      ...(profile?.profanityTerms === undefined ? {} : { profanityTerms: profile.profanityTerms }),
    });
    return {
      summary: `Inspected ${String(lines.length)} line(s) — ${String(recorded.length)} recorded, ${String(onThePage.length)} tagged in the manuscript`,
      data: {
        lines,
        recorded: recorded.length,
        fromManuscript: onThePage.length,
        metrics,
        statedAttributes: profile?.attributes ?? {},
      },
      measurements: [
        {
          label: "Mean utterance length",
          value: round(metrics.meanLength),
          unit: "words",
          basis: `${String(metrics.utterances)} line(s)`,
        },
      ],
      ...(metrics.notMeasured.length > 0 ? { notMeasured: metrics.notMeasured } : {}),
    };
  },
});

export const inspectBehaviour = operation({
  id: "inspect_behaviour",
  title: "Inspect behavioural consistency",
  kind: "deterministic",
  requiresInput: ["characterId"],
  reads: ["scenes"],
  produces: "behaviour",
  requiredTools: ["get_character", "list_decisions", "get_story_timeline"],
  async run(context) {
    const characterId = context.inputs.characterId as string;
    const located = context.read<LocatedScenes>("scenes");
    const [character, decisions, timeline] = await Promise.all([
      context.repo.getEntity<{ goals?: readonly string[]; name?: string }>(characterId),
      context.repo.listDecisions(),
      context.repo.getStoryTimeline(),
    ]);

    const theirs = decisions.filter((d) => (d.characterId as string) === characterId);
    const goals = character?.goals ?? [];
    const sceneIds = located?.sceneIds ?? [];

    // Scenes they are in where the project records nothing about them at all.
    const silent = sceneIds.filter((sceneId) => {
      const transitions = timeline.transitionsAtScene(sceneId);
      return !transitions.some(
        (t) =>
          t.subjectId === characterId ||
          (t.kind === "knowledge_changed" && t.subjectId === characterId),
      );
    });

    const findings = [];
    if (goals.length === 0) {
      findings.push(
        finding(context, findings.length, {
          kind: "gap",
          statement: "No goals are recorded for this character.",
          detail:
            "Behaviour can only be checked against a stated intention. An unrecorded goal is not an absent one, but nothing can be checked against it.",
          entities: [characterId],
        }),
      );
    }
    if (goals.length > 0 && theirs.length === 0) {
      findings.push(
        finding(context, findings.length, {
          kind: "gap",
          statement: `${String(goals.length)} goal(s) recorded, and no decision recorded anywhere in the book.`,
          detail:
            "Decisions are where a goal becomes behaviour; none are recorded to compare against.",
          entities: [characterId],
        }),
      );
    }
    if (silent.length > 0 && sceneIds.length > 0) {
      findings.push(
        finding(context, findings.length, {
          kind: "measurement",
          statement: `Present in ${String(silent.length)} of ${String(sceneIds.length)} scene(s) with nothing recorded about them.`,
          detail:
            "A scene may still change them on the page; this counts the record, not the prose.",
          basis: "state, knowledge and relationship transitions",
          sceneIds: silent.slice(0, 12),
          entities: [characterId],
        }),
      );
    }

    return {
      summary: `Checked ${String(goals.length)} goal(s) against ${String(theirs.length)} recorded decision(s)`,
      data: {
        goals,
        decisions: theirs.map((d) => ({
          id: d.id as string,
          description: d.description,
          ...(d.sceneId === undefined ? {} : { sceneId: d.sceneId as string }),
          ...(d.reason === undefined ? {} : { reason: d.reason }),
        })),
        scenesWithNothingRecorded: silent,
      },
      findings,
    };
  },
});

export const inspectArc = operation({
  id: "inspect_arc",
  title: "Inspect arc",
  kind: "deterministic",
  reads: ["scenes", "knowledge", "relationships"],
  produces: "arc",
  requiredTools: ["get_story_timeline"],
  async run(context) {
    const located = context.read<LocatedScenes>("scenes");
    if (located === null) return nothingToDo("No located scenes, so no arc to trace.");

    const knowledge = context.read<{ acquisitions: readonly unknown[] }>("knowledge");
    const relationships = context.read<{
      relationships: ReadonlyArray<{ changes: readonly unknown[] }>;
    }>("relationships");

    const acquisitions = knowledge?.acquisitions.length ?? 0;
    const relationshipChanges = (relationships?.relationships ?? []).reduce(
      (sum, entry) => sum + entry.changes.length,
      0,
    );
    const timeline = await context.repo.getStoryTimeline();
    const statusChanges = timeline.sceneOrder
      .flatMap((sceneId) => timeline.transitionsAtScene(sceneId))
      .filter((t) => t.subjectId === located.characterId && t.kind === "character_status").length;

    const total = acquisitions + relationshipChanges + statusChanges;
    const findings = [];
    if (total === 0) {
      findings.push(
        finding(context, 0, {
          kind: "gap",
          statement: `Across ${String(located.sceneIds.length)} scene(s), the project records nothing that changes for this character.`,
          detail:
            "No knowledge acquired, no relationship movement, no change of status. Either the arc lives only in the prose, or there is not one yet.",
          entities: [located.characterId],
        }),
      );
    }

    const first = located.positions[0];
    const last = located.positions.at(-1);
    return {
      summary: `Arc: ${String(total)} recorded change(s) — ${String(acquisitions)} learned, ${String(relationshipChanges)} relational, ${String(statusChanges)} of status`,
      data: {
        acquisitions,
        relationshipChanges,
        statusChanges,
        firstAppearance: first ?? null,
        lastAppearance: last ?? null,
        span: first === undefined || last === undefined ? 0 : last - first + 1,
      },
      findings,
      measurements: [
        {
          label: "Recorded changes across the book",
          value: total,
          unit: "changes",
          basis: "knowledge, relationship and status transitions",
        },
      ],
    };
  },
});

/**
 * Do two characters sound like each other?
 *
 * Shared with `/dialogue-pass` — the same comparison, run over whoever speaks.
 * The band and its caveat come from the repository's own comparison, which is
 * careful never to present a percentage (docs/CHARACTER_VOICE.md).
 */
export function compareSpeakers(
  entries: ReadonlyArray<{ profile: CharacterVoiceProfile; lines: readonly string[] }>,
): VoiceSimilarity[] {
  const out: VoiceSimilarity[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i];
      const b = entries[j];
      if (a === undefined || b === undefined) continue;
      out.push(compareVoices(a, b));
    }
  }
  return out;
}

export const CHARACTER_OPERATIONS: readonly SkillOperation[] = [
  locateCharacterScenes,
  reconstructChronology,
  reconstructKnowledge,
  reconstructRelationships,
  inspectCharacterDialogue,
  inspectBehaviour,
  inspectArc,
];

export type { LocatedScenes };
