import type { ProjectStore } from "@jellytind/persistence";
import type { FileChange } from "./history";

interface Captured {
  before: string | null;
  after: string | null;
}

const HISTORY_PREFIX = ".writer/revisions/";

/**
 * A {@link ProjectStore} decorator that, while a recording session is open,
 * captures the before/after content of every file write and delete. This is how
 * mutations become reviewable and reversible without instrumenting each one:
 * the repository opens a session around a logical operation, runs the operation
 * normally, then emits the captured {@link FileChange}s as a change set.
 *
 * History files (`.writer/revisions/`) are never captured — history is not part
 * of the diff of a change, and reverting never rewrites history.
 */
export class JournaledProjectStore implements ProjectStore {
  private recording: Map<string, Captured> | null = null;

  constructor(private readonly inner: ProjectStore) {}

  readFile(path: string): Promise<string | null> {
    return this.inner.readFile(path);
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

  async writeFile(path: string, content: string): Promise<void> {
    await this.capture(path);
    if (this.recording !== null && !excluded(path)) {
      this.recording.get(path)!.after = content;
    }
    await this.inner.writeFile(path, content);
  }

  async delete(path: string): Promise<void> {
    await this.capture(path);
    if (this.recording !== null && !excluded(path)) {
      this.recording.get(path)!.after = null;
    }
    await this.inner.delete(path);
  }

  private async capture(path: string): Promise<void> {
    if (this.recording === null || excluded(path) || this.recording.has(path)) return;
    this.recording.set(path, { before: await this.inner.readFile(path), after: null });
  }

  // ── Recording control ───────────────────────────────────────────────────────

  beginRecording(): void {
    this.recording = new Map();
  }

  isRecording(): boolean {
    return this.recording !== null;
  }

  /** Finish the session and return the net file changes (unchanged files dropped). */
  endRecording(): FileChange[] {
    const changes: FileChange[] = [];
    for (const [path, { before, after }] of this.recording ?? []) {
      if (before === after) continue;
      changes.push({ path, before, after });
    }
    this.recording = null;
    return changes;
  }

  /** Undo everything written during the session, restoring pre-session content. */
  async rollbackRecording(): Promise<void> {
    const session = this.recording;
    this.recording = null;
    if (session === null) return;
    for (const [path, { before }] of session) {
      if (before === null) await this.inner.delete(path);
      else await this.inner.writeFile(path, before);
    }
  }
}

function excluded(path: string): boolean {
  return path.startsWith(HISTORY_PREFIX);
}
