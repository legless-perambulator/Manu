import { objectSchema } from "../schema";
import { eraseTool, type RegisteredTool, type Tool } from "../tool";
import { ToolError } from "../errors";
import type { DebugRequestLike, ProjectAccess } from "../ports";

/**
 * Story Debugger tools.
 *
 * These give an agent the *investigation*, not the answer: scope, evidence and
 * measurements retrieved from the project's own systems. What that evidence
 * means is the agent's job — routing it through a second model would put an
 * opinion between the agent and the record, and the whole point of the debugger
 * is that its evidence is deterministic (docs/STORY_DEBUGGER.md).
 *
 * Read and run only. Nothing here applies an intervention: the debugger
 * diagnoses, and acting on a diagnosis is an editorial decision that stays with
 * a human.
 */

const MODES = "reveal, character_motivation, pacing, continuity";

export function runStoryDebugTool(access: ProjectAccess): Tool<
  {
    mode: string;
    problem?: string;
    characterId?: string;
    sceneId?: string;
    chapterId?: string;
    threadId?: string;
    factId?: string;
    diagnosticId?: string;
  },
  unknown
> {
  return {
    name: "run_story_debug",
    description: `Investigate a narrative problem and return the deterministic evidence: what was inspected, what the project records, and what was measured. Modes: ${MODES}. Interpreting the evidence is your job — the trace states facts, not conclusions. Changes nothing about the story.`,
    permission: "read_canon",
    inputSchema: objectSchema("RunStoryDebugInput", {
      mode: { type: "string", description: `One of: ${MODES}.` },
      problem: {
        type: "string",
        description: "The problem in the writer's own words, when they stated one.",
        optional: true,
      },
      characterId: {
        type: "string",
        description:
          "CHAR_ id. For reveal: whose reveal it is. For character_motivation: whose decision it is (required).",
        optional: true,
      },
      sceneId: {
        type: "string",
        description:
          "SCENE_ id. For reveal: the reveal scene. For character_motivation: where the decision happens (required).",
        optional: true,
      },
      chapterId: {
        type: "string",
        description: "CHAPTER_ id. For pacing: one chapter. Omit to measure the whole book.",
        optional: true,
      },
      threadId: { type: "string", description: "THREAD_ id, for reveal.", optional: true },
      factId: {
        type: "string",
        description: "FACT_ id — the proposition being revealed, for reveal.",
        optional: true,
      },
      diagnosticId: {
        type: "string",
        description: "DIAG_ id from a Story Build. Required for continuity.",
        optional: true,
      },
    }),
    outputSchema: objectSchema("RunStoryDebugOutput", {
      mode: { type: "string", description: "The mode that ran." },
      problem: { type: "string", description: "The problem investigated." },
      scope: { type: "object", description: "What was inspected, and what was not." },
      evidence: {
        type: "object[]",
        description: "Deterministic evidence, each with an ID you can cite.",
      },
      measurements: { type: "object[]", description: "Counts, with how each was arrived at." },
    }),
    async handler(input) {
      if (access.traceStoryProblem === undefined) {
        throw new ToolError(
          "tool_failed",
          "run_story_debug",
          "This project does not support debugging.",
        );
      }

      const request: DebugRequestLike = {
        mode: input.mode,
        ...(input.problem !== undefined ? { problem: input.problem } : {}),
        ...(input.characterId !== undefined ? { characterId: input.characterId } : {}),
        ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
        ...(input.factId !== undefined ? { factId: input.factId } : {}),
        ...(input.chapterId !== undefined ? { chapterId: input.chapterId } : {}),
        ...(input.diagnosticId !== undefined ? { diagnosticId: input.diagnosticId } : {}),
        // A reveal names its scene differently from a motivation debug, so the
        // one field an agent supplies is mapped to what the mode expects.
        ...(input.sceneId !== undefined
          ? input.mode === "reveal"
            ? { revealSceneId: input.sceneId }
            : { sceneId: input.sceneId }
          : {}),
      };

      const trace = await access.traceStoryProblem(request);
      return {
        mode: trace.mode,
        problem: trace.problem,
        scope: trace.scope,
        evidence: trace.evidence,
        measurements: trace.measurements,
      };
    },
  };
}

export function listDebugReportsTool(access: ProjectAccess): Tool<{ limit?: number }, unknown> {
  return {
    name: "list_debug_reports",
    description:
      "List past debug investigations of this project: what was asked, when, and whether anything interpreted the evidence.",
    permission: "read_canon",
    inputSchema: objectSchema("ListDebugReportsInput", {
      limit: { type: "number", description: "How many, newest first.", optional: true },
    }),
    outputSchema: objectSchema("ListDebugReportsOutput", {
      reports: { type: "object[]", description: "Report summaries, newest first." },
    }),
    async handler(input) {
      if (access.listDebugReports === undefined) {
        throw new ToolError(
          "tool_failed",
          "list_debug_reports",
          "This project does not support debugging.",
        );
      }
      return { reports: await access.listDebugReports(input.limit) };
    },
  };
}

export function getDebugReportTool(access: ProjectAccess): Tool<{ id: string }, unknown> {
  return {
    name: "get_debug_report",
    description:
      "Read a stored debug report: its evidence, its measurements, and — if one was made — the diagnosis and proposed interventions. A diagnosis is a model's reading, not a fact about the story.",
    permission: "read_canon",
    inputSchema: objectSchema("GetDebugReportInput", {
      id: { type: "string", description: "Report ID, e.g. DEBUG_0001." },
    }),
    outputSchema: objectSchema("GetDebugReportOutput", {
      report: { type: "object", description: "The stored report." },
    }),
    async handler(input) {
      if (access.getDebugReport === undefined) {
        throw new ToolError(
          "tool_failed",
          "get_debug_report",
          "This project does not support debugging.",
        );
      }
      const report = await access.getDebugReport(input.id);
      if (report === null) {
        throw new ToolError(
          "tool_failed",
          "get_debug_report",
          `No debug report with ID ${input.id}.`,
        );
      }
      return { report };
    },
  };
}

/** The debugger tools, when the project supports them. */
export function createDebugTools(access: ProjectAccess): RegisteredTool[] {
  if (access.traceStoryProblem === undefined) return [];
  return [
    eraseTool(runStoryDebugTool(access)),
    eraseTool(listDebugReportsTool(access)),
    eraseTool(getDebugReportTool(access)),
  ];
}

export const DEBUG_TOOL_NAMES: readonly string[] = [
  "run_story_debug",
  "list_debug_reports",
  "get_debug_report",
];
