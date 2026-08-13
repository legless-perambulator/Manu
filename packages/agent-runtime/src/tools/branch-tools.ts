import { objectSchema } from "../schema";
import { type Tool } from "../tool";
import { ToolError } from "../errors";
import type { ProjectAccess } from "../ports";

/**
 * Story branching tools.
 *
 * An agent may look at the alternative versions, take a new one, move between
 * them and compare them. It may **not** delete one: a version is a body of work
 * a writer chose to keep, and there is no undo for removing it. Deletion stays
 * behind an explicit human confirmation in the interface
 * (docs/VERSIONING.md).
 */

export function listBranchesTool(access: ProjectAccess): Tool<Record<string, never>, unknown> {
  return {
    name: "list_branches",
    description:
      "List the project's alternative versions, which one is current, and what each was taken from.",
    permission: "read_canon",
    inputSchema: objectSchema("ListBranchesInput", {}),
    outputSchema: objectSchema("ListBranchesOutput", {
      current: { type: "string", description: "The version being written on." },
      versions: { type: "object[]", description: "Every version: id, name, description, parent." },
    }),
    async handler() {
      const branches = must(access.listBranches, "list_branches");
      const all = await branches();
      const current = await must(access.currentBranch, "list_branches")();
      return {
        current: current.name,
        versions: all.map((b) => ({
          id: b.id,
          name: b.name,
          description: b.description ?? "",
          parent: b.parentBranchId ?? null,
          status: b.status,
          isCurrent: b.id === current.id,
        })),
      };
    },
  };
}

export function createBranchTool(
  access: ProjectAccess,
): Tool<{ name: string; description?: string }, unknown> {
  return {
    name: "create_branch",
    description:
      "Take a new alternative version from the current one. This copies the story as it stands and changes nothing in it — making the alternative actually different is separate work, done after switching to it.",
    permission: "create_branches",
    inputSchema: objectSchema("CreateBranchInput", {
      name: {
        type: "string",
        description: 'A short name, e.g. "darker-ending" or "marcus-survives".',
      },
      description: {
        type: "string",
        description: "What this version is for, in the writer's terms.",
        optional: true,
      },
    }),
    outputSchema: objectSchema("CreateBranchOutput", {
      id: { type: "string", description: "The new version's stable ID." },
      name: { type: "string", description: "Its name." },
      note: { type: "string", description: "What was and was not done." },
    }),
    async handler(input) {
      const create = must(access.createBranch, "create_branch");
      const branch = await create(input.name, input.description);
      return {
        id: branch.id,
        name: branch.name,
        note: `Created "${branch.name}" from the current version. Nothing in the story has changed yet — switch to it to work there.`,
      };
    },
  };
}

export function switchBranchTool(access: ProjectAccess): Tool<{ branchId: string }, unknown> {
  return {
    name: "switch_branch",
    description:
      "Make a different version the current one. Everything after this — reading, building, editing — happens on that version.",
    permission: "create_branches",
    inputSchema: objectSchema("SwitchBranchInput", {
      branchId: { type: "string", description: "BRANCH_ id, from list_branches." },
    }),
    outputSchema: objectSchema("SwitchBranchOutput", {
      name: { type: "string", description: "The version now current." },
    }),
    async handler(input) {
      const switchTo = must(access.switchBranch, "switch_branch");
      const branch = await switchTo(input.branchId);
      return { name: branch.name };
    },
  };
}

export function compareBranchesTool(
  access: ProjectAccess,
): Tool<{ fromBranchId: string; toBranchId: string }, unknown> {
  return {
    name: "compare_branches",
    description:
      "Compare two versions: which manuscript files differ and by how much, and which structured records were added, removed or changed.",
    permission: "read_canon",
    inputSchema: objectSchema("CompareBranchesInput", {
      fromBranchId: { type: "string", description: "BRANCH_ id to compare from." },
      toBranchId: { type: "string", description: "BRANCH_ id to compare to." },
    }),
    outputSchema: objectSchema("CompareBranchesOutput", {
      summary: { type: "string", description: "One line." },
      manuscript: { type: "object[]", description: "Files that differ, with line counts." },
      records: { type: "object[]", description: "Records that differ, by stable ID." },
      inspected: {
        type: "string[]",
        description: "What was compared, so silence means no difference rather than not looked at.",
      },
    }),
    async handler(input) {
      const compare = must(access.compareBranches, "compare_branches");
      const result = await compare(input.fromBranchId, input.toBranchId);
      return {
        summary: result.summary,
        manuscript: result.manuscript,
        records: result.records,
        inspected: result.inspected,
      };
    },
  };
}

function must<T>(fn: T | undefined, tool: string): T {
  if (fn === undefined) {
    throw new ToolError("tool_failed", tool, "This project does not support alternative versions.");
  }
  return fn;
}
