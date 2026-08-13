import { WRITER_DIR, summariseSimulation } from "@jellytind/domain";
import type { ReaderSimulation, ReaderSimulationSummary } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";

const DIR = `${WRITER_DIR}/readers`;
const RUNS = `${DIR}/simulations`;
const INDEX = `${RUNS}/index.json`;

interface Index {
  seq: number;
  simulations: ReaderSimulationSummary[];
}

/**
 * Persists reader simulations under `.writer/readers/simulations/`.
 *
 * A simulation is derived, like a build: running one asks a question of the
 * manuscript and changes nothing in it, so it goes straight to the store
 * rather than through the change-set journal.
 *
 * It is written after **every chapter**, which is what makes twenty chapters of
 * reading survive a crash — and what lets a staleness check know exactly which
 * chapters are still good after the writer rewrites chapter four
 * (docs/SIMULATIONS.md).
 */
export class ReaderSimulationStore {
  constructor(private readonly store: ProjectStore) {}

  private async readIndex(): Promise<Index> {
    const raw = await this.store.readFile(INDEX);
    if (raw === null) return { seq: 0, simulations: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<Index>;
      return {
        seq: typeof parsed.seq === "number" ? parsed.seq : 0,
        simulations: Array.isArray(parsed.simulations) ? parsed.simulations : [],
      };
    } catch {
      return { seq: 0, simulations: [] };
    }
  }

  /** Allocate the next simulation id, e.g. `READ_0007`. */
  async nextId(): Promise<string> {
    const index = await this.readIndex();
    index.seq += 1;
    await this.writeIndex(index);
    return `READ_${String(index.seq).padStart(4, "0")}`;
  }

  /** Simulation summaries, newest first. */
  async list(limit = 50): Promise<ReaderSimulationSummary[]> {
    const index = await this.readIndex();
    return [...index.simulations].reverse().slice(0, limit);
  }

  async get(id: string): Promise<ReaderSimulation | null> {
    const raw = await this.store.readFile(`${RUNS}/${id}.json`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as ReaderSimulation;
    } catch {
      return null;
    }
  }

  async save(simulation: ReaderSimulation): Promise<ReaderSimulation> {
    await this.store.createDirectory(RUNS);
    await this.store.writeFile(
      `${RUNS}/${simulation.id}.json`,
      `${JSON.stringify(simulation, null, 2)}\n`,
    );

    const index = await this.readIndex();
    const summary = summariseSimulation(simulation);
    const at = index.simulations.findIndex((entry) => entry.id === simulation.id);
    if (at === -1) index.simulations.push(summary);
    else index.simulations[at] = summary;
    await this.writeIndex(index);
    return simulation;
  }

  private async writeIndex(index: Index): Promise<void> {
    await this.store.createDirectory(RUNS);
    await this.store.writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`);
  }
}
