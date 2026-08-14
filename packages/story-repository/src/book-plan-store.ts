import type { BookAct, BookPlan, BookPlanRevision } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";
import { RepositoryError } from "./errors";

const PATH = "plot/book.json";

/** Earlier versions kept for comparison; the journal holds the byte history. */
const MAX_REVISIONS = 10;

/**
 * The book plan, as one plain project file: `plot/book.json`.
 *
 * A project has one book, so it has one book plan — no id minting, no index.
 * The plan names the acts (by their act-plan keys), the acts name their
 * chapters, the chapter plans name their scenes: each level of the hierarchy
 * is stored, versioned and approved at its own level (§5).
 *
 * Same contract as the chapter and act plan stores: handed the repository's
 * journaled store, every save an ordinary change set, every save a version
 * bump with a bounded structured snapshot.
 */
export class BookPlanStore {
  constructor(private readonly store: ProjectStore) {}

  /** The book plan, or null when none has been made. */
  async get(): Promise<BookPlan | null> {
    const raw = await this.store.readFile(PATH);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as BookPlan;
    } catch {
      return null;
    }
  }

  /** Save the plan, bumping its version and snapshotting the one it replaces. */
  async save(
    plan: Omit<BookPlan, "version" | "revisions" | "createdAt" | "updatedAt"> & {
      createdAt?: string;
    },
    options: { note?: string; now?: string } = {},
  ): Promise<BookPlan> {
    const now = options.now ?? new Date().toISOString();
    const existing = await this.get();

    const revisions: BookPlanRevision[] =
      existing === null
        ? []
        : [
            ...existing.revisions,
            {
              version: existing.version,
              savedAt: existing.updatedAt,
              ...(options.note !== undefined ? { note: options.note } : {}),
              ...(existing.premise !== undefined ? { premise: existing.premise } : {}),
              acts: existing.acts,
            },
          ].slice(-MAX_REVISIONS);

    const stored: BookPlan = {
      ...plan,
      version: existing === null ? 1 : existing.version + 1,
      createdAt: existing?.createdAt ?? plan.createdAt ?? now,
      updatedAt: now,
      revisions,
    };
    await this.store.createDirectory("plot");
    await this.store.writeFile(PATH, `${JSON.stringify(stored, null, 2)}\n`);
    return stored;
  }

  /** Mark the plan approved, in one version bump pinning `approvedVersion`. */
  async approve(options: { now?: string } = {}): Promise<BookPlan> {
    const existing = await this.get();
    if (existing === null) {
      throw new RepositoryError("entity_not_found", "No book plan exists to approve.");
    }
    const now = options.now ?? new Date().toISOString();
    const nextVersion = existing.version + 1;
    const stored: BookPlan = {
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
          ...(existing.premise !== undefined ? { premise: existing.premise } : {}),
          acts: existing.acts,
        },
      ].slice(-MAX_REVISIONS),
    };
    await this.store.writeFile(PATH, `${JSON.stringify(stored, null, 2)}\n`);
    return stored;
  }

  /** A kept version's acts, or an error naming what is still held. */
  async revision(
    version: number,
  ): Promise<{ version: number; premise?: string; acts: readonly BookAct[] }> {
    const plan = await this.get();
    if (plan === null) {
      throw new RepositoryError("entity_not_found", "No book plan exists.");
    }
    if (version === plan.version) {
      return {
        version: plan.version,
        ...(plan.premise !== undefined ? { premise: plan.premise } : {}),
        acts: plan.acts,
      };
    }
    const kept = plan.revisions.find((revision) => revision.version === version);
    if (kept === undefined) {
      throw new RepositoryError(
        "entity_not_found",
        `Version ${String(version)} of the book plan is no longer held (versions kept: ${plan.revisions
          .map((revision) => String(revision.version))
          .join(", ")}, current: ${String(plan.version)}).`,
      );
    }
    return {
      version: kept.version,
      ...(kept.premise !== undefined ? { premise: kept.premise } : {}),
      acts: kept.acts,
    };
  }
}
