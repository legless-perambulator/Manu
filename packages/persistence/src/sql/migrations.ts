import type { SqlDatabase } from "./sql-database";

/**
 * A forward-only schema migration. `up` is the SQL applied to move the database
 * to `version`. Migrations are the single source of truth for the derived
 * database schema and are versioned from the start (docs/STORY_REPOSITORY.md).
 */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
}

/**
 * Ordered migration set. Append new migrations with the next integer version;
 * never edit an already-released migration.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "init",
    up: `
      CREATE TABLE project_metadata (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE entities (
        id         TEXT PRIMARY KEY,
        kind       TEXT NOT NULL,
        name       TEXT NOT NULL,
        file_path  TEXT,
        data       TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX entities_kind_idx ON entities (kind);
    `,
  },
];

/** The highest migration version defined in this build. */
export function latestSchemaVersion(): number {
  return MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
}

/**
 * Apply any pending migrations, recording each in `schema_migrations`. Idempotent:
 * running twice applies nothing the second time. Each migration runs in its own
 * transaction, so an interrupted run never leaves a half-applied version.
 *
 * @returns the number of migrations applied during this call.
 */
export function runMigrations(db: SqlDatabase): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db.all<{ version: number }>("SELECT version FROM schema_migrations").map((r) => r.version),
  );

  let count = 0;
  for (const migration of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (applied.has(migration.version)) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.up);
      db.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)", [
        migration.version,
        migration.name,
        new Date().toISOString(),
      ]);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    count += 1;
  }
  return count;
}

/** The current applied schema version recorded in the database (0 if none). */
export function currentSchemaVersion(db: SqlDatabase): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const row = db.get<{ v: number | null }>("SELECT MAX(version) AS v FROM schema_migrations");
  return row?.v ?? 0;
}
