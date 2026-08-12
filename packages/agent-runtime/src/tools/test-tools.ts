import { objectSchema } from "../schema";
import { eraseTool, type RegisteredTool, type Tool } from "../tool";
import { ToolError } from "../errors";
import type { ProjectAccess } from "../ports";

/**
 * Story-test tools.
 *
 * These let an agent see what the writer has *declared* about their own story,
 * which is a different and better source than the agent's reading of the prose:
 * "Elias must not know the killer's identity before chapter 37" is an intention
 * stated by the person who owns it (docs/STORY_TESTS.md).
 *
 * Read and run only. An agent may not write a test — an assertion about what a
 * story must be is the author's to make — and there is no tool that repairs a
 * failing one.
 */

export function listStoryTestsTool(access: ProjectAccess): Tool<Record<string, never>, unknown> {
  return {
    name: "list_story_tests",
    description:
      "List the writer's story tests: their assertions about what must or must not be true at points in the story. Deterministic tests are decided from recorded state; semantic ones are not yet evaluated.",
    permission: "read_canon",
    inputSchema: objectSchema("ListStoryTestsInput", {}),
    outputSchema: objectSchema("ListStoryTestsOutput", {
      tests: { type: "object[]", description: "The story tests." },
    }),
    async handler() {
      if (access.listStoryTests === undefined) {
        throw new ToolError(
          "tool_failed",
          "list_story_tests",
          "This project does not support story tests.",
        );
      }
      return { tests: await access.listStoryTests() };
    },
  };
}

export function runStoryTestsTool(access: ProjectAccess): Tool<Record<string, never>, unknown> {
  return {
    name: "run_story_tests",
    description:
      "Run the writer's story tests and return the result of each. Changes nothing about the story. Semantic tests come back as not evaluated, never as passing.",
    permission: "read_canon",
    inputSchema: objectSchema("RunStoryTestsInput", {}),
    outputSchema: objectSchema("RunStoryTestsOutput", {
      deterministic: { type: "object", description: "Totals for the deterministic suite." },
      semantic: { type: "object", description: "Totals for the semantic suite." },
      results: { type: "object[]", description: "Every test's result." },
    }),
    async handler() {
      if (access.runStoryTests === undefined) {
        throw new ToolError(
          "tool_failed",
          "run_story_tests",
          "This project does not support story tests.",
        );
      }
      const run = await access.runStoryTests();
      return { deterministic: run.deterministic, semantic: run.semantic, results: run.results };
    },
  };
}

export function getFailedStoryTestsTool(
  access: ProjectAccess,
): Tool<Record<string, never>, unknown> {
  return {
    name: "get_failed_story_tests",
    description:
      "Run the story tests and return only the ones that failed, with where each failed, what was expected and what the project actually records.",
    permission: "read_canon",
    inputSchema: objectSchema("GetFailedStoryTestsInput", {}),
    outputSchema: objectSchema("GetFailedStoryTestsOutput", {
      failed: { type: "object[]", description: "Failing tests, with their failures." },
      passed: { type: "number", description: "How many deterministic tests passed." },
      total: { type: "number", description: "How many deterministic tests ran." },
    }),
    async handler() {
      if (access.runStoryTests === undefined) {
        throw new ToolError(
          "tool_failed",
          "get_failed_story_tests",
          "This project does not support story tests.",
        );
      }
      const run = await access.runStoryTests();
      return {
        failed: run.results.filter((r) => r.status === "failed"),
        passed: run.deterministic.passed,
        total: run.deterministic.total,
      };
    },
  };
}

/** The story-test tools, when the project supports them. */
export function createTestTools(access: ProjectAccess): RegisteredTool[] {
  if (access.listStoryTests === undefined) return [];
  return [
    eraseTool(listStoryTestsTool(access)),
    eraseTool(runStoryTestsTool(access)),
    eraseTool(getFailedStoryTestsTool(access)),
  ];
}

export const TEST_TOOL_NAMES: readonly string[] = [
  "list_story_tests",
  "run_story_tests",
  "get_failed_story_tests",
];
