import { WRITER_DIR, summariseBookBuild } from "@jellytind/domain";
import type { BookBuild, BookBuildSummary } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";

const DIR = `${WRITER_DIR}/builds/book`;
const INDEX = `${DIR}/index.json`;

interface Index {
  seq: number;
  builds: BookBuildSummary[];
}

/**
 * Persists book builds under `.writer/builds/book/`.
 *
 * The record is written after every book-level step. A book build may span
 * hours and many application sessions (§12): everything needed to resume —
 * completed acts, the current act's child build id, the open gate, the
 * checkpoint chain — is on disk before the process can be trusted to die.
 * Not journaled, like every build record: running a build is not a change to
 * the story; what it commits arrives through ordinary change sets far below.
 */
export class BookBuildStore {
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

  /** Allocate the next build id, e.g. `BB_0001`. */
  async nextId(): Promise<string> {
    const index = await this.readIndex();
    index.seq += 1;
    await this.writeIndex(index);
    return `BB_${String(index.seq).padStart(4, "0")}`;
  }

  /** Build summaries, newest first. */
  async list(limit = 20): Promise<BookBuildSummary[]> {
    const index = await this.readIndex();
    return [...index.builds].reverse().slice(0, limit);
  }

  async get(id: string): Promise<BookBuild | null> {
    const raw = await this.store.readFile(`${DIR}/${id}.json`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as BookBuild;
    } catch {
      return null;
    }
  }

  /** Insert or replace a build, keeping its summary in the index current. */
  async save(build: BookBuild): Promise<BookBuild> {
    await this.store.createDirectory(DIR);
    await this.store.writeFile(`${DIR}/${build.id}.json`, `${JSON.stringify(build, null, 2)}\n`);

    const index = await this.readIndex();
    const summary = summariseBookBuild(build);
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
