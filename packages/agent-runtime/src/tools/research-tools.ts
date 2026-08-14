import { objectSchema } from "../schema";
import { eraseTool, type RegisteredTool, type Tool } from "../tool";
import { ToolError } from "../errors";
import type { ProjectAccess, ResearchItemLike } from "../ports";

/**
 * Research tools (Phase 35 §6, §25).
 *
 * Agents may read the library, search it, and — under the `run_research`
 * permission — file structured research items with provenance. The boundary
 * that matters: research is **not canon**, and nothing here can touch canon.
 * There is no delete tool, no canonise tool, and no way to turn a research
 * claim into a Fact or World Rule — that bridge is the writer's alone
 * (docs/RESEARCH.md).
 */

function requireResearch(access: ProjectAccess, tool: string) {
  const list = access.listResearchItems?.bind(access);
  const search = access.searchResearch?.bind(access);
  const add = access.addResearchItem?.bind(access);
  if (list === undefined || search === undefined || add === undefined) {
    throw new ToolError("tool_failed", tool, "This project does not support research.");
  }
  return { list, search, add };
}

/** The compact face an agent reads — never the raw record. */
function brief(item: ResearchItemLike): Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    summary: item.summary ?? "",
    tags: item.tags,
    linkedEntityIds: item.linkedEntityIds,
    linkedSceneIds: item.linkedSceneIds,
    facts: item.facts,
  };
}

export function listResearchTool(access: ProjectAccess): Tool<Record<string, never>, unknown> {
  return {
    name: "list_research",
    description:
      "List the project's research items: sourced real-world knowledge, kept apart from story canon. Returns titles, statuses, tags, links and extracted research facts.",
    permission: "read_canon",
    inputSchema: objectSchema("ListResearchInput", {}),
    outputSchema: objectSchema("ListResearchOutput", {
      items: { type: "object[]", description: "Every research item, briefly." },
    }),
    async handler() {
      const { list } = requireResearch(access, "list_research");
      return { items: (await list()).map(brief) };
    },
  };
}

export function searchResearchTool(
  access: ProjectAccess,
): Tool<{ text?: string; tag?: string; linkedId?: string }, unknown> {
  return {
    name: "search_research",
    description:
      "Search the research library by text, tag, or linked story element. Research search is distinct from manuscript search — it finds real-world reference, not prose.",
    permission: "read_canon",
    inputSchema: objectSchema("SearchResearchInput", {
      text: { type: "string", description: "Words to look for.", optional: true },
      tag: { type: "string", description: "A tag to filter by.", optional: true },
      linkedId: {
        type: "string",
        description: "A story element id the research must link to.",
        optional: true,
      },
    }),
    outputSchema: objectSchema("SearchResearchOutput", {
      items: { type: "object[]", description: "Matching research items, briefly." },
    }),
    async handler(input) {
      const { search } = requireResearch(access, "search_research");
      return { items: (await search(input)).map(brief) };
    },
  };
}

export function createResearchItemTool(access: ProjectAccess): Tool<
  {
    title: string;
    summary?: string;
    content?: string;
    sourceTitle?: string;
    sourceUrl?: string;
    tags?: string[];
    linkedEntityIds?: string[];
    linkedSceneIds?: string[];
    facts?: string[];
  },
  unknown
> {
  return {
    name: "create_research_item",
    description:
      "File a research item: real-world information with its source, kept apart from story canon. The item arrives unreviewed — the writer judges trust — and nothing about it changes the story. Only cite a source you actually have; never invent one.",
    permission: "run_research",
    inputSchema: objectSchema("CreateResearchItemInput", {
      title: { type: "string", description: "What the research is about." },
      summary: { type: "string", description: "The distillation.", optional: true },
      content: {
        type: "string",
        description: "Source material or extract, kept beside the summary.",
        optional: true,
      },
      sourceTitle: { type: "string", description: "Where it came from.", optional: true },
      sourceUrl: { type: "string", description: "The source's URL, if real.", optional: true },
      tags: { type: "string[]", description: "Tags for the library.", optional: true },
      linkedEntityIds: {
        type: "string[]",
        description: "Story elements this bears on.",
        optional: true,
      },
      linkedSceneIds: { type: "string[]", description: "Scenes this bears on.", optional: true },
      facts: {
        type: "string[]",
        description: "Extracted claims, one sentence each. They stay research, never canon.",
        optional: true,
      },
    }),
    outputSchema: objectSchema("CreateResearchItemOutput", {
      item: { type: "object", description: "The stored item." },
    }),
    async handler(input) {
      const { add } = requireResearch(access, "create_research_item");
      const item = await add(
        {
          title: input.title,
          status: "unreviewed",
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.sourceTitle !== undefined ? { sourceTitle: input.sourceTitle } : {}),
          ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
          tags: input.tags ?? [],
          linkedEntityIds: input.linkedEntityIds ?? [],
          linkedSceneIds: input.linkedSceneIds ?? [],
          facts: (input.facts ?? []).map((statement) => ({
            statement,
            proposedBy: "model",
          })),
        } as ResearchItemLike,
        { actor: "agent" },
      );
      return { item: brief(item) };
    },
  };
}

/** All research tools, registered only when the project supports research. */
export function createResearchTools(access: ProjectAccess): RegisteredTool[] {
  if (access.listResearchItems === undefined) return [];
  return [
    eraseTool(listResearchTool(access)),
    eraseTool(searchResearchTool(access)),
    eraseTool(createResearchItemTool(access)),
  ];
}

export const RESEARCH_TOOL_NAMES = [
  "list_research",
  "search_research",
  "create_research_item",
] as const;
