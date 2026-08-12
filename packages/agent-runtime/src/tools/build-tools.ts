import { objectSchema } from "../schema";
import { eraseTool, type RegisteredTool, type Tool } from "../tool";
import { ToolError } from "../errors";
import type { ProjectAccess } from "../ports";

/**
 * Story Build tools.
 *
 * An agent can run the build and read what it found, which is what makes an
 * investigating agent able to answer "is this project consistent?" the same way
 * a writer does — from deterministic diagnostics rather than by re-reading the
 * manuscript and forming an opinion.
 *
 * Deliberately **read and run only**. There is no tool that applies a fix: a
 * diagnostic is a finding about the writer's story, and acting on one is an
 * editorial decision that belongs to a human until the workflow for reviewing
 * such changes exists (docs/STORY_COMPILER.md, docs/AGENT_TOOLS.md).
 */

export function runStoryBuildTool(
  access: ProjectAccess,
): Tool<{ dormantAfterScenes?: number }, unknown> {
  return {
    name: "run_story_build",
    description:
      "Run the Story Build: deterministic continuity checks over the project's structured state. Returns the build's status, counts and diagnostics. Changes nothing about the story.",
    permission: "read_canon",
    inputSchema: objectSchema("RunStoryBuildInput", {
      dormantAfterScenes: {
        type: "number",
        description:
          "Optional. Report plot threads quiet for at least this many scenes. Omit to leave dormancy unreported — there is no sensible default.",
        optional: true,
      },
    }),
    outputSchema: objectSchema("RunStoryBuildOutput", {
      build: { type: "object", description: "The build: status, counts, rules and diagnostics." },
    }),
    async handler(input) {
      if (access.buildStory === undefined) {
        throw new ToolError(
          "tool_failed",
          "run_story_build",
          "This project does not support building.",
        );
      }
      const build = await access.buildStory(
        input.dormantAfterScenes === undefined
          ? {}
          : { config: { options: { dormantAfterScenes: input.dormantAfterScenes } } },
      );
      return { build };
    },
  };
}

export function getBuildDiagnosticsTool(
  access: ProjectAccess,
): Tool<{ buildId?: string; severity?: string; ruleId?: string }, unknown> {
  return {
    name: "get_build_diagnostics",
    description:
      "Read the diagnostics from a past Story Build, optionally filtered by severity (error/warning/info) or rule. Omit buildId for the most recent build.",
    permission: "read_canon",
    inputSchema: objectSchema("GetBuildDiagnosticsInput", {
      buildId: {
        type: "string",
        description: "Build ID, e.g. BUILD_0284. Omit for the latest build.",
        optional: true,
      },
      severity: {
        type: "string",
        description: "Optional filter: error, warning or info.",
        optional: true,
      },
      ruleId: { type: "string", description: "Optional filter: a rule ID.", optional: true },
    }),
    outputSchema: objectSchema("GetBuildDiagnosticsOutput", {
      buildId: { type: "string", description: "The build the diagnostics came from." },
      status: { type: "string", description: "passed, passed_with_warnings or failed." },
      diagnostics: { type: "object[]", description: "The matching diagnostics." },
    }),
    async handler(input) {
      if (access.getBuild === undefined || access.getLatestBuild === undefined) {
        throw new ToolError(
          "tool_failed",
          "get_build_diagnostics",
          "This project does not support building.",
        );
      }

      const build =
        input.buildId === undefined
          ? await access.getLatestBuild()
          : await access.getBuild(input.buildId);

      if (build === null) {
        throw new ToolError(
          "tool_failed",
          "get_build_diagnostics",
          input.buildId === undefined
            ? "This project has no builds yet. Run run_story_build first."
            : `No build with id ${input.buildId}.`,
        );
      }

      const diagnostics = build.diagnostics.filter(
        (d) =>
          (input.severity === undefined || d.severity === input.severity) &&
          (input.ruleId === undefined || d.ruleId === input.ruleId),
      );
      return { buildId: build.id, status: build.status, diagnostics };
    },
  };
}

/** The build tools, when the project supports building. */
export function createBuildTools(access: ProjectAccess): RegisteredTool[] {
  if (access.buildStory === undefined) return [];
  return [eraseTool(runStoryBuildTool(access)), eraseTool(getBuildDiagnosticsTool(access))];
}

export const BUILD_TOOL_NAMES: readonly string[] = ["run_story_build", "get_build_diagnostics"];
