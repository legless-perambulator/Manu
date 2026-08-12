import { WRITER_DIR } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";
import type { BuildSummary, StoryBuild } from "@jellytind/story-compiler";

const DIR = `${WRITER_DIR}/builds`;
const INDEX = `${DIR}/index.json`;

interface Index {
  seq: number;
  builds: BuildSummary[];
}

/**
 * Persists story builds under `.writer/builds/`.
 *
 * A build is **derived**, not canon: it is what the project's state implies, and
 * running one changes nothing about the story. So builds are written straight to
 * the store rather than through the journal — a build is not a change set, and
 * recording it as one would fill a writer's history with entries they did not
 * make (docs/VERSIONING.md).
 *
 * Summaries live in one index so a history list is a single read; each build's
 * diagnostics live in their own file, because a project with a long history
 * should not pay for every past diagnostic to answer "how did the last build
 * go?".
 */
export class BuildStore {
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

  /** The number the next build will carry. */
  async nextNumber(): Promise<number> {
    return (await this.readIndex()).seq + 1;
  }

  /** Build summaries, newest first. */
  async list(limit = 50): Promise<BuildSummary[]> {
    const index = await this.readIndex();
    return [...index.builds].reverse().slice(0, limit);
  }

  /** The most recent build, with its diagnostics. */
  async latest(): Promise<StoryBuild | null> {
    const newest = (await this.list(1))[0];
    return newest === undefined ? null : this.get(newest.id);
  }

  async get(id: string): Promise<StoryBuild | null> {
    const raw = await this.store.readFile(`${DIR}/${id}.json`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as StoryBuild;
    } catch {
      return null;
    }
  }

  async append(build: StoryBuild): Promise<StoryBuild> {
    const index = await this.readIndex();
    const { diagnostics: _diagnostics, ...summary } = build;

    index.seq = Math.max(index.seq, build.number);
    index.builds = [...index.builds.filter((b) => b.id !== build.id), summary];

    await this.store.writeFile(`${DIR}/${build.id}.json`, `${JSON.stringify(build, null, 2)}\n`);
    await this.store.writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`);
    return build;
  }
}
