import { WRITER_DIR, summariseActBuild } from "@jellytind/domain";
import type { ActBuild, ActBuildSummary } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";

const DIR = `${WRITER_DIR}/builds/acts`;
const INDEX = `${DIR}/index.json`;

interface Index {
  seq: number;
  builds: ActBuildSummary[];
}

/**
 * Persists act builds under `.writer/builds/acts/`.
 *
 * Written after every step of the act pipeline — the record on disk is what
 * makes "build Chapters 6–8, close Manu, reopen, resume at Chapter 9" true
 * (§12). Like chapter builds and workflow runs, it is written straight to the
 * store rather than through the journal: running a build is not itself a
 * change to the story. Everything a build *commits* goes through the child
 * chapter builds' ordinary change sets.
 */
export class ActBuildStore {
  constructor(private readonly store: ProjectStore) {}

  private async readIndex(): Promise<Index> {
    const raw = await this.store.readFile(INDEX);
    if (raw === null) return { seq: 0, builds: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<Index>;
      return {
        seq: typeof parsed.seq === "number" ? parsed.seq : 0,
        builds: Array.isArray(parsed.builds) ? parsed.builds : [],
      };
    } catch {
      return { seq: 0, builds: [] };
    }
  }

  /** Allocate the next build id, e.g. `AB_0002`. */
  async nextId(): Promise<string> {
    const index = await this.readIndex();
    index.seq += 1;
    await this.writeIndex(index);
    return `AB_${String(index.seq).padStart(4, "0")}`;
  }

  /** Build summaries, newest first. */
  async list(limit = 50): Promise<ActBuildSummary[]> {
    const index = await this.readIndex();
    return [...index.builds].reverse().slice(0, limit);
  }

  async get(id: string): Promise<ActBuild | null> {
    const raw = await this.store.readFile(`${DIR}/${id}.json`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as ActBuild;
    } catch {
      return null;
    }
  }

  /** Insert or replace a build, keeping its summary in the index current. */
  async save(build: ActBuild): Promise<ActBuild> {
    await this.store.createDirectory(DIR);
    await this.store.writeFile(`${DIR}/${build.id}.json`, `${JSON.stringify(build, null, 2)}\n`);

    const index = await this.readIndex();
    const summary = summariseActBuild(build);
    const at = index.builds.findIndex((entry) => entry.id === build.id);
    if (at === -1) index.builds.push(summary);
    else index.builds[at] = summary;
    await this.writeIndex(index);
    return build;
  }

  private async writeIndex(index: Index): Promise<void> {
    await this.store.createDirectory(DIR);
    await this.store.writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`);
  }
}
