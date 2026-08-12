import { WRITER_DIR } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";
import type { StateTransition } from "@jellytind/story-state";

const PATH = `${WRITER_DIR}/state/transitions.json`;

interface Log {
  seq: number;
  transitions: StateTransition[];
}

/**
 * Persists story-state transitions in `.writer/state/transitions.json`.
 *
 * Human-readable JSON alongside the manuscript, like everything else in the
 * project: state is canon, so it travels with the story rather than living in a
 * derived index (docs/STORY_STATE.md, AGENTS.md — "Local-First Principles").
 *
 * Written through the journaled store, so every change to state is captured as
 * a reversible change set — unlike agent activity, a transition *is* project
 * canon (docs/VERSIONING.md).
 */
export class TransitionStore {
  constructor(private readonly store: ProjectStore) {}

  private async read(): Promise<Log> {
    const raw = await this.store.readFile(PATH);
    if (raw === null) return { seq: 0, transitions: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<Log>;
      return {
        seq: typeof parsed.seq === "number" ? parsed.seq : 0,
        transitions: Array.isArray(parsed.transitions) ? parsed.transitions : [],
      };
    } catch {
      return { seq: 0, transitions: [] };
    }
  }

  private async write(log: Log): Promise<void> {
    await this.store.writeFile(PATH, `${JSON.stringify(log, null, 2)}\n`);
  }

  async list(): Promise<StateTransition[]> {
    return (await this.read()).transitions;
  }

  async get(id: string): Promise<StateTransition | null> {
    return (await this.read()).transitions.find((t) => t.id === id) ?? null;
  }

  /** Append transitions, assigning IDs. Returns the stored records. */
  async append(drafts: ReadonlyArray<Omit<StateTransition, "id">>): Promise<StateTransition[]> {
    const log = await this.read();
    const stored = drafts.map((draft) => {
      log.seq += 1;
      return { ...draft, id: `TRANS_${String(log.seq).padStart(4, "0")}` };
    });
    log.transitions.push(...stored);
    await this.write(log);
    return stored;
  }

  async update(id: string, patch: Partial<StateTransition>): Promise<StateTransition | null> {
    const log = await this.read();
    const at = log.transitions.findIndex((t) => t.id === id);
    if (at === -1) return null;
    const next = { ...(log.transitions[at] as StateTransition), ...patch, id };
    log.transitions[at] = next;
    await this.write(log);
    return next;
  }

  async remove(id: string): Promise<boolean> {
    const log = await this.read();
    const next = log.transitions.filter((t) => t.id !== id);
    if (next.length === log.transitions.length) return false;
    log.transitions = next;
    await this.write(log);
    return true;
  }
}
