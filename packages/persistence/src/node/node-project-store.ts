import { randomBytes } from "node:crypto";
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as nodePath from "node:path";
import { normalizeProjectPath, PathEscapeError } from "../path-safety";
import type { ProjectStore } from "../project-store";

/**
 * A real filesystem {@link ProjectStore} rooted at a single project directory.
 *
 * - Every path is normalised and confined to the root; traversal throws
 *   {@link PathEscapeError} (defence in depth beyond `normalizeProjectPath`,
 *   also re-checking the resolved absolute path).
 * - Writes are atomic: content is written to a temp file, flushed, then renamed
 *   over the destination, so an interrupted write never corrupts a file.
 *
 * This runs under Node (the app's Rust host performs the equivalent via IPC
 * commands). It is intentionally excluded from the browser-safe package barrel;
 * import it from `@jellytind/persistence/node`.
 */
export class NodeProjectStore implements ProjectStore {
  private readonly root: string;

  constructor(rootPath: string) {
    this.root = nodePath.resolve(rootPath);
  }

  /** Resolve a project-relative path to an absolute path confined to the root. */
  private resolve(path: string): string {
    const relative = normalizeProjectPath(path);
    const absolute = nodePath.resolve(this.root, relative);
    const withinRoot = absolute === this.root || absolute.startsWith(this.root + nodePath.sep);
    if (!withinRoot) {
      throw new PathEscapeError(path, "resolved outside the project root");
    }
    return absolute;
  }

  async readFile(path: string): Promise<string | null> {
    try {
      return await fs.readFile(this.resolve(path), "utf8");
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const target = this.resolve(path);
    await fs.mkdir(nodePath.dirname(target), { recursive: true });
    const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(tmp, "w");
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle?.close();
    }
    try {
      await fs.rename(tmp, target);
    } catch (error) {
      await fs.rm(tmp, { force: true });
      throw error;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(path));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const base = prefix === undefined ? this.root : this.resolve(prefix);
    const out: string[] = [];
    await walk(base, this.root, out);
    return out.sort();
  }

  async delete(path: string): Promise<void> {
    await fs.rm(this.resolve(path), { force: true });
  }

  async createDirectory(path: string): Promise<void> {
    await fs.mkdir(this.resolve(path), { recursive: true });
  }
}

async function walk(dir: string, root: string, out: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  for (const entry of entries) {
    const abs = nodePath.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, root, out);
    } else if (entry.isFile()) {
      out.push(nodePath.relative(root, abs).split(nodePath.sep).join("/"));
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
