import type { ProjectStore } from "@jellytind/persistence";
import {
  summarize,
  type ChangeSet,
  type ChangeSetSummary,
  type ChangeStatus,
  type Checkpoint,
} from "./history";

const DIR = ".writer/revisions";
const LOG_PATH = `${DIR}/log.json`;

interface Log {
  seqChange: number;
  seqCheckpoint: number;
  changes: ChangeSetSummary[];
  checkpoints: Checkpoint[];
}

export interface SnapshotFile {
  readonly path: string;
  readonly content: string;
}

const EMPTY_LOG: Log = { seqChange: 0, seqCheckpoint: 0, changes: [], checkpoints: [] };

/**
 * Persists change sets and checkpoints under `.writer/revisions/`. Uses the raw
 * (un-journaled) store so writing history never itself produces history. History
 * is append-only: a revert adds a new change set; nothing is deleted.
 */
export class HistoryStore {
  constructor(private readonly store: ProjectStore) {}

  private async readLog(): Promise<Log> {
    const raw = await this.store.readFile(LOG_PATH);
    if (raw === null) return { ...EMPTY_LOG, changes: [], checkpoints: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<Log>;
      return {
        seqChange: parsed.seqChange ?? 0,
        seqCheckpoint: parsed.seqCheckpoint ?? 0,
        changes: Array.isArray(parsed.changes) ? parsed.changes : [],
        checkpoints: Array.isArray(parsed.checkpoints) ? parsed.checkpoints : [],
      };
    } catch {
      return { ...EMPTY_LOG, changes: [], checkpoints: [] };
    }
  }

  private async writeLog(log: Log): Promise<void> {
    await this.store.writeFile(LOG_PATH, `${JSON.stringify(log, null, 2)}\n`);
  }

  /** Append a change set (id assigned here). Returns the stored change set. */
  async append(change: Omit<ChangeSet, "id">): Promise<ChangeSet> {
    const log = await this.readLog();
    log.seqChange += 1;
    const id = `CHG_${String(log.seqChange).padStart(4, "0")}`;
    const full: ChangeSet = { ...change, id };
    await this.store.writeFile(`${DIR}/changes/${id}.json`, `${JSON.stringify(full, null, 2)}\n`);
    log.changes.push(summarize(full));
    await this.writeLog(log);
    return full;
  }

  /** History newest-first. */
  async listChangeSets(): Promise<ChangeSetSummary[]> {
    return [...(await this.readLog()).changes].reverse();
  }

  async getChangeSet(id: string): Promise<ChangeSet | null> {
    const raw = await this.store.readFile(`${DIR}/changes/${id}.json`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as ChangeSet;
    } catch {
      return null;
    }
  }

  async setStatus(id: string, status: ChangeStatus): Promise<void> {
    const existing = await this.getChangeSet(id);
    if (existing !== null) {
      await this.store.writeFile(
        `${DIR}/changes/${id}.json`,
        `${JSON.stringify({ ...existing, status }, null, 2)}\n`,
      );
    }
    const log = await this.readLog();
    const summary = log.changes.find((c) => c.id === id);
    if (summary !== undefined) {
      log.changes = log.changes.map((c) => (c.id === id ? { ...c, status } : c));
      await this.writeLog(log);
    }
  }

  // ── Checkpoints ───────────────────────────────────────────────────────────

  async saveCheckpoint(
    label: string,
    createdAt: string,
    files: readonly SnapshotFile[],
    atChangeSetId?: string,
  ): Promise<Checkpoint> {
    const log = await this.readLog();
    log.seqCheckpoint += 1;
    const id = `CP_${String(log.seqCheckpoint).padStart(4, "0")}`;
    const checkpoint: Checkpoint = {
      id,
      label,
      createdAt,
      fileCount: files.length,
      ...(atChangeSetId !== undefined ? { atChangeSetId } : {}),
    };
    await this.store.writeFile(
      `${DIR}/checkpoints/${id}.json`,
      `${JSON.stringify({ checkpoint, files }, null, 2)}\n`,
    );
    log.checkpoints.push(checkpoint);
    await this.writeLog(log);
    return checkpoint;
  }

  async listCheckpoints(): Promise<Checkpoint[]> {
    return [...(await this.readLog()).checkpoints].reverse();
  }

  async getCheckpointFiles(id: string): Promise<SnapshotFile[] | null> {
    const raw = await this.store.readFile(`${DIR}/checkpoints/${id}.json`);
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as { files?: SnapshotFile[] };
      return Array.isArray(parsed.files) ? parsed.files : [];
    } catch {
      return null;
    }
  }
}
