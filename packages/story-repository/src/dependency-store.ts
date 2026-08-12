import type { Dependency } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";
import { PATHS } from "./paths";

interface Log {
  seq: number;
  dependencies: Dependency[];
}

/**
 * Persists registered dependencies in `plot/dependencies.json`.
 *
 * A dependency is **canon**: it is the author's claim about how their story
 * holds together, as authored as a plot thread or a setup. So it lives beside
 * them in `plot/` rather than under `.writer/`, travels with the project, and
 * goes through the journaled store — deleting a link a refactor was planned
 * around should be something you can undo (docs/STORY_REFACTOR.md,
 * docs/VERSIONING.md).
 *
 * Edges are not entities: they have no name, no file and no place in the entity
 * browser, so they carry their own `DEP_nnnn` sequence rather than a slot in the
 * project's entity ID generator.
 */
export class DependencyStore {
  constructor(private readonly store: ProjectStore) {}

  private async read(): Promise<Log> {
    const raw = await this.store.readFile(PATHS.dependencies);
    if (raw === null) return { seq: 0, dependencies: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<Log>;
      return {
        seq: typeof parsed.seq === "number" ? parsed.seq : 0,
        dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies : [],
      };
    } catch {
      return { seq: 0, dependencies: [] };
    }
  }

  private async write(log: Log): Promise<void> {
    await this.store.writeFile(PATHS.dependencies, `${JSON.stringify(log, null, 2)}\n`);
  }

  async list(): Promise<Dependency[]> {
    return (await this.read()).dependencies;
  }

  async get(id: string): Promise<Dependency | null> {
    return (await this.read()).dependencies.find((d) => d.id === id) ?? null;
  }

  /** Append dependencies, assigning IDs. Returns the stored records. */
  async append(drafts: ReadonlyArray<Omit<Dependency, "id">>): Promise<Dependency[]> {
    const log = await this.read();
    const stored = drafts.map((draft) => {
      log.seq += 1;
      return { ...draft, id: `DEP_${String(log.seq).padStart(4, "0")}` };
    });
    log.dependencies.push(...stored);
    await this.write(log);
    return stored;
  }

  async update(id: string, patch: Partial<Dependency>): Promise<Dependency | null> {
    const log = await this.read();
    const at = log.dependencies.findIndex((d) => d.id === id);
    if (at === -1) return null;
    const next = { ...(log.dependencies[at] as Dependency), ...patch, id };
    log.dependencies[at] = next;
    await this.write(log);
    return next;
  }

  async remove(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const log = await this.read();
    const wanted = new Set(ids);
    const next = log.dependencies.filter((d) => !wanted.has(d.id));
    const removed = log.dependencies.length - next.length;
    if (removed === 0) return 0;
    log.dependencies = next;
    await this.write(log);
    return removed;
  }

  /** Dependencies with an endpoint at this entity — used before deleting it. */
  async touching(entityId: string): Promise<Dependency[]> {
    return (await this.list()).filter((d) => d.fromId === entityId || d.toId === entityId);
  }
}
