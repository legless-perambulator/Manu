import { AGENCY_CAVEAT, orderScenes } from "@jellytind/domain";
import type { AgencyFinding, Decision, Scene } from "@jellytind/domain";
import { holdsAsTrue } from "@jellytind/story-state";
import type { StoryRepository } from "@jellytind/story-repository";
import { renderSnapshot, snapshotAt } from "./snapshot";
import type { CharacterAnalyst } from "./types";

/**
 * The Character Agency Audit.
 *
 * _Where does someone act because the plot needs them to, rather than because
 * they want something?_ That question is mostly a reading — but not entirely,
 * and the part that is not is worth finding first.
 *
 * Four deterministic signals, in descending order of how sure they are:
 *
 * 1. **Acting on information they do not have.** A scene whose recorded purpose
 *    turns on a proposition the character does not hold. The manuscript is
 *    asking them to know something nobody gave them.
 * 2. **A decision with no recorded reason.** The author wrote down that she
 *    chose; nothing says why.
 * 3. **Moved without a reason.** Their location or status changes in a scene
 *    where no decision of theirs is recorded.
 * 4. **No goals at all.** Not a fault — but nothing can be checked against it,
 *    and the audit says so rather than passing silently.
 *
 * Everything beyond those four is model judgement, and is labelled.
 */
export interface AgencyAudit {
  readonly characterId: string;
  readonly scope: string;
  readonly findings: readonly AgencyFinding[];
  readonly caveat: string;
  readonly scenesInspected: number;
  readonly notChecked: readonly string[];
  readonly modelId?: string;
}

export interface AgencyOptions {
  readonly analyst?: CharacterAnalyst | null;
  /** Restrict to one chapter. Defaults to the whole book. */
  readonly chapterId?: string;
  readonly limit?: number;
}

export async function auditAgency(
  repo: StoryRepository,
  characterId: string,
  options: AgencyOptions = {},
): Promise<AgencyAudit> {
  const [scenes, chapters, facts, decisions, characters, timeline] = await Promise.all([
    repo.listScenes(),
    repo.listChapters(),
    repo.listFacts(),
    repo.listDecisions(),
    repo.listCharacters(),
    repo.getStoryTimeline(),
  ]);

  const character = characters.find((entry) => (entry.id as string) === characterId);
  const ordered = orderScenes(scenes, chapters).filter(
    (scene) =>
      scene.characterIds.map(String).includes(characterId) &&
      (options.chapterId === undefined ||
        (scene.chapterId as string | undefined) === options.chapterId),
  );

  const findings: AgencyFinding[] = [];
  const notChecked: string[] = [];

  if (character !== undefined && character.goals.length === 0) {
    findings.push({
      sceneId: "",
      characterId,
      statement: `No goals are recorded for ${character.name}, so no action of theirs can be checked against what they want.`,
      detail: "An unrecorded goal is not an absent one — but nothing here can test against it.",
      derivation: "deterministic",
      kind: "no_recorded_goal",
    });
  }

  for (const scene of ordered) {
    const sceneId = scene.id as string;
    const boundary = { sceneId, position: "before" } as const;
    const state = timeline.characterStateAt(characterId, boundary);
    const held = new Map(state.knowledge.map((record) => [record.factId, record]));

    // 1 — the scene's purpose turns on something they do not hold.
    for (const factId of scene.factIds.map(String)) {
      const record = held.get(factId);
      if (record !== undefined && holdsAsTrue(record.state)) continue;
      const fact = facts.find((entry) => (entry.id as string) === factId);
      findings.push({
        sceneId,
        characterId,
        statement: `In "${scene.title}" the scene turns on something they do not know: "${fact?.statement ?? factId}"`,
        detail:
          "Nothing recorded gives this character that information before this scene. Either they learn it here, or the scene is asking them to act on it regardless.",
        derivation: "deterministic",
        kind: "acts_on_unknown_information",
      });
    }

    // 2 — a decision with no recorded reason.
    for (const decision of theirs(decisions, characterId, sceneId)) {
      if (decision.reason !== undefined && decision.reason.trim() !== "") continue;
      findings.push({
        sceneId,
        characterId,
        statement: `In "${scene.title}" they decide "${decision.description}" with no reason recorded.`,
        derivation: "deterministic",
        kind: "decision_without_reason",
      });
    }

    // 3 — they move or change, and nothing says they chose to.
    const moved = timeline
      .transitionsAtScene(sceneId)
      .filter(
        (transition) =>
          transition.subjectId === characterId &&
          (transition.kind === "character_location" || transition.kind === "character_status"),
      );
    if (moved.length > 0 && theirs(decisions, characterId, sceneId).length === 0) {
      findings.push({
        sceneId,
        characterId,
        statement: `In "${scene.title}" their position or condition changes, and no decision of theirs is recorded.`,
        detail: "The change may be done to them rather than by them; the record does not say.",
        derivation: "deterministic",
        kind: "moved_without_reason",
      });
    }
  }

  if (ordered.length === 0) {
    notChecked.push("this character appears in no scene in the scope inspected");
  }
  if (decisions.length === 0) {
    notChecked.push("no decisions are recorded anywhere in the project");
  }

  // The reading, over the same scenes.
  const analyst = options.analyst ?? null;
  let modelId: string | undefined;
  if (analyst === null) {
    notChecked.push(
      "no model is configured, so nothing read the scenes for behaviour that only serves the plot",
    );
  } else if (ordered.length > 0) {
    const briefing = await briefingFor(repo, characterId, ordered);
    const notes = await analyst.readAgency({
      briefing,
      candidates: findings,
      limit: options.limit ?? 8,
    });
    modelId = analyst.modelId;
    for (const note of notes) {
      findings.push({
        sceneId: note.sceneId,
        characterId,
        statement: note.statement,
        ...(note.detail === undefined ? {} : { detail: note.detail }),
        derivation: "model",
        kind: "reads_as_plot_driven",
      });
    }
  }

  return {
    characterId,
    scope: options.chapterId === undefined ? "the whole book" : options.chapterId,
    findings,
    caveat: AGENCY_CAVEAT,
    scenesInspected: ordered.length,
    notChecked,
    ...(modelId === undefined ? {} : { modelId }),
  };
}

function theirs(
  decisions: readonly Decision[],
  characterId: string,
  sceneId: string,
): readonly Decision[] {
  return decisions.filter(
    (decision) =>
      (decision.characterId as string) === characterId &&
      (decision.sceneId as string | undefined) === sceneId,
  );
}

/**
 * The material the reading works from: the character at their first scene in
 * scope, and what each scene is recorded as being for.
 *
 * Bounded on purpose — an audit that handed a model the whole manuscript would
 * be answering a different question, and would be answering it about prose
 * nobody asked about.
 */
async function briefingFor(
  repo: StoryRepository,
  characterId: string,
  scenes: readonly Scene[],
): Promise<string> {
  const first = scenes[0];
  /* istanbul ignore next — callers check for an empty list. */
  if (first === undefined) return "";
  const snapshot = await snapshotAt(repo, characterId, first.id as string);
  return [
    renderSnapshot(snapshot),
    "",
    "THE SCENES THEY APPEAR IN, AND WHAT EACH IS RECORDED AS BEING FOR",
    ...scenes.map(
      (scene) =>
        `- ${scene.id as string} "${scene.title}"${
          scene.purpose.length === 0 ? " (no purpose recorded)" : `: ${scene.purpose.join("; ")}`
        }`,
    ),
  ].join("\n");
}
