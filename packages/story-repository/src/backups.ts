import { WRITER_DIR } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";

const DIR = `${WRITER_DIR}/backups`;
const INDEX = `${DIR}/index.json`;

/** How many snapshots to keep. Oldest are pruned beyond this. */
export const RETAIN = 10;

export interface BackupEntry {
  readonly id: string;
  readonly at: string;
  readonly reason: string;
  readonly files: number;
  readonly bytes: number;
}

/**
 * Local, bounded project snapshots.
 *
 * A last resort, not a version-control system — History and checkpoints already
 * cover deliberate change. This covers the other kind: a bad merge from another
 * tool, a rogue find-and-replace, a mistake nobody noticed for an hour.
 *
 * Four properties matter and each is deliberate:
 *
 * - **Inside `.writer/backups/`**, which the manuscript tree, the search index
 *   and every entity store already ignore. A backup that search could find
 *   would return every chapter ten times over.
 * - **Bounded**, so a novel does not silently become eleven novels on disk.
 * - **Copy-only.** Nothing here writes to a canonical file, ever. Taking a
 *   backup cannot be the thing that breaks the project.
 * - **Plain files.** Recovery is copying a folder back, and works with Manu
 *   shut (docs/STORY_REPOSITORY.md).
 */
export class ProjectBackups {
  constructor(private readonly store: ProjectStore) {}

  private async index(): Promise<BackupEntry[]> {
    const raw = await this.store.readFile(INDEX);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as BackupEntry[]) : [];
    } catch {
      return [];
    }
  }

  private async writeIndex(entries: readonly BackupEntry[]): Promise<void> {
    await this.store.createDirectory(DIR);
    await this.store.writeFile(INDEX, `${JSON.stringify(entries, null, 2)}\n`);
  }

  /** Snapshots, newest first. */
  async list(): Promise<BackupEntry[]> {
    return (await this.index()).slice().reverse();
  }

  /**
   * Which files a backup covers: everything the writer owns.
   *
   * `.writer/` is excluded wholesale — it holds derived analysis, run records
   * and the backups themselves, and copying backups into backups is how a disk
   * fills up overnight.
   */
  private async sources(): Promise<string[]> {
    return (await this.store.list()).filter((path) => !path.startsWith(`${WRITER_DIR}/`));
  }

  /**
   * Take a snapshot, unless one was taken within `minIntervalMs`.
   *
   * Returns the entry, or `null` when it was skipped — skipping is the normal
   * case and not a failure, so opening a project forty times in an afternoon
   * does not produce forty copies of it.
   */
  async capture(options: {
    reason: string;
    now?: string;
    minIntervalMs?: number;
  }): Promise<BackupEntry | null> {
    const entries = await this.index();
    const at = options.now ?? new Date().toISOString();
    const gap = options.minIntervalMs ?? 0;

    if (gap > 0) {
      const last = entries.at(-1);
      if (last !== undefined && Date.parse(at) - Date.parse(last.at) < gap) return null;
    }

    const id = `BK_${at.replace(/[:.]/g, "-")}`;
    const paths = await this.sources();
    let bytes = 0;

    for (const path of paths) {
      const content = await this.store.readFile(path);
      if (content === null) continue;
      bytes += content.length;
      await this.store.writeFile(`${DIR}/${id}/${path}`, content);
    }

    const entry: BackupEntry = { id, at, reason: options.reason, files: paths.length, bytes };
    const kept = [...entries, entry];

    // Prune oldest beyond the retention bound.
    while (kept.length > RETAIN) {
      const oldest = kept.shift();
      if (oldest === undefined) break;
      for (const path of await this.store.list(`${DIR}/${oldest.id}/`)) {
        await this.store.delete(path);
      }
    }

    await this.writeIndex(kept);
    return entry;
  }

  /** The files a snapshot holds, as project-relative paths mapped to content. */
  async read(id: string): Promise<Map<string, string>> {
    const prefix = `${DIR}/${id}/`;
    const out = new Map<string, string>();
    for (const path of await this.store.list(prefix)) {
      const content = await this.store.readFile(path);
      if (content !== null) out.set(path.slice(prefix.length), content);
    }
    return out;
  }

  /**
   * Restore a snapshot over the project.
   *
   * Takes a backup of the current state first, so restoring is itself
   * reversible — the commonest way to lose work with a restore feature is to
   * restore the wrong one.
   */
  async restore(id: string, options: { now?: string } = {}): Promise<number> {
    const files = await this.read(id);
    if (files.size === 0) return 0;
    await this.capture({ reason: `before restoring ${id}`, ...options });
    for (const [path, content] of files) await this.store.writeFile(path, content);
    return files.size;
  }
}
