import { WRITER_DIR, summariseChapterBuild } from "@jellytind/domain";
import type { ChapterBuild, ChapterBuildSummary } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";

const DIR = `${WRITER_DIR}/builds/chapters`;
const INDEX = `${DIR}/index.json`;

interface Index {
  seq: number;
  builds: ChapterBuildSummary[];
}

/**
 * Persists chapter builds under `.writer/builds/chapters/`.
 *
 * The record is written after **every step** of the pipeline, because that is
 * the whole promise of §11: a writer can pause a build, close Manu, reopen it
 * tomorrow and resume at Scene 3. Every pause point, every held draft and
 * every diagnostic has to be on disk before the process can be trusted to die.
 *
 * Written straight to the store rather than through the journal, like workflow
 * runs: running a build is not itself a change to the story. The prose a build
 * **commits** goes through ordinary change sets, and the record keeps their
 * IDs — that is the audit trail, in the history system that already existed.
 */
export class ChapterBuildStore {
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

  /** Allocate the next build id, e.g. `CB_0003`. */
  async nextId(): Promise<string> {
    const index = await this.readIndex();
    index.seq += 1;
    await this.writeIndex(index);
    return `CB_${String(index.seq).padStart(4, "0")}`;
  }

  /** Build summaries, newest first. */
  async list(limit = 50): Promise<ChapterBuildSummary[]> {
    const index = await this.readIndex();
    return [...index.builds].reverse().slice(0, limit);
  }

  async get(id: string): Promise<ChapterBuild | null> {
    const raw = await this.store.readFile(`${DIR}/${id}.json`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as ChapterBuild;
    } catch {
      return null;
    }
  }

  /** Insert or replace a build, keeping its summary in the index current. */
  async save(build: ChapterBuild): Promise<ChapterBuild> {
    await this.store.createDirectory(DIR);
    await this.store.writeFile(`${DIR}/${build.id}.json`, `${JSON.stringify(build, null, 2)}\n`);

    const index = await this.readIndex();
    const summary = summariseChapterBuild(build);
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
