import { normalizeProjectPath, PathEscapeError } from "@jellytind/persistence";
import { WRITER_DIR } from "@jellytind/domain";
import { ToolError } from "../errors";

/**
 * Validate an agent-supplied path.
 *
 * Two independent guards, because paths are the one tool input a model can
 * invent freely:
 *
 * 1. **Traversal.** `normalizeProjectPath` rejects absolute paths, drive
 *    letters, NUL bytes and any `..` that would resolve above the project root,
 *    so no agent-supplied path can escape the project (AGENTS.md).
 * 2. **Internals.** `.writer/` holds the manifest, derived indexes, revision
 *    history and the agent's own task log. Investigation tools have no business
 *    there — project metadata is exposed deliberately through `get_project`,
 *    and history through the versioning layer — so raw file access to it is
 *    refused rather than quietly allowed.
 */
export function safeToolPath(toolName: string, input: string): string {
  let normalized: string;
  try {
    normalized = normalizeProjectPath(input);
  } catch (cause) {
    const reason = cause instanceof PathEscapeError ? cause.message : "unsafe path";
    throw new ToolError("path_escape", toolName, reason, { cause, details: { path: input } });
  }

  if (normalized === "") {
    throw new ToolError("path_escape", toolName, "A file path is required.", {
      details: { path: input },
    });
  }
  if (normalized === WRITER_DIR || normalized.startsWith(`${WRITER_DIR}/`)) {
    throw new ToolError(
      "path_escape",
      toolName,
      `"${WRITER_DIR}/" holds internal project state and is not readable through this tool.`,
      { details: { path: normalized } },
    );
  }
  return normalized;
}

/** Validate an optional directory prefix for listing. Root ("") is allowed. */
export function safeListPrefix(toolName: string, input: string | undefined): string | undefined {
  if (input === undefined || input.trim() === "") return undefined;
  return safeToolPath(toolName, input);
}
