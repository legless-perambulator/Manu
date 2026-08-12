import { WRITER_DIR } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";

const DIR = `${WRITER_DIR}/refactors`;
const INDEX = `${DIR}/index.json`;

/** The minimum this store needs to know about a run. */
interface RunLike {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly instruction: string;
  readonly createdAt: string;
  readonly introduced: ReadonlyArray<{ readonly severity: string }>;
}

interface Summary {
  id: string;
  kind: string;
  status: string;
  instruction: string;
  createdAt: string;
  introducedErrors: number;
}

interface Index {
  seq: number;
  runs: Summary[];
}

/**
 * Persists refactor runs under `.writer/refactors/`.
 *
 * A run is the **audit trail** of a structural change: the request as asked,
 * what the analysis found, the plan, which models had a hand in it, the staged
 * edits, diagnostics before and after, the approval and the resulting revision.
 * A change of this size that cannot be accounted for afterwards is a change a
 * writer cannot trust (docs/STORY_REFACTOR.md).
 *
 * Written straight to the store rather than through the journal: the *change*
 * a refactor makes is a change set, and recording the record of it as a second
 * one would double every entry in the writer's history.
 */
export class RefactorStore {
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

  /** The ID the next run will carry. */
  async nextId(): Promise<string> {
    return `REFACTOR_${String((await this.readIndex()).seq + 1).padStart(4, "0")}`;
  }

  async list(limit = 50): Promise<Summary[]> {
    const index = await this.readIndex();
    return [...index.runs].reverse().slice(0, limit);
  }

  async get<T>(id: string): Promise<T | null> {
    const raw = await this.store.readFile(`${DIR}/${id}.json`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /**
   * Save or update a run.
   *
   * Idempotent by ID: a run is written when it is staged and again when it is
   * decided, and the decision must not appear as a second refactor.
   */
  async save(run: RunLike): Promise<void> {
    const index = await this.readIndex();
    const summary: Summary = {
      id: run.id,
      kind: run.kind,
      status: run.status,
      instruction: run.instruction,
      createdAt: run.createdAt,
      introducedErrors: run.introduced.filter((d) => d.severity === "error").length,
    };
    const at = index.runs.findIndex((r) => r.id === run.id);
    if (at === -1) {
      index.seq += 1;
      index.runs.push(summary);
    } else {
      index.runs[at] = summary;
    }
    await this.store.writeFile(`${DIR}/${run.id}.json`, `${JSON.stringify(run, null, 2)}\n`);
    await this.store.writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`);
  }
}
