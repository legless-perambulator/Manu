import { AppError } from "@jellytind/shared";

/**
 * Raised when a path would escape the project root (traversal) or is otherwise
 * unsafe. The Story Repository never performs arbitrary filesystem operations;
 * every path is validated to resolve *inside* the project root (AGENTS.md — the
 * repository must not expose unrestricted filesystem access to agents).
 */
export class PathEscapeError extends AppError {
  constructor(input: string, reason: string) {
    super("path_escape", `Unsafe project path ${JSON.stringify(input)}: ${reason}.`, {
      details: { input, reason },
    });
  }
}

const WINDOWS_DRIVE = /^[A-Za-z]:/;

/**
 * Normalise an untrusted, project-relative path to a canonical POSIX-style
 * relative path, or throw {@link PathEscapeError} if it is absolute, contains a
 * NUL byte, or traverses above the project root.
 *
 * Pure and dependency-free (no `node:path`) so it is safe in the browser
 * renderer as well as Node. The project root itself normalises to `""`.
 */
export function normalizeProjectPath(input: string): string {
  if (input.includes("\0")) {
    throw new PathEscapeError(input, "contains a NUL byte");
  }

  const unixified = input.replace(/\\/g, "/");

  if (unixified.startsWith("/")) {
    throw new PathEscapeError(input, "absolute paths are not allowed");
  }
  if (WINDOWS_DRIVE.test(unixified)) {
    throw new PathEscapeError(input, "drive-qualified paths are not allowed");
  }

  const out: string[] = [];
  for (const segment of unixified.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) {
        throw new PathEscapeError(input, "traverses above the project root");
      }
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

/** True when {@link normalizeProjectPath} would accept `input`. */
export function isSafeProjectPath(input: string): boolean {
  try {
    normalizeProjectPath(input);
    return true;
  } catch {
    return false;
  }
}
