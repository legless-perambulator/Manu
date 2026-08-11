/**
 * Structured, queryable state storage — the SQLite-backed derived store in
 * production (docs/STORY_REPOSITORY.md). Everything here is *derived* and
 * reconstructable from the portable project files; it must never become the
 * authoritative source of canon.
 *
 * Phase 0 provides the interface plus an in-memory implementation. A real
 * SQLite adapter is planned (see docs/ROADMAP.md, V1/V2).
 */
export interface StateStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

/** In-memory {@link StateStore} for tests and early development. */
export class InMemoryStateStore implements StateStore {
  private readonly entries = new Map<string, unknown>();

  get<T>(key: string): Promise<T | null> {
    return Promise.resolve((this.entries.get(key) as T | undefined) ?? null);
  }

  set<T>(key: string, value: T): Promise<void> {
    // Store a structural clone so callers cannot mutate stored state by
    // reference — mirroring a real serialising backend.
    this.entries.set(key, structuredClone(value));
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  keys(prefix?: string): Promise<string[]> {
    const wanted = prefix ?? "";
    return Promise.resolve([...this.entries.keys()].filter((k) => k.startsWith(wanted)).sort());
  }
}
