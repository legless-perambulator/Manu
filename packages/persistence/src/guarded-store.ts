import { AppError } from "@jellytind/shared";
import type { ProjectStore } from "./project-store";

/**
 * Refused because the file changed underneath us.
 *
 * Carries both versions so the interface can offer a real choice — reload,
 * compare, or overwrite deliberately — rather than an apology.
 */
export class ExternalChangeError extends AppError {
  constructor(
    readonly path: string,
    /** What Manu last saw at this path. `null` when it did not exist. */
    readonly expected: string | null,
    /** What is there now. `null` when it has been deleted. */
    readonly found: string | null,
    /** What Manu was about to write. */
    readonly attempted: string,
  ) {
    super(
      "external_change",
      found === null
        ? `${path} was deleted by another application after Manu loaded it.`
        : `${path} was modified by another application after Manu loaded it.`,
      { details: { path } },
    );
  }
}

/**
 * A content fingerprint.
 *
 * FNV-1a with the length mixed in — the same function the reader simulator uses
 * for staleness. Not a security hash and not trying to be: it answers "is this
 * the same bytes Manu last saw?", where an adversary is not in the picture and
 * an accidental collision would need two edits of identical length hashing
 * equal.
 */
export function fingerprint(content: string | null): string {
  if (content === null) return "absent";
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${content.length.toString(36)}.${hash.toString(36)}`;
}

export interface GuardOptions {
  /**
   * Which paths to protect. Defaults to everything outside `.writer/`.
   *
   * The application's own bookkeeping is excluded deliberately: nobody hand-edits
   * `id-sequences.json`, and guarding it would turn ordinary internal churn into
   * conflicts a writer cannot act on. The files this protects are the ones the
   * product invites people to open elsewhere — the manuscript and the records
   * beside it (docs/STORY_REPOSITORY.md).
   */
  readonly guard?: (path: string) => boolean;
}

const defaultGuard = (path: string): boolean => !path.startsWith(".writer/");

/**
 * A {@link ProjectStore} decorator that refuses to overwrite a file which
 * changed on disk since Manu last read or wrote it.
 *
 * This is the fix for the audit's only P0. Manu's promise is that a project is a
 * folder of plain files you own — which is precisely an invitation to open them
 * in another editor, and before this the next in-app write destroyed that work
 * silently.
 *
 * The mechanism is deliberately boring: remember a fingerprint of what we last
 * saw at each guarded path, re-read before overwriting, and compare. It costs
 * one extra read per write and needs no filesystem watching, no platform
 * support and no daemon — so it holds for the Node store, the Tauri host and
 * any future backend equally.
 *
 * A path Manu has never read or written is not yet tracked; the first write
 * adopts whatever is there. That is the honest limit of this approach and it
 * does not weaken the guarantee that matters: a file the writer has open in
 * Manu has necessarily been read by Manu.
 */
export class GuardedProjectStore implements ProjectStore {
  private readonly seen = new Map<string, string>();
  private readonly guard: (path: string) => boolean;

  constructor(
    private readonly inner: ProjectStore,
    options: GuardOptions = {},
  ) {
    this.guard = options.guard ?? defaultGuard;
  }

  /**
   * Read, remembering what we saw the **first** time only.
   *
   * Deliberately not a refresh. Layers above this one read files for their own
   * reasons — the journal reads the previous content to record a change set,
   * immediately before the write it is recording — and if every read updated
   * the token, that internal read would refresh it a moment before the
   * comparison and the guard would never fire. First touch wins; refreshing is
   * an explicit act (see {@link adopt}).
   */
  async readFile(path: string): Promise<string | null> {
    const content = await this.inner.readFile(path);
    if (this.guard(path) && !this.seen.has(path)) this.seen.set(path, fingerprint(content));
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (this.guard(path)) {
      const known = this.seen.get(path);
      if (known !== undefined) {
        const current = await this.inner.readFile(path);
        const now = fingerprint(current);
        if (now !== known) throw new ExternalChangeError(path, null, current, content);
      }
      await this.inner.writeFile(path, content);
      this.seen.set(path, fingerprint(content));
      return;
    }
    await this.inner.writeFile(path, content);
  }

  async delete(path: string): Promise<void> {
    await this.inner.delete(path);
    this.seen.delete(path);
  }

  exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }

  list(prefix?: string): Promise<string[]> {
    return this.inner.list(prefix);
  }

  createDirectory(path: string): Promise<void> {
    return this.inner.createDirectory(path);
  }

  // ── Resolving a conflict ──────────────────────────────────────────────────

  /**
   * Accept what is on disk as the version Manu now knows about.
   *
   * Used when the writer chooses to keep the external version, and after a
   * deliberate overwrite. Nothing is written here — this only updates what the
   * guard expects to find.
   */
  async adopt(path: string): Promise<string | null> {
    const current = await this.inner.readFile(path);
    this.seen.set(path, fingerprint(current));
    return current;
  }

  /** Stop tracking a path, so the next write adopts whatever is there. */
  forget(path: string): void {
    this.seen.delete(path);
  }

  /** Whether the disk still holds what Manu last saw. */
  async isCurrent(path: string): Promise<boolean> {
    const known = this.seen.get(path);
    if (known === undefined) return true;
    return fingerprint(await this.inner.readFile(path)) === known;
  }

  /** Every guarded path Manu is currently tracking. */
  tracked(): string[] {
    return [...this.seen.keys()].sort();
  }
}
