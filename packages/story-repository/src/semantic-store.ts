import { WRITER_DIR } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";
import type {
  SemanticBuild,
  SemanticCacheEntry,
  SemanticStatusEntry,
} from "@jellytind/story-compiler";

const DIR = `${WRITER_DIR}/semantic`;
const STATUS_PATH = `${DIR}/statuses.json`;
const CACHE_PATH = `${DIR}/cache.json`;
const CONFIG_PATH = `${DIR}/config.json`;
const LAST_PATH = `${DIR}/last.json`;

/**
 * The semantic layer's persistence (Phase 37 §6, §13–§14).
 *
 * Lives under `.writer/semantic/` — judgements about the story are working
 * state, not authored knowledge, so nothing here journals. What it holds:
 *
 * - **statuses** — the writer's word per finding fingerprint ("this is
 *   intentional"), which is what stops a rebuild nagging;
 * - **cache** — judgements already bought, keyed by rule and valid while the
 *   material hash matches;
 * - **config** — semantic rules the writer has switched off;
 * - **last** — the most recent semantic build, so the panel reopens where it
 *   left off.
 */
export class SemanticStore {
  constructor(private readonly store: ProjectStore) {}

  private async readJson<T>(path: string, fallback: T): Promise<T> {
    const raw = await this.store.readFile(path);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await this.store.createDirectory(DIR);
    await this.store.writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  async statuses(): Promise<Record<string, SemanticStatusEntry>> {
    return this.readJson(STATUS_PATH, {});
  }

  /** Set the writer's word on one finding, or clear it with `null` (§14). */
  async setStatus(fingerprint: string, entry: SemanticStatusEntry | null): Promise<void> {
    const held = await this.statuses();
    if (entry === null) delete held[fingerprint];
    else held[fingerprint] = entry;
    await this.writeJson(STATUS_PATH, held);
  }

  /** Drop statuses whose findings resolved — reported by the build (§14). */
  async prune(resolved: readonly string[]): Promise<void> {
    if (resolved.length === 0) return;
    const held = await this.statuses();
    for (const fingerprint of resolved) delete held[fingerprint];
    await this.writeJson(STATUS_PATH, held);
  }

  async cacheGet(key: string): Promise<SemanticCacheEntry | null> {
    const held = await this.readJson<Record<string, SemanticCacheEntry>>(CACHE_PATH, {});
    return held[key] ?? null;
  }

  async cacheSet(key: string, entry: SemanticCacheEntry): Promise<void> {
    const held = await this.readJson<Record<string, SemanticCacheEntry>>(CACHE_PATH, {});
    held[key] = entry;
    await this.writeJson(CACHE_PATH, held);
  }

  async disabledRules(): Promise<string[]> {
    const held = await this.readJson<{ disabledRules?: string[] }>(CONFIG_PATH, {});
    return Array.isArray(held.disabledRules) ? held.disabledRules : [];
  }

  async setDisabledRules(ruleIds: readonly string[]): Promise<void> {
    await this.writeJson(CONFIG_PATH, { disabledRules: [...ruleIds] });
  }

  async saveLastBuild(build: SemanticBuild): Promise<void> {
    await this.writeJson(LAST_PATH, build);
  }

  async lastBuild(): Promise<SemanticBuild | null> {
    return this.readJson<SemanticBuild | null>(LAST_PATH, null);
  }
}
