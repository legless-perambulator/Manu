import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type * as NodeSqlite from "node:sqlite";
import type { DatabaseSync } from "node:sqlite";
import type { SqlDatabase, SqlValue } from "../sql/sql-database";

// Load `node:sqlite` through a runtime require so bundler-based test runners
// (vite-node) don't try to resolve this newer builtin at transform time.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync: DatabaseSyncCtor } = nodeRequire("node:sqlite") as typeof NodeSqlite;

/**
 * {@link SqlDatabase} backed by Node's built-in `node:sqlite`. Zero native npm
 * dependencies. Used by tests and any Node-hosted context; the browser renderer
 * uses a Tauri/rusqlite adapter instead. Import from `@jellytind/persistence/node`.
 */
export class NodeSqlDatabase implements SqlDatabase {
  private readonly db: DatabaseSync;

  /** @param location a filesystem path, or `":memory:"` for an ephemeral DB. */
  constructor(location = ":memory:") {
    if (location !== ":memory:") {
      mkdirSync(dirname(location), { recursive: true });
    }
    this.db = new DatabaseSyncCtor(location);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params: readonly SqlValue[] = []): void {
    this.db.prepare(sql).run(...(params as SqlValue[]));
  }

  all<T = Record<string, SqlValue>>(sql: string, params: readonly SqlValue[] = []): T[] {
    return this.db.prepare(sql).all(...(params as SqlValue[])) as T[];
  }

  get<T = Record<string, SqlValue>>(sql: string, params: readonly SqlValue[] = []): T | undefined {
    return this.db.prepare(sql).get(...(params as SqlValue[])) as T | undefined;
  }

  close(): void {
    this.db.close();
  }
}
