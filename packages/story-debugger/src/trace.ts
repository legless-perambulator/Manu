import { traceContinuity } from "./continuity";
import { traceMotivation } from "./motivation";
import { tracePacing } from "./pacing";
import { snapshot } from "./project";
import type { DebugReader } from "./reader";
import { traceReveal } from "./reveal";
import { DebugError, type DebugRequest, type DebugTrace } from "./types";

/**
 * The deterministic half of a debug run.
 *
 * ```
 * problem → identify scope → retrieve evidence → trace the story systems
 * ```
 *
 * Everything up to and including the trace happens here, with no model
 * involved. That is deliberate and load-bearing: a project with no model
 * configured still gets a real report — scope, evidence, measurements — and the
 * model's contribution is visibly an addition to it rather than the substance
 * of it (docs/STORY_DEBUGGER.md).
 */
export async function traceProblem(
  request: DebugRequestInput | DebugRequest,
  reader: DebugReader,
): Promise<DebugTrace> {
  const checked = coerceRequest(request);
  const project = await snapshot(reader);

  switch (checked.mode) {
    case "reveal":
      return traceReveal(checked, project);
    case "character_motivation":
      return traceMotivation(checked, project);
    case "pacing":
      return tracePacing(checked, project);
    case "continuity":
      return traceContinuity(checked, project);
  }
}

/**
 * A request as it may arrive — from an agent, from a parsed command, from the
 * UI. Loose on purpose: the entry point validates it rather than trusting a
 * caller's types (AGENTS.md — structured output from a model is untrusted).
 */
export interface DebugRequestInput {
  readonly mode: string;
  readonly [field: string]: unknown;
}

const MODES = ["reveal", "character_motivation", "pacing", "continuity"];

/** Check the mode and the fields that mode cannot work without. */
export function coerceRequest(input: DebugRequestInput | DebugRequest): DebugRequest {
  const raw = input as Record<string, unknown>;
  const mode = typeof raw.mode === "string" ? raw.mode : "";
  const problem = typeof raw.problem === "string" ? raw.problem : "";
  const id = (field: string, prefix: string): string | undefined =>
    typeof raw[field] === "string" && (raw[field] as string).startsWith(prefix)
      ? (raw[field] as string)
      : undefined;
  const count = (field: string): number | undefined =>
    typeof raw[field] === "number" && Number.isFinite(raw[field]) && (raw[field] as number) > 0
      ? Math.floor(raw[field] as number)
      : undefined;

  switch (mode) {
    case "reveal": {
      const revealSceneId = id("revealSceneId", "SCENE_") ?? id("sceneId", "SCENE_");
      const characterId = id("characterId", "CHAR_");
      const threadId = id("threadId", "THREAD_");
      const factId = id("factId", "FACT_");
      if (
        revealSceneId === undefined &&
        characterId === undefined &&
        threadId === undefined &&
        factId === undefined
      ) {
        throw new DebugError(
          "nothing_to_trace",
          "Reveal debugging needs the reveal scene, or the character, thread or fact it turns on.",
        );
      }
      const lookBack = count("lookBack");
      return {
        mode,
        problem,
        ...(revealSceneId !== undefined ? { revealSceneId } : {}),
        ...(characterId !== undefined ? { characterId } : {}),
        ...(threadId !== undefined ? { threadId } : {}),
        ...(factId !== undefined ? { factId } : {}),
        ...(lookBack !== undefined ? { lookBack } : {}),
      };
    }

    case "character_motivation": {
      const characterId = id("characterId", "CHAR_");
      const sceneId = id("sceneId", "SCENE_");
      if (characterId === undefined || sceneId === undefined) {
        throw new DebugError(
          "nothing_to_trace",
          "Motivation debugging needs both a character (CHAR_…) and the scene the decision happens in (SCENE_…).",
        );
      }
      const lookBack = count("lookBack");
      return {
        mode,
        problem,
        characterId,
        sceneId,
        ...(lookBack !== undefined ? { lookBack } : {}),
      };
    }

    case "pacing": {
      const chapterId = id("chapterId", "CHAPTER_");
      const fromChapterId = id("fromChapterId", "CHAPTER_");
      const toChapterId = id("toChapterId", "CHAPTER_");
      return {
        mode,
        problem,
        ...(chapterId !== undefined ? { chapterId } : {}),
        ...(fromChapterId !== undefined ? { fromChapterId } : {}),
        ...(toChapterId !== undefined ? { toChapterId } : {}),
      };
    }

    case "continuity": {
      const diagnosticId = id("diagnosticId", "DIAG_");
      if (diagnosticId === undefined) {
        throw new DebugError(
          "nothing_to_trace",
          "Continuity debugging starts from a build diagnostic (DIAG_…). Run a Story Build and name one of its findings.",
        );
      }
      const buildId = id("buildId", "BUILD_");
      return {
        mode,
        ...(problem === "" ? {} : { problem }),
        diagnosticId,
        ...(buildId !== undefined ? { buildId } : {}),
      };
    }

    default:
      throw new DebugError(
        "unknown_mode",
        `There is no debugging mode called "${mode}". Modes: ${MODES.join(", ")}.`,
        { mode },
      );
  }
}
