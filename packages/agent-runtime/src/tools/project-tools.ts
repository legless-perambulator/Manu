import { entityKindOf, WRITER_DIR } from "@jellytind/domain";
import type {
  Chapter,
  Character,
  CharacterId,
  Location,
  LocationId,
  PlotThread,
  PlotThreadId,
  Relationship,
  Scene,
} from "@jellytind/domain";
import { ToolError } from "../errors";
import type { ProjectAccess } from "../ports";
import { objectSchema, emptySchema, type ToolSchema } from "../schema";
import { eraseTool, type RegisteredTool, type Tool } from "../tool";
import { safeListPrefix, safeToolPath } from "./paths";

/**
 * The Phase-7 read-only tool set.
 *
 * This is the point of the whole architecture: an agent inspects a structured
 * fiction project through dedicated, typed, permission-checked tools instead of
 * being handed the entire manuscript in a prompt (MASTER_BUILD.md §6,
 * docs/AGENT_TOOLS.md). Tools address entities by stable ID wherever possible;
 * raw paths are accepted only where a writer genuinely works in files, and are
 * validated before use.
 *
 * Every tool here is read-only. Mutating tools arrive in a later phase and must
 * route through the mutation layer (docs/VERSIONING.md).
 */

const MAX_FILES = 500;
const MAX_SEARCH_HITS = 50;
const MAX_FILE_CHARS = 40_000;

/** Fetch an entity by ID, checking the ID is well-formed and of the right kind. */
async function requireEntity<T>(
  access: ProjectAccess,
  toolName: string,
  id: string,
  expectedKind: string,
): Promise<T> {
  const kind = entityKindOf(id);
  if (kind === null) {
    throw new ToolError("invalid_arguments", toolName, `"${id}" is not a valid entity ID.`, {
      details: { id },
    });
  }
  if (kind !== expectedKind) {
    throw new ToolError(
      "invalid_arguments",
      toolName,
      `"${id}" is a ${kind} ID; this tool expects a ${expectedKind} ID.`,
      { details: { id, kind, expectedKind } },
    );
  }
  const entity = await access.getEntity<T>(id);
  if (entity === null) {
    throw new ToolError("tool_failed", toolName, `No ${expectedKind} exists with ID "${id}".`, {
      details: { id },
    });
  }
  return entity;
}

/** Output schemas are shape-checked; nested entity objects pass through. */
const listOut = <T>(name: string, key: string, description: string): ToolSchema<T> =>
  objectSchema<T>(name, { [key]: { type: "object[]", description } });

// ── File and text tools ─────────────────────────────────────────────────────

export function listProjectFilesTool(access: ProjectAccess): Tool<{ prefix?: string }, unknown> {
  return {
    name: "list_project_files",
    description:
      "List the project's content files, optionally under a directory prefix such as 'manuscript' or 'characters'. Internal state under .writer/ is not listed.",
    permission: "read_manuscript",
    inputSchema: objectSchema("ListProjectFilesInput", {
      prefix: {
        type: "string",
        description: "Optional project-relative directory to list under.",
        optional: true,
      },
    }),
    outputSchema: objectSchema("ListProjectFilesOutput", {
      files: { type: "string[]", description: "Project-relative file paths." },
      truncated: { type: "boolean", description: "True when the listing was capped." },
    }),
    async handler(input) {
      const prefix = safeListPrefix("list_project_files", input.prefix);
      const all = await access.listProjectFiles(prefix);
      const visible = all.filter(
        (path) => path !== WRITER_DIR && !path.startsWith(`${WRITER_DIR}/`),
      );
      return {
        files: visible.slice(0, MAX_FILES),
        truncated: visible.length > MAX_FILES,
      };
    },
  };
}

export function readFileTool(access: ProjectAccess): Tool<{ path: string }, unknown> {
  return {
    name: "read_file",
    description:
      "Read a project file's full text. Use read_range for long files. Paths must be project-relative.",
    permission: "read_manuscript",
    inputSchema: objectSchema("ReadFileInput", {
      path: { type: "string", description: "Project-relative file path." },
    }),
    outputSchema: objectSchema("ReadFileOutput", {
      path: { type: "string", description: "The path that was read." },
      content: { type: "string", description: "File text." },
      lineCount: { type: "number", description: "Number of lines in the file." },
      truncated: { type: "boolean", description: "True when the text was capped." },
    }),
    async handler(input) {
      const path = safeToolPath("read_file", input.path);
      const content = await access.readProjectFile(path);
      if (content === null) {
        throw new ToolError("tool_failed", "read_file", `No file exists at "${path}".`, {
          details: { path },
        });
      }
      const truncated = content.length > MAX_FILE_CHARS;
      return {
        path,
        content: truncated ? content.slice(0, MAX_FILE_CHARS) : content,
        lineCount: content.split("\n").length,
        truncated,
      };
    },
  };
}

export function readRangeTool(
  access: ProjectAccess,
): Tool<{ path: string; startLine: number; endLine: number }, unknown> {
  return {
    name: "read_range",
    description:
      "Read an inclusive 1-based line range from a project file, for inspecting part of a long chapter.",
    permission: "read_manuscript",
    inputSchema: objectSchema("ReadRangeInput", {
      path: { type: "string", description: "Project-relative file path." },
      startLine: { type: "number", description: "First line to read (1-based, inclusive)." },
      endLine: { type: "number", description: "Last line to read (1-based, inclusive)." },
    }),
    outputSchema: objectSchema("ReadRangeOutput", {
      path: { type: "string", description: "The path that was read." },
      startLine: { type: "number", description: "First line returned." },
      endLine: { type: "number", description: "Last line returned." },
      content: { type: "string", description: "The selected lines." },
      lineCount: { type: "number", description: "Total lines in the file." },
    }),
    async handler(input) {
      const path = safeToolPath("read_range", input.path);
      const { startLine, endLine } = input;
      if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1) {
        throw new ToolError(
          "invalid_arguments",
          "read_range",
          "startLine and endLine must be whole numbers and startLine must be at least 1.",
          { details: { startLine, endLine } },
        );
      }
      if (endLine < startLine) {
        throw new ToolError(
          "invalid_arguments",
          "read_range",
          "endLine must not be before startLine.",
          { details: { startLine, endLine } },
        );
      }
      const content = await access.readProjectFile(path);
      if (content === null) {
        throw new ToolError("tool_failed", "read_range", `No file exists at "${path}".`, {
          details: { path },
        });
      }
      const lines = content.split("\n");
      const last = Math.min(endLine, lines.length);
      return {
        path,
        startLine,
        endLine: last,
        content: lines.slice(startLine - 1, last).join("\n"),
        lineCount: lines.length,
      };
    },
  };
}

export function searchProjectTool(
  access: ProjectAccess,
): Tool<{ query: string; limit?: number }, unknown> {
  return {
    name: "search_project",
    description:
      "Full-text search across the project's files and entities. Returns located excerpts, not whole files.",
    permission: "read_manuscript",
    inputSchema: objectSchema("SearchProjectInput", {
      query: { type: "string", description: "Search terms." },
      limit: { type: "number", description: "Maximum hits to return.", optional: true },
    }),
    outputSchema: objectSchema("SearchProjectOutput", {
      hits: { type: "object[]", description: "Matches with excerpts and source references." },
      truncated: { type: "boolean", description: "True when more hits existed." },
    }),
    async handler(input) {
      const query = input.query.trim();
      if (query === "") {
        throw new ToolError("invalid_arguments", "search_project", "A search query is required.");
      }
      const limit = Math.min(input.limit ?? 20, MAX_SEARCH_HITS);
      const hits = await access.searchText({ text: query, limit: limit + 1 });
      return { hits: hits.slice(0, limit), truncated: hits.length > limit };
    },
  };
}

// ── Entity tools ────────────────────────────────────────────────────────────

export function getProjectTool(access: ProjectAccess): Tool<Record<string, never>, unknown> {
  return {
    name: "get_project",
    description:
      "Project overview: title, schema version and how many chapters, scenes, characters, locations and plot threads exist.",
    permission: "read_canon",
    inputSchema: emptySchema("GetProjectInput"),
    outputSchema: objectSchema("GetProjectOutput", {
      id: { type: "string", description: "Project ID." },
      title: { type: "string", description: "Project title." },
      schemaVersion: { type: "number", description: "Project schema version." },
      counts: { type: "object", description: "Entity counts by kind." },
    }),
    async handler() {
      const [chapters, scenes, characters, locations, threads] = await Promise.all([
        access.listChapters(),
        access.listScenes(),
        access.listCharacters(),
        access.listLocations(),
        access.listPlotThreads(),
      ]);
      return {
        id: access.project.id,
        title: access.project.title,
        schemaVersion: access.project.schemaVersion,
        counts: {
          chapters: chapters.length,
          scenes: scenes.length,
          characters: characters.length,
          locations: locations.length,
          plotThreads: threads.length,
        },
      };
    },
  };
}

export function getChapterTool(access: ProjectAccess): Tool<{ id: string }, unknown> {
  return {
    name: "get_chapter",
    description:
      "Read a chapter's record by ID (CHAPTER_0001), with the scenes assigned to it. Use read_file on its filePath for prose.",
    permission: "read_canon",
    inputSchema: objectSchema("GetChapterInput", {
      id: { type: "string", description: "Chapter ID, e.g. CHAPTER_0001." },
    }),
    outputSchema: objectSchema("GetChapterOutput", {
      chapter: { type: "object", description: "The chapter record." },
      scenes: { type: "object[]", description: "Scenes assigned to this chapter." },
    }),
    async handler(input) {
      const chapter = await requireEntity<Chapter>(access, "get_chapter", input.id, "chapter");
      const scenes = (await access.listScenes()).filter((s) => s.chapterId === chapter.id);
      return { chapter, scenes };
    },
  };
}

export function getSceneTool(access: ProjectAccess): Tool<{ id: string }, unknown> {
  return {
    name: "get_scene",
    description:
      "Read a scene's structured record by ID (SCENE_0001): title, chapter, POV, location, characters, plot threads, purpose and status.",
    permission: "read_canon",
    inputSchema: objectSchema("GetSceneInput", {
      id: { type: "string", description: "Scene ID, e.g. SCENE_0001." },
    }),
    outputSchema: objectSchema("GetSceneOutput", {
      scene: { type: "object", description: "The scene record." },
    }),
    async handler(input) {
      return { scene: await requireEntity<Scene>(access, "get_scene", input.id, "scene") };
    },
  };
}

export function getCharacterTool(access: ProjectAccess): Tool<{ id: string }, unknown> {
  return {
    name: "get_character",
    description:
      "Read a character by ID (CHAR_0001), together with every recorded relationship they are part of.",
    permission: "read_canon",
    inputSchema: objectSchema("GetCharacterInput", {
      id: { type: "string", description: "Character ID, e.g. CHAR_0001." },
    }),
    outputSchema: objectSchema("GetCharacterOutput", {
      character: { type: "object", description: "The character record." },
      relationships: { type: "object[]", description: "Relationships involving this character." },
    }),
    async handler(input) {
      const character = await requireEntity<Character>(
        access,
        "get_character",
        input.id,
        "character",
      );
      const relationships = (await access.listRelationships()).filter(
        (r: Relationship) => r.characterAId === character.id || r.characterBId === character.id,
      );
      return { character, relationships };
    },
  };
}

export function getLocationTool(access: ProjectAccess): Tool<{ id: string }, unknown> {
  return {
    name: "get_location",
    description: "Read a location by ID (LOC_0001).",
    permission: "read_canon",
    inputSchema: objectSchema("GetLocationInput", {
      id: { type: "string", description: "Location ID, e.g. LOC_0001." },
    }),
    outputSchema: objectSchema("GetLocationOutput", {
      location: { type: "object", description: "The location record." },
    }),
    async handler(input) {
      return {
        location: await requireEntity<Location>(access, "get_location", input.id, "location"),
      };
    },
  };
}

export function getPlotThreadTool(access: ProjectAccess): Tool<{ id: string }, unknown> {
  return {
    name: "get_plot_thread",
    description:
      "Read a plot thread by ID (THREAD_0001): status, where it is introduced and resolved, and related scenes.",
    permission: "read_canon",
    inputSchema: objectSchema("GetPlotThreadInput", {
      id: { type: "string", description: "Plot thread ID, e.g. THREAD_0001." },
    }),
    outputSchema: objectSchema("GetPlotThreadOutput", {
      plotThread: { type: "object", description: "The plot thread record." },
    }),
    async handler(input) {
      return {
        plotThread: await requireEntity<PlotThread>(
          access,
          "get_plot_thread",
          input.id,
          "plot_thread",
        ),
      };
    },
  };
}

// ── Structured graph queries ────────────────────────────────────────────────

export function getScenesByCharacterTool(access: ProjectAccess): Tool<{ id: string }, unknown> {
  return {
    name: "get_scenes_by_character",
    description:
      "Every scene a character appears in or narrates. Deterministic — computed from scene records, not inferred from prose.",
    permission: "read_canon",
    inputSchema: objectSchema("ScenesByCharacterInput", {
      id: { type: "string", description: "Character ID, e.g. CHAR_0001." },
    }),
    outputSchema: listOut("ScenesByCharacterOutput", "scenes", "Matching scene records."),
    async handler(input) {
      await requireEntity(access, "get_scenes_by_character", input.id, "character");
      return { scenes: await access.getScenesByCharacter(input.id as CharacterId) };
    },
  };
}

export function getScenesByLocationTool(access: ProjectAccess): Tool<{ id: string }, unknown> {
  return {
    name: "get_scenes_by_location",
    description: "Every scene set at a location. Deterministic — computed from scene records.",
    permission: "read_canon",
    inputSchema: objectSchema("ScenesByLocationInput", {
      id: { type: "string", description: "Location ID, e.g. LOC_0001." },
    }),
    outputSchema: listOut("ScenesByLocationOutput", "scenes", "Matching scene records."),
    async handler(input) {
      await requireEntity(access, "get_scenes_by_location", input.id, "location");
      return { scenes: await access.getScenesByLocation(input.id as LocationId) };
    },
  };
}

export function getScenesByPlotThreadTool(access: ProjectAccess): Tool<{ id: string }, unknown> {
  return {
    name: "get_scenes_by_plot_thread",
    description:
      "Every scene carrying a plot thread, including the scenes where it is introduced and resolved.",
    permission: "read_canon",
    inputSchema: objectSchema("ScenesByPlotThreadInput", {
      id: { type: "string", description: "Plot thread ID, e.g. THREAD_0001." },
    }),
    outputSchema: listOut("ScenesByPlotThreadOutput", "scenes", "Matching scene records."),
    async handler(input) {
      await requireEntity(access, "get_scenes_by_plot_thread", input.id, "plot_thread");
      return { scenes: await access.getScenesByPlotThread(input.id as PlotThreadId) };
    },
  };
}

/** Every read-only tool, in the order an investigation naturally uses them. */
export function createProjectTools(access: ProjectAccess): RegisteredTool[] {
  return [
    eraseTool(getProjectTool(access)),
    eraseTool(listProjectFilesTool(access)),
    eraseTool(searchProjectTool(access)),
    eraseTool(readFileTool(access)),
    eraseTool(readRangeTool(access)),
    eraseTool(getChapterTool(access)),
    eraseTool(getSceneTool(access)),
    eraseTool(getCharacterTool(access)),
    eraseTool(getLocationTool(access)),
    eraseTool(getPlotThreadTool(access)),
    eraseTool(getScenesByCharacterTool(access)),
    eraseTool(getScenesByLocationTool(access)),
    eraseTool(getScenesByPlotThreadTool(access)),
  ];
}

/** The names of the read-only tools, for a task's `allowedTools`. */
export const READ_ONLY_TOOL_NAMES: readonly string[] = [
  "get_project",
  "list_project_files",
  "search_project",
  "read_file",
  "read_range",
  "get_chapter",
  "get_scene",
  "get_character",
  "get_location",
  "get_plot_thread",
  "get_scenes_by_character",
  "get_scenes_by_location",
  "get_scenes_by_plot_thread",
];
