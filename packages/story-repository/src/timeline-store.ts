import { WRITER_DIR, type TemporalLink, type TravelRule } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";

const PATH = `${WRITER_DIR}/state/timeline.json`;

interface Log {
  seq: number;
  links: TemporalLink[];
  travel: TravelRule[];
}

/**
 * Persists story chronology in `.writer/state/timeline.json`.
 *
 * Two kinds of authored statement live here. **Links** say how two moments
 * relate — "the confrontation happens after the funeral" — and are the whole
 * chronology for a story that carries no dates. **Travel rules** declare how
 * long a journey takes, because the system must never assume that: a check that
 * guessed at real-world distances would be wrong for most fiction and
 * confidently wrong for the rest (docs/TIMELINE.md).
 *
 * Both are canon, so both go through the journaled store and are as revertible
 * as prose.
 */
export class TimelineStore {
  constructor(private readonly store: ProjectStore) {}

  private async read(): Promise<Log> {
    const raw = await this.store.readFile(PATH);
    if (raw === null) return { seq: 0, links: [], travel: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<Log>;
      return {
        seq: typeof parsed.seq === "number" ? parsed.seq : 0,
        links: Array.isArray(parsed.links) ? parsed.links : [],
        travel: Array.isArray(parsed.travel) ? parsed.travel : [],
      };
    } catch {
      return { seq: 0, links: [], travel: [] };
    }
  }

  private async write(log: Log): Promise<void> {
    await this.store.writeFile(PATH, `${JSON.stringify(log, null, 2)}\n`);
  }

  async listLinks(): Promise<TemporalLink[]> {
    return (await this.read()).links;
  }

  async getLink(id: string): Promise<TemporalLink | null> {
    return (await this.read()).links.find((l) => l.id === id) ?? null;
  }

  /** Append links, assigning IDs. Returns the stored records. */
  async appendLinks(drafts: ReadonlyArray<Omit<TemporalLink, "id">>): Promise<TemporalLink[]> {
    const log = await this.read();
    const stored = drafts.map((draft) => {
      log.seq += 1;
      return { ...draft, id: `TLINK_${String(log.seq).padStart(4, "0")}` };
    });
    log.links.push(...stored);
    await this.write(log);
    return stored;
  }

  async updateLink(id: string, patch: Partial<TemporalLink>): Promise<TemporalLink | null> {
    const log = await this.read();
    const at = log.links.findIndex((l) => l.id === id);
    if (at === -1) return null;
    const next = { ...(log.links[at] as TemporalLink), ...patch, id };
    log.links[at] = next;
    await this.write(log);
    return next;
  }

  async removeLink(id: string): Promise<boolean> {
    const log = await this.read();
    const next = log.links.filter((l) => l.id !== id);
    if (next.length === log.links.length) return false;
    log.links = next;
    await this.write(log);
    return true;
  }

  /** Remove every link touching an entity. Used when that entity is deleted. */
  async removeLinksFor(entityId: string): Promise<string[]> {
    const log = await this.read();
    const doomed = log.links.filter((l) => l.fromId === entityId || l.toId === entityId);
    if (doomed.length === 0) return [];
    log.links = log.links.filter((l) => l.fromId !== entityId && l.toId !== entityId);
    await this.write(log);
    return doomed.map((l) => l.id);
  }

  async listTravelRules(): Promise<TravelRule[]> {
    return (await this.read()).travel;
  }

  async appendTravelRules(drafts: ReadonlyArray<Omit<TravelRule, "id">>): Promise<TravelRule[]> {
    const log = await this.read();
    const stored = drafts.map((draft) => {
      log.seq += 1;
      return { ...draft, id: `TRAVEL_${String(log.seq).padStart(4, "0")}` };
    });
    log.travel.push(...stored);
    await this.write(log);
    return stored;
  }

  async removeTravelRule(id: string): Promise<boolean> {
    const log = await this.read();
    const next = log.travel.filter((r) => r.id !== id);
    if (next.length === log.travel.length) return false;
    log.travel = next;
    await this.write(log);
    return true;
  }
}
