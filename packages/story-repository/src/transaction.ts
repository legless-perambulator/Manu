import type { ChangeSet, EntityChange, FileChange } from "./history";

export interface StagedFileOp {
  readonly path: string;
  /** `null` stages a deletion. */
  readonly content: string | null;
}

/**
 * A file-level staging transaction — the boundary future AI operations use to
 * **stage → validate → present → commit or reject** changes without touching the
 * project until commit (docs/VERSIONING.md). Staged writes are visible to reads
 * within the transaction, so a caller can build up and inspect a change set
 * before deciding. Committing records exactly one {@link ChangeSet}; discarding
 * touches nothing.
 */
export class StagedTransaction {
  private readonly ops = new Map<string, string | null>();
  private readonly notes: EntityChange[] = [];

  constructor(
    private readonly read: (path: string) => Promise<string | null>,
    private readonly commitFn: (
      ops: StagedFileOp[],
      entities: EntityChange[],
      summary: string,
    ) => Promise<ChangeSet>,
    public summary = "Staged changes",
  ) {}

  writeFile(path: string, content: string): this {
    this.ops.set(path, content);
    return this;
  }

  deleteFile(path: string): this {
    this.ops.set(path, null);
    return this;
  }

  /** Attach a structured (entity-level) note describing the staged change. */
  note(change: EntityChange): this {
    this.notes.push(change);
    return this;
  }

  /** Read with staged writes overlaid on the live project. */
  readFile(path: string): Promise<string | null> {
    if (this.ops.has(path)) return Promise.resolve(this.ops.get(path) ?? null);
    return this.read(path);
  }

  isEmpty(): boolean {
    return this.ops.size === 0;
  }

  /** The before/after of every staged file — for presenting a diff before commit. */
  async preview(): Promise<FileChange[]> {
    const changes: FileChange[] = [];
    for (const [path, after] of this.ops) {
      changes.push({ path, before: await this.read(path), after });
    }
    return changes;
  }

  /** Apply all staged changes atomically as one recorded change set. */
  commit(summary?: string): Promise<ChangeSet> {
    const ops: StagedFileOp[] = [...this.ops].map(([path, content]) => ({ path, content }));
    return this.commitFn(ops, [...this.notes], summary ?? this.summary);
  }

  /** Abandon all staged changes. The project is untouched. */
  discard(): void {
    this.ops.clear();
    this.notes.length = 0;
  }
}
