import type { ProjectStore } from "./project-store";

/**
 * The directory branches live under. Everything inside it is infrastructure:
 * it is invisible from within any branch, so a branch can never see another
 * branch's files, and a branch's own overlay never appears in its own listing.
 */
export const BRANCHES_DIR = ".writer/branches";

/** Where a branch keeps the files it has changed, and its tombstones. */
export function branchFilesPrefix(branchId: string): string {
  return `${BRANCHES_DIR}/${branchId}/files`;
}
export function branchTombstonePath(branchId: string): string {
  return `${BRANCHES_DIR}/${branchId}/deleted.json`;
}

/**
 * A copy-on-write view of a project.
 *
 * A branch is an alternative state of the **whole** Story Repository, not an
 * alternative text file. Because every subsystem — manuscript, entities, story
 * state, knowledge, relationships, timeline, objects, plot threads, tests,
 * dependencies — reads and writes through `ProjectStore`, isolating the store
 * isolates all of them at once. No subsystem needs to know branches exist.
 *
 * Reads fall through to the parent; writes land in the branch's own overlay;
 * deletes are recorded as tombstones rather than touching the parent. Nothing a
 * branch does can reach the files another branch reads.
 *
 * The main branch is this same class with no overlay: it still hides the
 * branches directory, so a shadow-copy validation or a search index built on
 * main never ingests an alternative version's files.
 */
export class BranchedProjectStore implements ProjectStore {
  private readonly filesPrefix: string | null;
  private readonly tombstonePath: string | null;
  /** Lazily loaded so the common read path costs one store call, not two. */
  private tombstones: Set<string> | null = null;

  constructor(
    private readonly base: ProjectStore,
    /** `null` for the main branch, which owns the project files directly. */
    private readonly branchId: string | null,
  ) {
    this.filesPrefix = branchId === null ? null : branchFilesPrefix(branchId);
    this.tombstonePath = branchId === null ? null : branchTombstonePath(branchId);
  }

  /** The branch this view belongs to, or `null` on main. */
  get branch(): string | null {
    return this.branchId;
  }

  /** The underlying project store, for operations that span branches. */
  get parent(): ProjectStore {
    return this.base;
  }

  /**
   * The project paths this branch has actually written or deleted — its own
   * divergence from its parent, read straight off the overlay rather than
   * inferred by comparing content.
   */
  async ownPaths(): Promise<string[]> {
    if (this.filesPrefix === null) return [];
    const written = (await this.base.list(this.filesPrefix))
      .map((p) => p.slice(this.filesPrefix!.length + 1))
      .filter((p) => p !== "");
    return [...new Set([...written, ...(await this.deleted())])].sort();
  }

  private overlay(path: string): string {
    return `${this.filesPrefix ?? ""}/${normalize(path)}`;
  }

  /**
   * Branch infrastructure is addressed directly rather than through the
   * overlay: the branch registry is one shared record for the whole project,
   * and a branch must not be able to fork it.
   */
  private isInfrastructure(path: string): boolean {
    return normalize(path).startsWith(`${BRANCHES_DIR}/`) || normalize(path) === BRANCHES_DIR;
  }

  private async deleted(): Promise<Set<string>> {
    if (this.tombstones !== null) return this.tombstones;
    if (this.tombstonePath === null) {
      this.tombstones = new Set();
      return this.tombstones;
    }
    const raw = await this.base.readFile(this.tombstonePath);
    let paths: string[] = [];
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) paths = parsed.filter((p): p is string => typeof p === "string");
      } catch {
        // A corrupt tombstone list must not make the branch unreadable; the
        // worst case is a deleted file reappearing, which the writer can see.
        paths = [];
      }
    }
    this.tombstones = new Set(paths);
    return this.tombstones;
  }

  private async recordDeletion(path: string): Promise<void> {
    if (this.tombstonePath === null) return;
    const set = await this.deleted();
    set.add(normalize(path));
    await this.base.writeFile(this.tombstonePath, JSON.stringify([...set].sort(), null, 2));
  }

  private async clearDeletion(path: string): Promise<void> {
    if (this.tombstonePath === null) return;
    const set = await this.deleted();
    if (!set.delete(normalize(path))) return;
    await this.base.writeFile(this.tombstonePath, JSON.stringify([...set].sort(), null, 2));
  }

  async readFile(path: string): Promise<string | null> {
    if (this.isInfrastructure(path)) return this.base.readFile(path);
    if (this.filesPrefix !== null) {
      const own = await this.base.readFile(this.overlay(path));
      if (own !== null) return own;
      if ((await this.deleted()).has(normalize(path))) return null;
    }
    return this.base.readFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (this.isInfrastructure(path) || this.filesPrefix === null) {
      return this.base.writeFile(path, content);
    }
    // Writing a path the branch had deleted resurrects it here only.
    await this.clearDeletion(path);
    await this.base.writeFile(this.overlay(path), content);
  }

  async exists(path: string): Promise<boolean> {
    if (this.isInfrastructure(path)) return this.base.exists(path);
    if (this.filesPrefix !== null) {
      if (await this.base.exists(this.overlay(path))) return true;
      if ((await this.deleted()).has(normalize(path))) return false;
    }
    return this.base.exists(path);
  }

  async delete(path: string): Promise<void> {
    if (this.isInfrastructure(path) || this.filesPrefix === null) {
      return this.base.delete(path);
    }
    await this.base.delete(this.overlay(path));
    await this.recordDeletion(path);
  }

  async createDirectory(path: string): Promise<void> {
    if (this.isInfrastructure(path) || this.filesPrefix === null) {
      return this.base.createDirectory(path);
    }
    await this.base.createDirectory(this.overlay(path));
  }

  async list(prefix?: string): Promise<string[]> {
    const wanted = prefix === undefined ? "" : normalize(prefix);
    if (this.isInfrastructure(wanted)) return this.base.list(prefix);

    const gone = await this.deleted();
    const visible = new Set<string>();
    for (const path of await this.base.list(wanted)) {
      if (this.isInfrastructure(path)) continue;
      if (gone.has(path)) continue;
      visible.add(path);
    }
    if (this.filesPrefix !== null) {
      const own = await this.base.list(`${this.filesPrefix}/${wanted}`);
      for (const path of own) {
        const projectPath = path.slice(this.filesPrefix.length + 1);
        if (projectPath !== "") visible.add(projectPath);
      }
    }
    return [...visible].sort();
  }
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "");
}
