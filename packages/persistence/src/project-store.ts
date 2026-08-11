/**
 * The portable project file store.
 *
 * A Story Repository is a directory of human-readable files (Markdown/YAML/JSON)
 * — the authoritative, portable representation of the writer's work
 * (docs/STORY_REPOSITORY.md). `ProjectStore` is the narrow interface every
 * higher layer uses to read and write those files, so the concrete backend
 * (native filesystem via Tauri, an in-memory store for tests, or a future
 * sync-backed store) can vary without touching domain or application code.
 *
 * Paths are always project-relative, POSIX-style ("/"-separated), and never
 * escape the project root; enforcing that is the implementation's job.
 */
export interface ProjectStore {
  /** Read a file's UTF-8 contents, or `null` if it does not exist. */
  readFile(path: string): Promise<string | null>;
  /** Create or overwrite a file, creating parent directories as needed. */
  writeFile(path: string, content: string): Promise<void>;
  /** Whether a file exists at `path`. */
  exists(path: string): Promise<boolean>;
  /** List file paths, optionally restricted to those under `prefix`. */
  list(prefix?: string): Promise<string[]>;
  /** Remove a file. Removing a missing file is a no-op. */
  delete(path: string): Promise<void>;
  /** Create a directory (recursively). Creating an existing directory is a no-op. */
  createDirectory(path: string): Promise<void>;
}

/**
 * In-memory {@link ProjectStore}. Used by tests and early development; also the
 * reference for the contract native backends must satisfy.
 */
export class InMemoryProjectStore implements ProjectStore {
  private readonly files = new Map<string, string>();
  private readonly directories = new Set<string>();

  constructor(seed: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(seed)) {
      this.files.set(normalize(path), content);
    }
  }

  readFile(path: string): Promise<string | null> {
    return Promise.resolve(this.files.get(normalize(path)) ?? null);
  }

  writeFile(path: string, content: string): Promise<void> {
    this.files.set(normalize(path), content);
    return Promise.resolve();
  }

  exists(path: string): Promise<boolean> {
    const key = normalize(path);
    return Promise.resolve(this.files.has(key) || this.directories.has(key));
  }

  createDirectory(path: string): Promise<void> {
    this.directories.add(normalize(path));
    return Promise.resolve();
  }

  list(prefix?: string): Promise<string[]> {
    const wanted = prefix === undefined ? "" : normalize(prefix);
    const paths = [...this.files.keys()].filter((p) => p.startsWith(wanted)).sort();
    return Promise.resolve(paths);
  }

  delete(path: string): Promise<void> {
    this.files.delete(normalize(path));
    return Promise.resolve();
  }
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "");
}
