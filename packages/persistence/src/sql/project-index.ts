import type { SqlDatabase, SqlValue } from "./sql-database";
import { runMigrations } from "./migrations";

/**
 * A derived catalog record for an entity. The authoritative content of an entity
 * lives in the Story Repository's files; this index exists only to make listing
 * and querying fast, and is fully reconstructable from the files
 * (docs/STORY_REPOSITORY.md — derived data is never canonical).
 */
export interface EntityRecord {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly filePath?: string;
  readonly data?: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface EntityRow {
  id: string;
  kind: string;
  name: string;
  file_path: string | null;
  data: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The project's SQLite-backed derived index. Wraps a {@link SqlDatabase} binding
 * and exposes typed operations over the `entities` and `project_metadata` tables.
 * SQLite stores derived/application metadata only; it is never the exclusive home
 * of manuscript content.
 */
export class ProjectIndex {
  constructor(private readonly db: SqlDatabase) {}

  /** Apply pending migrations. Safe to call on every open. */
  init(): number {
    return runMigrations(this.db);
  }

  setMetadata(key: string, value: string): void {
    this.db.run(
      `INSERT INTO project_metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }

  getMetadata(key: string): string | undefined {
    const row = this.db.get<{ value: string }>("SELECT value FROM project_metadata WHERE key = ?", [
      key,
    ]);
    return row?.value;
  }

  upsertEntity(record: EntityRecord): void {
    const data = record.data === undefined ? null : JSON.stringify(record.data);
    const params: SqlValue[] = [
      record.id,
      record.kind,
      record.name,
      record.filePath ?? null,
      data,
      record.createdAt,
      record.updatedAt,
    ];
    this.db.run(
      `INSERT INTO entities (id, kind, name, file_path, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         name = excluded.name,
         file_path = excluded.file_path,
         data = excluded.data,
         updated_at = excluded.updated_at`,
      params,
    );
  }

  getEntity(id: string): EntityRecord | undefined {
    const row = this.db.get<EntityRow>("SELECT * FROM entities WHERE id = ?", [id]);
    return row ? rowToRecord(row) : undefined;
  }

  listEntities(kind?: string): EntityRecord[] {
    const rows =
      kind === undefined
        ? this.db.all<EntityRow>("SELECT * FROM entities ORDER BY id")
        : this.db.all<EntityRow>("SELECT * FROM entities WHERE kind = ? ORDER BY id", [kind]);
    return rows.map(rowToRecord);
  }

  removeEntity(id: string): void {
    this.db.run("DELETE FROM entities WHERE id = ?", [id]);
  }

  close(): void {
    this.db.close();
  }
}

function rowToRecord(row: EntityRow): EntityRecord {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    ...(row.file_path !== null ? { filePath: row.file_path } : {}),
    ...(row.data !== null ? { data: JSON.parse(row.data) as Record<string, unknown> } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
