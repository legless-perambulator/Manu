import { ARTIFACT_KINDS, REVIEW_STANCES } from "@jellytind/domain";
import type { ArtifactKind, Disagreement, ReviewNote, ReviewStance } from "@jellytind/domain";
import { OrchestrationError } from "./types";

/**
 * The handoffs.
 *
 * Every artifact has a shape, and a payload that does not match it is
 * **rejected before it becomes a handoff**. That is the rule that keeps a
 * malformed model response from becoming the thing the next agent works from,
 * and from ever reaching project state (AGENTS.md — "Structured LLM Output").
 *
 * The three reviewing artifacts share one note shape on purpose: it is what
 * lets the merge step compare a Character Editor's position with a Continuity
 * Editor's and find where they disagree.
 */

export interface ChapterBrief {
  readonly chapterId: string;
  readonly premise: string;
  readonly mustAchieve: readonly string[];
  readonly constraints: readonly string[];
  readonly threads: readonly string[];
  readonly risks: readonly string[];
}

export interface PlannedScene {
  readonly title: string;
  readonly objective: string;
  readonly conflict: string;
  readonly beats: readonly string[];
  readonly reversal?: string;
  readonly characterIds: readonly string[];
}

export interface ScenePlan {
  readonly chapterId: string;
  readonly scenes: readonly PlannedScene[];
}

export interface Draft {
  readonly chapterId: string;
  readonly prose: string;
  readonly wordCount: number;
}

/** What the three reviewers produce, and what the merge compares. */
export interface ReviewArtifact {
  readonly notes: readonly ReviewNote[];
  readonly basis?: string;
}

export interface MergedReview {
  readonly notes: readonly ReviewNote[];
  readonly disagreements: readonly Disagreement[];
  readonly byAgent: Readonly<Record<string, number>>;
}

export interface RevisionProposal {
  readonly changes: ReadonlyArray<{
    readonly target: string;
    readonly statement: string;
    readonly rationale?: string;
  }>;
}

export interface BuildResult {
  readonly buildId: string;
  readonly status: string;
  readonly errors: number;
  readonly warnings: number;
  readonly diagnostics: ReadonlyArray<{ ruleId: string; message: string; sceneId?: string }>;
}

// ── Coercion ────────────────────────────────────────────────────────────────

const asObject = (value: unknown, kind: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OrchestrationError("invalid_artifact", `${kind}: expected an object.`, {
      details: { kind },
    });
  }
  return value as Record<string, unknown>;
};

const requireText = (value: unknown, kind: string, field: string): string => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") {
    throw new OrchestrationError("invalid_artifact", `${kind}: "${field}" is required.`, {
      details: { kind, field },
    });
  }
  return text;
};

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    : [];

const stance = (value: unknown): ReviewStance =>
  typeof value === "string" && (REVIEW_STANCES as readonly string[]).includes(value)
    ? (value as ReviewStance)
    : // An unreadable stance is a flag, not a recommendation to cut something.
      "flag";

function notesOf(value: unknown, kind: string): ReviewNote[] {
  if (!Array.isArray(value)) {
    throw new OrchestrationError("invalid_artifact", `${kind}: "notes" must be a list.`);
  }
  const out: ReviewNote[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const statement = typeof raw.statement === "string" ? raw.statement.trim() : "";
    const target = typeof raw.target === "string" ? raw.target.trim() : "";
    // A note about nothing, or with nothing to say, is not a note.
    if (statement === "" || target === "") continue;
    out.push({
      target,
      stance: stance(raw.stance),
      statement,
      ...(typeof raw.detail === "string" && raw.detail.trim() !== ""
        ? { detail: raw.detail.trim() }
        : {}),
      ...(typeof raw.basis === "string" && raw.basis.trim() !== ""
        ? { basis: raw.basis.trim() }
        : {}),
    });
  }
  return out;
}

const PARSERS: Readonly<Record<ArtifactKind, (value: unknown) => unknown>> = {
  chapter_brief: (value) => {
    const raw = asObject(value, "chapter_brief");
    return {
      chapterId: requireText(raw.chapterId, "chapter_brief", "chapterId"),
      premise: requireText(raw.premise, "chapter_brief", "premise"),
      mustAchieve: strings(raw.mustAchieve),
      constraints: strings(raw.constraints),
      threads: strings(raw.threads),
      risks: strings(raw.risks),
    } satisfies ChapterBrief;
  },

  scene_plan: (value) => {
    const raw = asObject(value, "scene_plan");
    if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) {
      throw new OrchestrationError(
        "invalid_artifact",
        'scene_plan: "scenes" must list at least one scene.',
      );
    }
    const scenes = raw.scenes.map((entry, index) => {
      const scene = asObject(entry, `scene_plan.scenes[${String(index)}]`);
      return {
        title: requireText(scene.title, "scene_plan", `scenes[${String(index)}].title`),
        objective: requireText(scene.objective, "scene_plan", `scenes[${String(index)}].objective`),
        conflict: typeof scene.conflict === "string" ? scene.conflict.trim() : "",
        beats: strings(scene.beats),
        ...(typeof scene.reversal === "string" && scene.reversal.trim() !== ""
          ? { reversal: scene.reversal.trim() }
          : {}),
        characterIds: strings(scene.characterIds).filter((id) => id.startsWith("CHAR_")),
      } satisfies PlannedScene;
    });
    return { chapterId: requireText(raw.chapterId, "scene_plan", "chapterId"), scenes };
  },

  draft: (value) => {
    const raw = asObject(value, "draft");
    const prose = requireText(raw.prose, "draft", "prose");
    return {
      chapterId: requireText(raw.chapterId, "draft", "chapterId"),
      prose,
      wordCount: (prose.match(/\S+/g) ?? []).length,
    } satisfies Draft;
  },

  character_notes: (value) => reviewOf(value, "character_notes"),
  continuity_report: (value) => reviewOf(value, "continuity_report"),
  prose_notes: (value) => reviewOf(value, "prose_notes"),

  merged_review: (value) => {
    const raw = asObject(value, "merged_review");
    return {
      notes: notesOf(raw.notes, "merged_review"),
      disagreements: Array.isArray(raw.disagreements) ? (raw.disagreements as Disagreement[]) : [],
      byAgent:
        typeof raw.byAgent === "object" && raw.byAgent !== null
          ? (raw.byAgent as Record<string, number>)
          : {},
    } satisfies MergedReview;
  },

  revision_proposal: (value) => {
    const raw = asObject(value, "revision_proposal");
    if (!Array.isArray(raw.changes)) {
      throw new OrchestrationError(
        "invalid_artifact",
        'revision_proposal: "changes" must be a list.',
      );
    }
    return {
      changes: raw.changes
        .filter(
          (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
        )
        .map((entry) => ({
          target: requireText(entry.target, "revision_proposal", "changes[].target"),
          statement: requireText(entry.statement, "revision_proposal", "changes[].statement"),
          ...(typeof entry.rationale === "string" && entry.rationale.trim() !== ""
            ? { rationale: entry.rationale.trim() }
            : {}),
        })),
    } satisfies RevisionProposal;
  },

  build_result: (value) => {
    const raw = asObject(value, "build_result");
    return {
      buildId: requireText(raw.buildId, "build_result", "buildId"),
      status: requireText(raw.status, "build_result", "status"),
      errors: typeof raw.errors === "number" ? raw.errors : 0,
      warnings: typeof raw.warnings === "number" ? raw.warnings : 0,
      diagnostics: Array.isArray(raw.diagnostics)
        ? (raw.diagnostics as BuildResult["diagnostics"])
        : [],
    } satisfies BuildResult;
  },
};

function reviewOf(value: unknown, kind: string): ReviewArtifact {
  const raw = asObject(value, kind);
  return {
    notes: notesOf(raw.notes, kind),
    ...(typeof raw.basis === "string" && raw.basis.trim() !== ""
      ? { basis: raw.basis.trim() }
      : {}),
  };
}

/**
 * Validate a payload for its kind, or refuse it.
 *
 * Called before the payload becomes an artifact, so a step whose output does
 * not fit its declared shape **fails** — and can be retried — rather than
 * handing the next agent something it cannot read.
 */
export function parseArtifact(kind: ArtifactKind, payload: unknown): unknown {
  const parser = PARSERS[kind];
  /* istanbul ignore next — ArtifactKind is closed over PARSERS. */
  if (parser === undefined) {
    throw new OrchestrationError("invalid_artifact", `Unknown artifact kind "${kind}".`);
  }
  return parser(payload);
}

/** True when a kind carries review notes the merge step can compare. */
export function isReviewKind(kind: ArtifactKind): boolean {
  return kind === "character_notes" || kind === "continuity_report" || kind === "prose_notes";
}

export const ALL_ARTIFACT_KINDS = ARTIFACT_KINDS;

/**
 * What each artifact must look like, in the words a model is given.
 *
 * The shape and its description live together on purpose: an executor that
 * wrote its own format string could drift from what `parseArtifact` accepts,
 * and the drift would show up as a step that fails for no visible reason.
 */
const REVIEW_FORMAT = `{
  "notes": [
    {
      "target": "SCENE_0012 or CHAR_0003 — what the note is about",
      "stance": "${REVIEW_STANCES.join(" | ")}",
      "statement": "one sentence",
      "detail": "one sentence more, optional",
      "basis": "what this rests on, optional"
    }
  ]
}
Use "keep" when something should stay as it is, "revise" when it should change,
"cut" when it should go, and "flag" when you are raising it without asking for
anything. Another specialist may disagree with you; say what you think.`;

export const ARTIFACT_FORMATS: Readonly<Record<ArtifactKind, string>> = {
  chapter_brief: `{
  "chapterId": "CHAPTER_0017",
  "premise": "one sentence: what this chapter is",
  "mustAchieve": ["what it has to accomplish in the book"],
  "constraints": ["what it must not do"],
  "threads": ["THREAD_0001"],
  "risks": ["what could go wrong"]
}`,
  scene_plan: `{
  "chapterId": "CHAPTER_0017",
  "scenes": [
    {
      "title": "short scene title",
      "objective": "what the scene is for",
      "conflict": "what is in the way",
      "beats": ["what happens, in order"],
      "reversal": "what changes, optional",
      "characterIds": ["CHAR_0001"]
    }
  ]
}`,
  draft: `{
  "chapterId": "CHAPTER_0017",
  "prose": "the chapter, as prose. No headings, no notes, no commentary."
}`,
  character_notes: REVIEW_FORMAT,
  continuity_report: REVIEW_FORMAT,
  prose_notes: REVIEW_FORMAT,
  merged_review: REVIEW_FORMAT,
  revision_proposal: `{
  "changes": [
    { "target": "SCENE_0012", "statement": "what to change", "rationale": "why" }
  ]
}`,
  build_result: `{ "buildId": "BUILD_0001", "status": "passed", "errors": 0, "warnings": 0, "diagnostics": [] }`,
};

/**
 * One artifact, rendered for the next agent to read.
 *
 * A handoff is given as a structured document, not as a transcript of what the
 * previous agent said while producing it.
 */
export function renderArtifact(kind: ArtifactKind, payload: unknown): string {
  const lines: string[] = [`--- ${kind.toUpperCase().replace(/_/g, " ")}`];
  const raw = payload as Record<string, unknown>;

  switch (kind) {
    case "chapter_brief": {
      const brief = raw as unknown as ChapterBrief;
      lines.push(`Premise: ${brief.premise}`);
      for (const item of brief.mustAchieve) lines.push(`Must achieve: ${item}`);
      for (const item of brief.constraints) lines.push(`Constraint: ${item}`);
      for (const item of brief.risks) lines.push(`Risk: ${item}`);
      break;
    }
    case "scene_plan": {
      const plan = raw as unknown as ScenePlan;
      for (const [index, scene] of plan.scenes.entries()) {
        lines.push(`${String(index + 1)}. ${scene.title} — ${scene.objective}`);
        if (scene.conflict !== "") lines.push(`   Conflict: ${scene.conflict}`);
        for (const beat of scene.beats) lines.push(`   · ${beat}`);
        if (scene.reversal !== undefined) lines.push(`   Reversal: ${scene.reversal}`);
      }
      break;
    }
    case "draft": {
      const draft = raw as unknown as Draft;
      lines.push(`${String(draft.wordCount)} words`);
      lines.push(draft.prose);
      break;
    }
    case "build_result": {
      const build = raw as unknown as BuildResult;
      lines.push(`Build ${build.buildId}: ${build.status}`);
      for (const diagnostic of build.diagnostics.slice(0, 30)) {
        lines.push(`- ${diagnostic.ruleId}: ${diagnostic.message}`);
      }
      break;
    }
    default: {
      const notes = (raw.notes ?? []) as readonly ReviewNote[];
      for (const note of notes) {
        lines.push(`- [${note.stance}] ${note.target}: ${note.statement}`);
        if (note.detail !== undefined) lines.push(`    ${note.detail}`);
      }
      const disagreements = (raw.disagreements ?? []) as readonly Disagreement[];
      for (const item of disagreements) {
        lines.push(
          `! Disagreement on ${item.target}: ${item.positions
            .map((position) => `${position.agent} says ${position.stance}`)
            .join(", ")}`,
        );
      }
    }
  }
  return lines.join("\n");
}
