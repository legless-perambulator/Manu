import { WRITER_DIR, summariseRun } from "@jellytind/domain";
import type { SkillRun, SkillRunSummary } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";

const DIR = `${WRITER_DIR}/skills`;
const RUNS = `${DIR}/runs`;
const INDEX = `${RUNS}/index.json`;

interface Index {
  seq: number;
  runs: SkillRunSummary[];
}

/**
 * Persists skill runs under `.writer/skills/runs/`.
 *
 * A run is **derived**, like a build or a debug report: running a skill asks
 * questions of the project and changes nothing in it, so the record goes
 * straight to the store rather than through the journal — a writer's revision
 * history should hold the changes they made, not the audits they ran
 * (docs/VERSIONING.md).
 *
 * Each run keeps its own file because it carries the step outputs that make it
 * resumable, and none of that is needed to answer "what have I run?". The
 * index answers that in one read.
 *
 * A run is written after **every step**, not at the end. That is the whole
 * point: a run interrupted by a crash, a closed lid or a failed model call is
 * picked up where it stopped rather than started again
 * (docs/WRITING_SKILLS.md).
 */
export class SkillRunStore {
  constructor(private readonly store: ProjectStore) {}

  private async readIndex(): Promise<Index> {
    const raw = await this.store.readFile(INDEX);
    if (raw === null) return { seq: 0, runs: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<Index>;
      return {
        seq: typeof parsed.seq === "number" ? parsed.seq : 0,
        runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      };
    } catch {
      return { seq: 0, runs: [] };
    }
  }

  /** Allocate the next run id, e.g. `SKILLRUN_0007`. */
  async nextId(): Promise<string> {
    const index = await this.readIndex();
    index.seq += 1;
    await this.writeIndex(index);
    return `SKILLRUN_${String(index.seq).padStart(4, "0")}`;
  }

  /** Run summaries, newest first. */
  async list(limit = 50): Promise<SkillRunSummary[]> {
    const index = await this.readIndex();
    return [...index.runs].reverse().slice(0, limit);
  }

  async get(id: string): Promise<SkillRun | null> {
    const raw = await this.store.readFile(`${RUNS}/${id}.json`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as SkillRun;
    } catch {
      return null;
    }
  }

  /** Insert or replace a run, keeping its summary in the index current. */
  async save(run: SkillRun): Promise<SkillRun> {
    await this.store.createDirectory(RUNS);
    await this.store.writeFile(`${RUNS}/${run.id}.json`, `${JSON.stringify(run, null, 2)}\n`);

    const index = await this.readIndex();
    const summary = summariseRun(run);
    const at = index.runs.findIndex((entry) => entry.id === run.id);
    if (at === -1) index.runs.push(summary);
    else index.runs[at] = summary;
    await this.writeIndex(index);
    return run;
  }

  private async writeIndex(index: Index): Promise<void> {
    await this.store.createDirectory(RUNS);
    await this.store.writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`);
  }
}
