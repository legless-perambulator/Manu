import { WRITER_DIR, type StoryTest } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";

const PATH = `${WRITER_DIR}/tests/story_tests.json`;

interface Log {
  seq: number;
  tests: StoryTest[];
}

/**
 * Persists story tests in `.writer/tests/story_tests.json`.
 *
 * A test is **canon**: it is the writer's stated intention for their own story,
 * as authored as a character or a world rule. So it goes through the journaled
 * store and is as revertible as prose — deleting a test a year of revision was
 * built around should be something you can undo (docs/STORY_TESTS.md,
 * docs/VERSIONING.md).
 */
export class TestStore {
  constructor(private readonly store: ProjectStore) {}

  private async read(): Promise<Log> {
    const raw = await this.store.readFile(PATH);
    if (raw === null) return { seq: 0, tests: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<Log>;
      return {
        seq: typeof parsed.seq === "number" ? parsed.seq : 0,
        tests: Array.isArray(parsed.tests) ? parsed.tests : [],
      };
    } catch {
      return { seq: 0, tests: [] };
    }
  }

  private async write(log: Log): Promise<void> {
    await this.store.writeFile(PATH, `${JSON.stringify(log, null, 2)}\n`);
  }

  async list(): Promise<StoryTest[]> {
    return (await this.read()).tests;
  }

  async get(id: string): Promise<StoryTest | null> {
    return (await this.read()).tests.find((t) => t.id === id) ?? null;
  }

  /** Append tests, assigning IDs. Returns the stored records. */
  async append(drafts: ReadonlyArray<Omit<StoryTest, "id">>): Promise<StoryTest[]> {
    const log = await this.read();
    const stored = drafts.map((draft) => {
      log.seq += 1;
      return { ...draft, id: `TEST_${String(log.seq).padStart(4, "0")}` } as StoryTest;
    });
    log.tests.push(...stored);
    await this.write(log);
    return stored;
  }

  async update(id: string, patch: Partial<StoryTest>): Promise<StoryTest | null> {
    const log = await this.read();
    const at = log.tests.findIndex((t) => t.id === id);
    if (at === -1) return null;
    const next = { ...(log.tests[at] as StoryTest), ...patch, id } as StoryTest;
    log.tests[at] = next;
    await this.write(log);
    return next;
  }

  async remove(id: string): Promise<boolean> {
    const log = await this.read();
    const next = log.tests.filter((t) => t.id !== id);
    if (next.length === log.tests.length) return false;
    log.tests = next;
    await this.write(log);
    return true;
  }

  /** Tests naming an entity — used when that entity is about to be deleted. */
  async citing(
    entityId: string,
    names: (test: StoryTest) => readonly string[],
  ): Promise<StoryTest[]> {
    return (await this.list()).filter((test) => names(test).includes(entityId));
  }
}
