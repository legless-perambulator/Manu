import { WRITER_DIR, summariseWorkflowRun } from "@jellytind/domain";
import type { WorkflowRun, WorkflowRunSummary } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";

const DIR = `${WRITER_DIR}/workflows`;
const RUNS = `${DIR}/runs`;
const INDEX = `${RUNS}/index.json`;

interface Index {
  seq: number;
  runs: WorkflowRunSummary[];
}

/**
 * Persists multi-agent workflow runs under `.writer/workflows/runs/`.
 *
 * A run holds the artifacts agents handed each other, the disagreements
 * nobody has settled, the checkpoints taken and the change sets committed —
 * so *what the agents decided* survives the session that produced it, and a
 * run waiting for the writer's approval is still waiting tomorrow morning
 * (docs/ORCHESTRATION.md).
 *
 * Written straight to the store rather than through the journal: orchestrating
 * agents is not itself a change to the story. The changes a run **commits** are
 * ordinary change sets, and the run records their IDs.
 */
export class WorkflowRunStore {
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

  /** Allocate the next run id, e.g. `FLOW_0007`. */
  async nextId(): Promise<string> {
    const index = await this.readIndex();
    index.seq += 1;
    await this.writeIndex(index);
    return `FLOW_${String(index.seq).padStart(4, "0")}`;
  }

  /** Run summaries, newest first. */
  async list(limit = 50): Promise<WorkflowRunSummary[]> {
    const index = await this.readIndex();
    return [...index.runs].reverse().slice(0, limit);
  }

  async get(id: string): Promise<WorkflowRun | null> {
    const raw = await this.store.readFile(`${RUNS}/${id}.json`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as WorkflowRun;
    } catch {
      return null;
    }
  }

  /** Insert or replace a run, keeping its summary in the index current. */
  async save(run: WorkflowRun): Promise<WorkflowRun> {
    await this.store.createDirectory(RUNS);
    await this.store.writeFile(`${RUNS}/${run.id}.json`, `${JSON.stringify(run, null, 2)}\n`);

    const index = await this.readIndex();
    const summary = summariseWorkflowRun(run);
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
