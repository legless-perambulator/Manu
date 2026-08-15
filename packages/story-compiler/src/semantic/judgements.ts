import type { OutputSchema } from "@jellytind/model-router";
import { judgementRule } from "./registry";
import { dialogueOf, excerpt, shorten } from "./text";
import type {
  SemanticBuildContext,
  SemanticCompilerRule,
  SemanticConfidence,
  SemanticFindingDraft,
  SemanticTarget,
} from "./types";

/**
 * The model-judgement rules: a model's reading, through validated structured
 * output, labelled MODEL JUDGEMENT with the model that made it. Every rule
 * has a deterministic pre-check in its context recipe — no material, no call
 * — and every finding must arrive with evidence or it is dropped (§4).
 */

const CONFIDENCES = new Set(["low", "medium", "high"]);

const asConfidence = (value: unknown): SemanticConfidence =>
  typeof value === "string" && CONFIDENCES.has(value) ? (value as SemanticConfidence) : "low";

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** Keep only the scene ids that are really in scope — a model cannot invent one. */
const realScenes = (value: unknown, target: SemanticTarget): string[] =>
  asStrings(value).filter((sceneId) => target.sceneIds.includes(sceneId));

function parseFindingList(value: unknown, field: string): Record<string, unknown>[] {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Expected an object with "${field}".`);
  }
  const list = (value as Record<string, unknown>)[field];
  if (!Array.isArray(list)) throw new Error(`"${field}" must be an array.`);
  return list.filter(
    (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
  );
}

const sceneLabel = (context: SemanticBuildContext, sceneId: string): string => {
  const scene = context.scenes.find((held) => held.id === sceneId);
  return scene === undefined ? sceneId : `${sceneId} ("${scene.title}")`;
};

// ── Tension (§3) ─────────────────────────────────────────────────────────────

interface TensionOutput {
  readonly issues: readonly {
    readonly issue: string;
    readonly sceneIds: readonly string[];
    readonly note: string;
    readonly confidence: string;
  }[];
}

const TENSION_SCHEMA: OutputSchema<TensionOutput> = {
  name: "TensionAssessment",
  parse(value: unknown): TensionOutput {
    return {
      issues: parseFindingList(value, "issues").map((item) => ({
        issue: String(item.issue ?? ""),
        sceneIds: asStrings(item.sceneIds),
        note: String(item.note ?? ""),
        confidence: String(item.confidence ?? "low"),
      })),
    };
  },
};

const TENSION_ISSUES = new Set([
  "plateau",
  "collapse",
  "insufficient_escalation",
  "abrupt_escalation",
  "weak_chapter_ending",
]);

export const tensionCurve: SemanticCompilerRule = judgementRule<TensionOutput>({
  id: "sem_tension_curve",
  name: "Tension curve",
  version: 1,
  category: "tension",
  description: "Plateaus, collapses and escalation problems across the analysed stretch.",
  instruction:
    'You assess narrative tension across a sequence of scene summaries. Report only clear patterns: a plateau (several scenes at the same level), a collapse (tension built and then discarded), insufficient escalation before a climactic scene, an abrupt unearned escalation, or a chapter ending without pull. Reply with JSON only: {"issues":[{"issue":"plateau|collapse|insufficient_escalation|abrupt_escalation|weak_chapter_ending","sceneIds":["…"],"note":"one concrete sentence","confidence":"low|medium|high"}]} — an empty list when the curve works.',
  contextRecipe(context, target): string | null {
    if (target.sceneIds.length < 3) return null;
    const lines = target.sceneIds.map((sceneId) => {
      const scene = context.scenes.find((held) => held.id === sceneId);
      const prose = context.prose[sceneId] ?? "";
      return `${sceneId} "${scene?.title ?? ""}" (${String(prose.split(/\s+/).length)} words): ${excerpt(prose, 80)}`;
    });
    return `THE SCENES, IN ORDER\n${lines.join("\n")}`;
  },
  outputSchema: TENSION_SCHEMA,
  interpret(parsed, context, target) {
    const findings: SemanticFindingDraft[] = [];
    for (const issue of parsed.issues) {
      const sceneIds = issue.sceneIds.filter((sceneId) => target.sceneIds.includes(sceneId));
      if (!TENSION_ISSUES.has(issue.issue) || sceneIds.length === 0 || issue.note === "") continue;
      findings.push({
        category: "tension",
        kind: "model_judgement",
        message:
          issue.issue === "plateau"
            ? "Tension may be plateauing here."
            : issue.issue === "collapse"
              ? "Tension built earlier may be collapsing here."
              : issue.issue === "insufficient_escalation"
                ? "Escalation before this climax may be insufficient."
                : issue.issue === "abrupt_escalation"
                  ? "This escalation may arrive without enough build."
                  : "This chapter ending may lack pull.",
        detail: issue.note,
        evidence: {
          sceneIds,
          entities: [],
          notes: [issue.note, ...sceneIds.map((sceneId) => sceneLabel(context, sceneId))],
        },
        confidence: asConfidence(issue.confidence),
        key: `${issue.issue}:${sceneIds[0] ?? ""}`,
      });
    }
    return { findings };
  },
});

// ── Scene purpose (§3) ───────────────────────────────────────────────────────

interface PurposeOutput {
  readonly scenes: readonly {
    readonly sceneId: string;
    readonly accomplished: boolean;
    readonly note: string;
    readonly confidence: string;
  }[];
}

const PURPOSE_SCHEMA: OutputSchema<PurposeOutput> = {
  name: "ScenePurpose",
  parse(value: unknown): PurposeOutput {
    return {
      scenes: parseFindingList(value, "scenes").map((item) => ({
        sceneId: String(item.sceneId ?? ""),
        accomplished: item.accomplished === true,
        note: String(item.note ?? ""),
        confidence: String(item.confidence ?? "low"),
      })),
    };
  },
};

export const scenePurpose: SemanticCompilerRule = judgementRule<PurposeOutput>({
  id: "sem_scene_purpose",
  name: "Scene purpose",
  version: 1,
  category: "scene_purpose",
  description: "Whether each scene accomplishes what it was planned to do.",
  instruction:
    'You compare a scene\'s planned purpose against its actual prose. Judge only whether the purpose is accomplished ON THE PAGE — implied offstage is not accomplished. Reply with JSON only: {"scenes":[{"sceneId":"…","accomplished":true,"note":"one sentence of evidence","confidence":"low|medium|high"}]} — one entry per scene given.',
  contextRecipe(context, target): string | null {
    const withPurpose = target.sceneIds.filter((sceneId) => {
      const scene = context.scenes.find((held) => held.id === sceneId);
      return (scene?.purpose ?? []).length > 0 && (context.prose[sceneId] ?? "").length > 100;
    });
    if (withPurpose.length === 0) return null;
    return withPurpose
      .map((sceneId) => {
        const scene = context.scenes.find((held) => held.id === sceneId);
        return `SCENE ${sceneId}\nPLANNED PURPOSE\n${(scene?.purpose ?? []).map((line) => `- ${line}`).join("\n")}\nPROSE\n${excerpt(context.prose[sceneId] ?? "", 400)}`;
      })
      .join("\n\n");
  },
  outputSchema: PURPOSE_SCHEMA,
  interpret(parsed, context, target) {
    const findings: SemanticFindingDraft[] = [];
    for (const entry of parsed.scenes) {
      if (entry.accomplished || !target.sceneIds.includes(entry.sceneId) || entry.note === "")
        continue;
      const scene = context.scenes.find((held) => held.id === entry.sceneId);
      findings.push({
        category: "scene_purpose",
        kind: "model_judgement",
        message: `${sceneLabel(context, entry.sceneId)} may not accomplish its planned purpose.`,
        detail: entry.note,
        evidence: {
          sceneIds: [entry.sceneId],
          entities: [],
          notes: [entry.note, ...(scene?.purpose ?? []).map((line) => `Planned: ${line}`)],
        },
        confidence: asConfidence(entry.confidence),
        key: entry.sceneId,
      });
    }
    return { findings };
  },
});

// ── Character voice convergence (§3, §4) ─────────────────────────────────────

interface VoiceOutput {
  readonly pairs: readonly {
    readonly characters: readonly string[];
    readonly converging: boolean;
    readonly tendencies: readonly string[];
    readonly sceneIds: readonly string[];
    readonly confidence: string;
  }[];
}

const VOICE_SCHEMA: OutputSchema<VoiceOutput> = {
  name: "VoiceConvergence",
  parse(value: unknown): VoiceOutput {
    return {
      pairs: parseFindingList(value, "pairs").map((item) => ({
        characters: asStrings(item.characters),
        converging: item.converging === true,
        tendencies: asStrings(item.tendencies),
        sceneIds: asStrings(item.sceneIds),
        confidence: String(item.confidence ?? "low"),
      })),
    };
  },
};

export const voiceConvergence: SemanticCompilerRule = judgementRule<VoiceOutput>({
  id: "sem_voice_convergence",
  name: "Voice convergence",
  version: 1,
  category: "character_voice",
  description: "Major characters starting to sound like each other in dialogue.",
  instruction:
    'You compare how characters speak across scenes. Report a pair as converging ONLY with concrete shared tendencies (sentence shape, hesitation habits, vocabulary, rhythm) and the scenes showing them. Reply with JSON only: {"pairs":[{"characters":["ID_A","ID_B"],"converging":true,"tendencies":["…"],"sceneIds":["…"],"confidence":"low|medium|high"}]} — an empty list when voices stay distinct.',
  contextRecipe(context, target): string | null {
    // Deterministic pre-check: only characters with real dialogue presence in
    // scope are worth a model's reading.
    const appearances = new Map<string, string[]>();
    for (const sceneId of target.sceneIds) {
      const scene = context.scenes.find((held) => held.id === sceneId);
      for (const characterId of scene?.characterIds ?? []) {
        const held = appearances.get(characterId as string) ?? [];
        held.push(sceneId);
        appearances.set(characterId as string, held);
      }
    }
    const major = [...appearances.entries()]
      .filter(([, scenes]) => scenes.length >= 2)
      .map(([characterId]) => characterId)
      .slice(0, 4);
    if (major.length < 2) return null;
    const withDialogue = target.sceneIds.filter(
      (sceneId) => dialogueOf(context.prose[sceneId] ?? "").length >= 2,
    );
    if (withDialogue.length < 2) return null;
    const names = major
      .map((characterId) => {
        const character = context.characters.find((held) => held.id === characterId);
        return `${characterId}: ${character?.name ?? characterId}`;
      })
      .join("\n");
    const material = withDialogue
      .map((sceneId) => `SCENE ${sceneId}\n${excerpt(context.prose[sceneId] ?? "", 300)}`)
      .join("\n\n");
    return `CHARACTERS\n${names}\n\nSCENES WITH DIALOGUE\n${material}`;
  },
  outputSchema: VOICE_SCHEMA,
  interpret(parsed, context, target) {
    const findings: SemanticFindingDraft[] = [];
    for (const pair of parsed.pairs) {
      const sceneIds = realScenes(pair.sceneIds, target);
      const characters = pair.characters.filter((characterId) =>
        context.characters.some((held) => held.id === characterId),
      );
      // §4: no examples, no finding — a vague "they sound similar" is dropped.
      if (!pair.converging || characters.length < 2) continue;
      if (sceneIds.length === 0 || pair.tendencies.length === 0) continue;
      const names = characters.map(
        (characterId) =>
          context.characters.find((held) => held.id === characterId)?.name ?? characterId,
      );
      findings.push({
        category: "character_voice",
        kind: "model_judgement",
        message: `${names.join(" and ")} may be converging in voice.`,
        evidence: {
          sceneIds,
          entities: characters,
          notes: pair.tendencies.map((tendency) => `Shared tendency: ${tendency}`),
        },
        confidence: asConfidence(pair.confidence),
        key: characters.join("+"),
        suggestedAction:
          "Read their scenes aloud back to back; one distinct habit each usually separates them.",
      });
    }
    return { findings };
  },
});

// ── Dialogue (§3) ────────────────────────────────────────────────────────────

interface DialogueOutput {
  readonly findings: readonly {
    readonly sceneId: string;
    readonly issue: string;
    readonly quote: string;
    readonly note: string;
    readonly confidence: string;
  }[];
}

const DIALOGUE_SCHEMA: OutputSchema<DialogueOutput> = {
  name: "DialogueInspection",
  parse(value: unknown): DialogueOutput {
    return {
      findings: parseFindingList(value, "findings").map((item) => ({
        sceneId: String(item.sceneId ?? ""),
        issue: String(item.issue ?? ""),
        quote: String(item.quote ?? ""),
        note: String(item.note ?? ""),
        confidence: String(item.confidence ?? "low"),
      })),
    };
  },
};

const DIALOGUE_ISSUES: Readonly<Record<string, string>> = {
  exposition: "Dialogue may be carrying exposition the characters would not say.",
  emotional_explanation: "A character may be explaining their emotion instead of showing it.",
  information_transfer: "Information may be transferred unnaturally between characters.",
  similar_cadence: "Speakers in this scene may share too similar a cadence.",
};

export const dialogueInspection: SemanticCompilerRule = judgementRule<DialogueOutput>({
  id: "sem_dialogue",
  name: "Dialogue inspection",
  version: 1,
  category: "dialogue",
  description: "Exposition, explained emotion, unnatural transfer and shared cadence in dialogue.",
  instruction:
    'You inspect fiction dialogue for four specific problems: exposition ("as you know…"), direct emotional explanation ("I feel betrayed because…"), unnatural information transfer, and overly similar cadence between speakers. Every finding must quote the line. Reply with JSON only: {"findings":[{"sceneId":"…","issue":"exposition|emotional_explanation|information_transfer|similar_cadence","quote":"the offending line","note":"one sentence","confidence":"low|medium|high"}]} — an empty list when the dialogue works.',
  contextRecipe(context, target): string | null {
    const withDialogue = target.sceneIds.filter(
      (sceneId) => dialogueOf(context.prose[sceneId] ?? "").length >= 3,
    );
    if (withDialogue.length === 0) return null;
    return withDialogue
      .map((sceneId) => `SCENE ${sceneId}\n${excerpt(context.prose[sceneId] ?? "", 350)}`)
      .join("\n\n");
  },
  outputSchema: DIALOGUE_SCHEMA,
  interpret(parsed, context, target) {
    const findings: SemanticFindingDraft[] = [];
    for (const entry of parsed.findings) {
      const message = DIALOGUE_ISSUES[entry.issue];
      if (message === undefined || !target.sceneIds.includes(entry.sceneId)) continue;
      // §4: the quote is the evidence; a finding without one is not emitted.
      if (entry.quote === "" || !(context.prose[entry.sceneId] ?? "").includes(entry.quote))
        continue;
      findings.push({
        category: "dialogue",
        kind: "model_judgement",
        message,
        detail: entry.note,
        evidence: {
          sceneIds: [entry.sceneId],
          entities: [],
          notes: [`"${shorten(entry.quote)}"`, entry.note].filter((note) => note !== ""),
        },
        confidence: asConfidence(entry.confidence),
        key: `${entry.sceneId}:${entry.issue}:${entry.quote.slice(0, 24)}`,
      });
    }
    return { findings };
  },
});

// ── Motivation (§3, §10) ─────────────────────────────────────────────────────

interface MotivationOutput {
  readonly decisions: readonly {
    readonly decisionId: string;
    readonly supported: boolean;
    readonly note: string;
    readonly confidence: string;
  }[];
}

const MOTIVATION_SCHEMA: OutputSchema<MotivationOutput> = {
  name: "MotivationSupport",
  parse(value: unknown): MotivationOutput {
    return {
      decisions: parseFindingList(value, "decisions").map((item) => ({
        decisionId: String(item.decisionId ?? ""),
        supported: item.supported === true,
        note: String(item.note ?? ""),
        confidence: String(item.confidence ?? "low"),
      })),
    };
  },
};

/** Decisions in scope with no recorded cause — the cheap pre-check (§10). */
function unsupportedCandidates(context: SemanticBuildContext, target: SemanticTarget) {
  return context.decisions.filter((decision) => {
    if (decision.sceneId === undefined || !target.sceneIds.includes(decision.sceneId as string))
      return false;
    if (decision.reason !== undefined && decision.reason !== "") return false;
    return !context.dependencies.some(
      (dependency) => dependency.fromId === decision.id || dependency.toId === decision.id,
    );
  });
}

/** The plain judgement rule the simulator-aware wrapper below delegates to. */
const motivationBase = judgementRule<MotivationOutput>({
  id: "sem_motivation",
  name: "Decision motivation",
  version: 1,
  category: "motivation",
  description: "Character decisions that appear poorly supported by what the story established.",
  instruction:
    'You judge whether a character\'s recorded decision is supported by the scene it happens in. "Supported" means the prose shows pressure, reasoning or established motive; an unexplained swerve is unsupported. Reply with JSON only: {"decisions":[{"decisionId":"…","supported":true,"note":"one sentence citing the scene","confidence":"low|medium|high"}]} — one entry per decision given.',
  contextRecipe(context, target): string | null {
    const candidates = unsupportedCandidates(context, target);
    if (candidates.length === 0) return null;
    return candidates
      .map((decision) => {
        const character = context.characters.find((held) => held.id === decision.characterId);
        return `DECISION ${decision.id}\n${character?.name ?? (decision.characterId as string)} decides: ${decision.description}\nSCENE ${decision.sceneId ?? ""}\n${excerpt(context.prose[(decision.sceneId ?? "") as string] ?? "", 350)}`;
      })
      .join("\n\n");
  },
  outputSchema: MOTIVATION_SCHEMA,
  interpret(parsed, context, target) {
    const candidates = unsupportedCandidates(context, target);
    const findings: SemanticFindingDraft[] = [];
    for (const entry of parsed.decisions) {
      const decision = candidates.find((held) => held.id === entry.decisionId);
      if (decision === undefined || entry.supported || entry.note === "") continue;
      const character = context.characters.find((held) => held.id === decision.characterId);
      findings.push({
        category: "motivation",
        kind: "model_judgement",
        message: `${character?.name ?? (decision.characterId as string)}'s decision may be insufficiently motivated.`,
        detail: entry.note,
        evidence: {
          sceneIds: decision.sceneId === undefined ? [] : [decision.sceneId as string],
          entities: [decision.characterId as string, decision.id as string],
          notes: [
            `Decision: ${shorten(decision.description)}`,
            "No recorded reason and no causal dependency supports it.",
            entry.note,
          ],
        },
        confidence: asConfidence(entry.confidence),
        key: decision.id as string,
        suggestedAction:
          "Record the reason if it exists off the page, or seed the pressure earlier.",
      });
    }
    return { findings };
  },
});

/**
 * The motivation rule, with the §10 escalation: the Character Simulator is
 * asked only about decisions the model has ALREADY flagged — never wholesale,
 * because every ask is a paid call — and its reading joins the evidence,
 * labelled as the simulator's.
 */
export const motivationSupport: SemanticCompilerRule = {
  ...motivationBase,
  async run(context, target, model) {
    const base = await motivationBase.run(context, target, model);
    if (context.characterInsight === undefined) return base;
    const findings: SemanticFindingDraft[] = [];
    for (const draft of base.findings) {
      const characterId = draft.evidence.entities[0];
      const sceneId = draft.evidence.sceneIds[0];
      if (characterId === undefined || sceneId === undefined) {
        findings.push(draft);
        continue;
      }
      const insight = await context.characterInsight(characterId, sceneId).catch(() => null);
      findings.push(
        insight === null
          ? draft
          : {
              ...draft,
              evidence: {
                ...draft.evidence,
                notes: [...draft.evidence.notes, `Character Simulator: ${shorten(insight, 140)}`],
              },
            },
      );
    }
    return { findings, ...(base.note !== undefined ? { note: base.note } : {}) };
  },
};

// ── Foreshadowing obviousness (§3, §8) ───────────────────────────────────────

interface ForeshadowOutput {
  readonly setups: readonly {
    readonly setupId: string;
    readonly verdict: string;
    readonly note: string;
    readonly confidence: string;
  }[];
}

const FORESHADOW_SCHEMA: OutputSchema<ForeshadowOutput> = {
  name: "SetupVisibility",
  parse(value: unknown): ForeshadowOutput {
    return {
      setups: parseFindingList(value, "setups").map((item) => ({
        setupId: String(item.setupId ?? ""),
        verdict: String(item.verdict ?? ""),
        note: String(item.note ?? ""),
        confidence: String(item.confidence ?? "low"),
      })),
    };
  },
};

export const setupVisibility: SemanticCompilerRule = judgementRule<ForeshadowOutput>({
  id: "sem_foreshadow_visibility",
  name: "Setup visibility",
  version: 1,
  category: "foreshadowing",
  description: "Setups that read as too obvious, or so quiet a reader cannot register them.",
  instruction:
    'You judge whether planted setups land at their intended visibility. "too_obvious": a first-time reader would see the machinery. "possibly_invisible": nothing on the page would register at all. "as_intended": it works. Reply with JSON only: {"setups":[{"setupId":"…","verdict":"as_intended|too_obvious|possibly_invisible","note":"one sentence citing the prose","confidence":"low|medium|high"}]}.',
  contextRecipe(context, target): string | null {
    const inScope = context.setups.filter((setup) =>
      setup.setupSceneIds.some((sceneId) => target.sceneIds.includes(sceneId as string)),
    );
    if (inScope.length === 0) return null;
    // §8: genre adaptation without a global assumption — with the mystery
    // module on, visibility is framed as clue visibility and reader suspicion.
    const framing = context.modules.includes("mystery")
      ? "This is a mystery: judge each setup as a CLUE — would a genre-aware reader's suspicion land too early?\n\n"
      : "";
    return (
      framing +
      inScope
        .map((setup) => {
          const planted = setup.setupSceneIds.filter((sceneId) =>
            target.sceneIds.includes(sceneId as string),
          );
          return `SETUP ${setup.id} (intended: ${setup.subtlety})\n${setup.description}\n${planted
            .map(
              (sceneId) =>
                `SCENE ${sceneId as string}\n${excerpt(context.prose[sceneId as string] ?? "", 250)}`,
            )
            .join("\n")}`;
        })
        .join("\n\n")
    );
  },
  outputSchema: FORESHADOW_SCHEMA,
  interpret(parsed, context, target) {
    const findings: SemanticFindingDraft[] = [];
    for (const entry of parsed.setups) {
      const setup = context.setups.find((held) => held.id === entry.setupId);
      if (setup === undefined || entry.note === "") continue;
      if (entry.verdict !== "too_obvious" && entry.verdict !== "possibly_invisible") continue;
      const mystery = context.modules.includes("mystery");
      findings.push({
        category: "foreshadowing",
        kind: "model_judgement",
        message:
          entry.verdict === "too_obvious"
            ? mystery
              ? `A clue may be visible too early for its intended subtlety ("${setup.subtlety}").`
              : `A setup may be more obvious than its intended subtlety ("${setup.subtlety}").`
            : "A setup may be too quiet to register at all.",
        detail: entry.note,
        evidence: {
          sceneIds: setup.setupSceneIds
            .filter((sceneId) => target.sceneIds.includes(sceneId as string))
            .map((sceneId) => sceneId as string),
          entities: [setup.id as string],
          notes: [shorten(setup.description), entry.note],
        },
        confidence: asConfidence(entry.confidence),
        key: `${setup.id as string}:${entry.verdict}`,
      });
    }
    return { findings };
  },
});

export const JUDGEMENT_RULES: readonly SemanticCompilerRule[] = [
  tensionCurve,
  scenePurpose,
  voiceConvergence,
  dialogueInspection,
  motivationSupport,
  setupVisibility,
];
