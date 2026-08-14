import type { ChapterPlan, PlanRevision, PlannedScene } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";
import { RepositoryError } from "./errors";

const DIR = "plot/plans";

/** Earlier versions kept for comparison. Ten is a working set, not an archive —
 * the journal holds the complete byte-level history of the file anyway. */
const MAX_REVISIONS = 10;

/**
 * Chapter plans, as plain project files under `plot/plans/`.
 *
 * A plan is the writer's working document — the intermediate representation
 * between an outline and the Chapter Builder — so it lives with the writer's
 * other plot material, not in `.writer/`. The store is handed the repository's
 * **journaled** store, which means every save is an ordinary change set:
 * plan history rides the versioning system that already exists rather than a
 * new one built for plans (§16).
 *
 * On top of the journal, each save bumps `version` and keeps a bounded
 * structured snapshot of what it replaced, so "compare v3 with v4" is a
 * structural answer (`comparePlanVersions`) rather than a byte diff.
 */
export class ChapterPlanStore {
  constructor(private readonly store: ProjectStore) {}

  private pathFor(chapterId: string): string {
    return `${DIR}/${chapterId}.json`;
  }

  /** The current plan for a chapter, or null when none has been made. */
  async get(chapterId: string): Promise<ChapterPlan | null> {
    const raw = await this.store.readFile(this.pathFor(chapterId));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as ChapterPlan;
    } catch {
      return null;
    }
  }

  /** Every chapter that has a plan, by chapter id. */
  async list(): Promise<string[]> {
    const files = await this.store.list(DIR);
    return files
      .filter((path) => path.startsWith(`${DIR}/`) && path.endsWith(".json"))
      .map((path) => path.slice(DIR.length + 1, -".json".length))
      .sort();
  }

  /**
   * Save a plan, bumping its version and snapshotting the one it replaces.
   *
   * The caller passes the plan *as it should now read*; the store owns the
   * version arithmetic so no two writers can disagree about it. A brand-new
   * plan starts at version 1 with no revisions.
   */
  async save(
    plan: Omit<ChapterPlan, "version" | "revisions" | "createdAt" | "updatedAt"> & {
      createdAt?: string;
    },
    options: { note?: string; now?: string } = {},
  ): Promise<ChapterPlan> {
    const now = options.now ?? new Date().toISOString();
    const existing = await this.get(plan.chapterId);

    const revisions: PlanRevision[] =
      existing === null
        ? []
        : [
            ...existing.revisions,
            {
              version: existing.version,
              savedAt: existing.updatedAt,
              ...(options.note !== undefined ? { note: options.note } : {}),
              ...(existing.objective !== undefined ? { objective: existing.objective } : {}),
              scenes: existing.scenes,
            },
          ].slice(-MAX_REVISIONS);

    const stored: ChapterPlan = {
      ...plan,
      version: existing === null ? 1 : existing.version + 1,
      createdAt: existing?.createdAt ?? plan.createdAt ?? now,
      updatedAt: now,
      revisions,
    };
    await this.store.createDirectory(DIR);
    await this.store.writeFile(
      this.pathFor(plan.chapterId),
      `${JSON.stringify(stored, null, 2)}\n`,
    );
    return stored;
  }

  /**
   * Mark the current plan approved, in one version bump.
   *
   * Approval changes the plan (status, the materialised scene ids, the pinned
   * `approvedVersion`) and is itself a revision — but exactly one, so "the
   * approved version" is a single number the builder can hold on to. The store
   * owns this rather than the caller because it owns the version arithmetic.
   */
  async approve(
    chapterId: string,
    scenes: readonly PlannedScene[],
    options: { now?: string } = {},
  ): Promise<ChapterPlan> {
    const existing = await this.get(chapterId);
    if (existing === null) {
      throw new RepositoryError("entity_not_found", `No plan exists for ${chapterId} to approve.`);
    }
    const now = options.now ?? new Date().toISOString();
    const nextVersion = existing.version + 1;
    const stored: ChapterPlan = {
      ...existing,
      version: nextVersion,
      status: "approved",
      approvedVersion: nextVersion,
      scenes,
      updatedAt: now,
      revisions: [
        ...existing.revisions,
        {
          version: existing.version,
          savedAt: existing.updatedAt,
          note: "before approval",
          ...(existing.objective !== undefined ? { objective: existing.objective } : {}),
          scenes: existing.scenes,
        },
      ].slice(-MAX_REVISIONS),
    };
    await this.store.writeFile(this.pathFor(chapterId), `${JSON.stringify(stored, null, 2)}\n`);
    return stored;
  }

  /**
   * A specific version's scenes: the current one, or a kept snapshot.
   *
   * Old versions beyond the bounded window are genuinely gone from the
   * structured record — the journal still has the file's bytes — and asking
   * for one is an error rather than a silent nearest-match.
   */
  async revision(
    chapterId: string,
    version: number,
  ): Promise<{ version: number; objective?: string; scenes: readonly PlannedScene[] }> {
    const plan = await this.get(chapterId);
    if (plan === null) {
      throw new RepositoryError("entity_not_found", `No plan exists for ${chapterId}.`);
    }
    if (version === plan.version) {
      return {
        version: plan.version,
        ...(plan.objective !== undefined ? { objective: plan.objective } : {}),
        scenes: plan.scenes,
      };
    }
    const kept = plan.revisions.find((revision) => revision.version === version);
    if (kept === undefined) {
      throw new RepositoryError(
        "entity_not_found",
        `Version ${String(version)} of the plan for ${chapterId} is no longer held (versions kept: ${plan.revisions
          .map((revision) => String(revision.version))
          .join(", ")}, current: ${String(plan.version)}).`,
      );
    }
    return {
      version: kept.version,
      ...(kept.objective !== undefined ? { objective: kept.objective } : {}),
      scenes: kept.scenes,
    };
  }
}
