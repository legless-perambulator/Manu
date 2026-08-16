import { SCHEMA_VERSION } from "@jellytind/domain";
import type { ProjectManifest } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";
import { RepositoryError } from "./errors";

/**
 * Schema migration.
 *
 * The audit found that a project claiming `schemaVersion: 0` opened without
 * complaint and was then read under version-1 assumptions. That is the quiet
 * kind of data corruption: nothing fails, and the project is silently
 * reinterpreted.
 *
 * The rule here is that **every version is accounted for**. A version above
 * what this build knows is refused (update Manu). A version below is migrated
 * by an explicit, registered step — or refused, if no step exists. There is no
 * path where an unknown number is treated as current.
 */

/** The oldest schema this build can read directly, without migrating. */
export const MIN_READABLE_SCHEMA = 1 as const;

export interface Migration {
  /** The version this step upgrades *from*. It produces `from + 1`. */
  readonly from: number;
  readonly description: string;
  /**
   * Perform the upgrade. Runs against the project store, and must be safe to
   * re-run: a migration interrupted half-way is retried on the next open.
   */
  run(store: ProjectStore): Promise<void>;
}

/**
 * Registered migrations, ordered.
 *
 * Deliberately empty. Version 1 is the only schema Manu has ever written, so
 * there is genuinely nothing to migrate from — and inventing a speculative
 * 0→1 step would be pretending to support projects that never existed. The
 * registry exists so the *next* schema change has one obvious place to go, and
 * so the "unknown version" path is a refusal rather than a shrug.
 */
export const MIGRATIONS: readonly Migration[] = [];

export interface MigrationOutcome {
  readonly from: number;
  readonly to: number;
  readonly applied: readonly string[];
}

/**
 * Bring a project up to the current schema, or refuse it.
 *
 * Called on open, before anything reads project content. Returns what was done
 * so the interface can tell the writer their project was upgraded rather than
 * doing it behind their back.
 */
export async function migrateProject(
  store: ProjectStore,
  manifest: ProjectManifest,
  // Injectable for the fixture tests, which exercise the multi-step path a
  // future schema change will take; production always uses the registry.
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<MigrationOutcome> {
  const found = manifest.schemaVersion;

  if (found > SCHEMA_VERSION) {
    throw new RepositoryError(
      "unsupported_schema",
      `This project was made by a newer version of Manu (schema ${String(found)}; this build reads ${String(SCHEMA_VERSION)}). Update Manu to open it.`,
      { details: { found, supported: SCHEMA_VERSION } },
    );
  }
  if (found === SCHEMA_VERSION) return { from: found, to: found, applied: [] };

  // Below the current version: every step must exist, or we refuse. Opening a
  // project we cannot correctly interpret is worse than not opening it.
  const applied: string[] = [];
  let at = found;
  while (at < SCHEMA_VERSION) {
    const step = migrations.find((migration) => migration.from === at);
    if (step === undefined) {
      throw new RepositoryError(
        "unsupported_schema",
        `This project claims schema ${String(found)}, which this build cannot upgrade (it reads ${String(MIN_READABLE_SCHEMA)} to ${String(SCHEMA_VERSION)}). Manu has not changed it.`,
        { details: { found, minReadable: MIN_READABLE_SCHEMA, supported: SCHEMA_VERSION } },
      );
    }
    await step.run(store);
    applied.push(step.description);
    at += 1;
  }
  return { from: found, to: at, applied };
}
