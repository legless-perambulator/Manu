/**
 * A tiny synchronous SQL port. Concrete bindings implement it — `node:sqlite`
 * for tests/host use, and (later) a Tauri/rusqlite adapter for the renderer.
 * Keeping the port here lets the migration runner and {@link ProjectIndex} stay
 * binding-independent and fully testable, and keeps `node:*` imports out of the
 * browser bundle.
 */
export type SqlValue = string | number | bigint | null | Uint8Array;

export interface SqlDatabase {
  /** Execute one or more statements with no parameters. */
  exec(sql: string): void;
  /** Execute a single parameterised statement. */
  run(sql: string, params?: readonly SqlValue[]): void;
  /** Run a query and return all rows. */
  all<T = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): T[];
  /** Run a query and return the first row, or `undefined`. */
  get<T = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): T | undefined;
  close(): void;
}
