import type { ActChapter, ActPlan, ActPlanRevision } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";
import { RepositoryError } from "./errors";

const DIR = "plot/acts";

/** Earlier versions kept for comparison; the journal holds the byte history. */
const MAX_REVISIONS = 10;

/**
 * Act plans, as plain project files under `plot/acts/`.
 *
 * An act is not an entity in the ID registry — it is named by the chapters
 * that make it up, and the plan file *is* the act's definition. `actId` is a
 * stable key the store mints (`ACT_0001`), never derived from the title, so
 * renaming "Act II" to "Part Two" changes nothing structural.
 *
 * Same contract as {@link ChapterPlanStore}: the store is handed the
 * repository's journaled store, every save is an ordinary change set, every
 * save bumps `version` and keeps a bounded structured snapshot.
 */
export class ActPlanStore {
  constructor(private readonly store: ProjectStore) {}

  private pathFor(actId: string): string {
    return `${DIR}/${actId}.json`;
  }

  /** The current plan for an act, or null when none exists. */
  async get(actId: string): Promise<ActPlan | null> {
    const raw = await this.store.readFile(this.pathFor(actId));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as ActPlan;
    } catch {
      return null;
    }
  }

  /** Every act that has a plan, by act id, in mint order. */
  async list(): Promise<string[]> {
    const files = await this.store.list(DIR);
    return files
      .filter((path) => path.startsWith(`${DIR}/`) && path.endsWith(".json"))
      .map((path) => path.slice(DIR.length + 1, -".json".length))
      .sort();
  }

  /** Mint the next act key: `ACT_0001`, `ACT_0002`, … */
  async nextActId(): Promise<string> {
    const existing = await this.list();
    let highest = 0;
    for (const id of existing) {
      const match = /^ACT_(\d+)$/.exec(id);
      if (match !== null) highest = Math.max(highest, Number.parseInt(match[1] as string, 10));
    }
    return `ACT_${String(highest + 1).padStart(4, "0")}`;
  }

  /**
   * Save a plan, bumping its version and snapshotting the one it replaces.
   * The store owns the version arithmetic; a brand-new plan starts at 1.
   */
  async save(
    plan: Omit<ActPlan, "version" | "revisions" | "createdAt" | "updatedAt"> & {
      createdAt?: string;
    },
    options: { note?: string; now?: string } = {},
  ): Promise<ActPlan> {
    const now = options.now ?? new Date().toISOString();
    const existing = await this.get(plan.actId);

    const revisions: ActPlanRevision[] =
      existing === null
        ? []
        : [
            ...existing.revisions,
            {
              version: existing.version,
              savedAt: existing.updatedAt,
              ...(options.note !== undefined ? { note: options.note } : {}),
              ...(existing.objective !== undefined ? { objective: existing.objective } : {}),
              chapters: existing.chapters,
            },
          ].slice(-MAX_REVISIONS);

    const stored: ActPlan = {
      ...plan,
      version: existing === null ? 1 : existing.version + 1,
      createdAt: existing?.createdAt ?? plan.createdAt ?? now,
      updatedAt: now,
      revisions,
    };
    await this.store.createDirectory(DIR);
    await this.store.writeFile(this.pathFor(plan.actId), `${JSON.stringify(stored, null, 2)}\n`);
    return stored;
  }

  /**
   * Mark the current plan approved, in one version bump, pinning
   * `approvedVersion` — the single number an act build holds on to.
   */
  async approve(actId: string, options: { now?: string } = {}): Promise<ActPlan> {
    const existing = await this.get(actId);
    if (existing === null) {
      throw new RepositoryError("entity_not_found", `No act plan exists for ${actId} to approve.`);
    }
    const now = options.now ?? new Date().toISOString();
    const nextVersion = existing.version + 1;
    const stored: ActPlan = {
      ...existing,
      version: nextVersion,
      status: "approved",
      approvedVersion: nextVersion,
      updatedAt: now,
      revisions: [
        ...existing.revisions,
        {
          version: existing.version,
          savedAt: existing.updatedAt,
          note: "before approval",
          ...(existing.objective !== undefined ? { objective: existing.objective } : {}),
          chapters: existing.chapters,
        },
      ].slice(-MAX_REVISIONS),
    };
    await this.store.writeFile(this.pathFor(actId), `${JSON.stringify(stored, null, 2)}\n`);
    return stored;
  }

  /** A kept version's chapters, or an error naming what is still held. */
  async revision(
    actId: string,
    version: number,
  ): Promise<{ version: number; objective?: string; chapters: readonly ActChapter[] }> {
    const plan = await this.get(actId);
    if (plan === null) {
      throw new RepositoryError("entity_not_found", `No act plan exists for ${actId}.`);
    }
    if (version === plan.version) {
      return {
        version: plan.version,
        ...(plan.objective !== undefined ? { objective: plan.objective } : {}),
        chapters: plan.chapters,
      };
    }
    const kept = plan.revisions.find((revision) => revision.version === version);
    if (kept === undefined) {
      throw new RepositoryError(
        "entity_not_found",
        `Version ${String(version)} of the plan for ${actId} is no longer held (versions kept: ${plan.revisions
          .map((revision) => String(revision.version))
          .join(", ")}, current: ${String(plan.version)}).`,
      );
    }
    return {
      version: kept.version,
      ...(kept.objective !== undefined ? { objective: kept.objective } : {}),
      chapters: kept.chapters,
    };
  }
}
