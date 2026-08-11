import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeSqlDatabase } from "./node-sql-database";
import { runMigrations, currentSchemaVersion, latestSchemaVersion } from "../sql/migrations";
import { ProjectIndex } from "../sql/project-index";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jellytind-sql-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("migrations", () => {
  it("applies pending migrations once (idempotent)", () => {
    const db = new NodeSqlDatabase();
    expect(runMigrations(db)).toBe(latestSchemaVersion());
    expect(runMigrations(db)).toBe(0);
    expect(currentSchemaVersion(db)).toBe(latestSchemaVersion());
    db.close();
  });

  it("creates the expected tables", () => {
    const db = new NodeSqlDatabase();
    runMigrations(db);
    const tables = db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .map((r) => r.name);
    expect(tables).toContain("schema_migrations");
    expect(tables).toContain("project_metadata");
    expect(tables).toContain("entities");
    db.close();
  });
});

describe("ProjectIndex", () => {
  it("upserts, lists, gets and removes entities", () => {
    const index = new ProjectIndex(new NodeSqlDatabase());
    index.init();
    const now = new Date().toISOString();
    index.upsertEntity({
      id: "CHAR_0001",
      kind: "character",
      name: "Elias",
      filePath: "characters/CHAR_0001.md",
      createdAt: now,
      updatedAt: now,
    });
    index.upsertEntity({
      id: "CHAR_0001",
      kind: "character",
      name: "Elias Vale",
      filePath: "characters/CHAR_0001.md",
      createdAt: now,
      updatedAt: new Date().toISOString(),
    });
    expect(index.getEntity("CHAR_0001")?.name).toBe("Elias Vale");
    index.upsertEntity({
      id: "LOC_0001",
      kind: "location",
      name: "Manor",
      createdAt: now,
      updatedAt: now,
    });
    expect(index.listEntities().map((e) => e.id)).toEqual(["CHAR_0001", "LOC_0001"]);
    expect(index.listEntities("location").map((e) => e.id)).toEqual(["LOC_0001"]);
    index.removeEntity("LOC_0001");
    expect(index.listEntities("location")).toEqual([]);
    index.close();
  });

  it("stores and reads metadata and JSON data", () => {
    const index = new ProjectIndex(new NodeSqlDatabase());
    index.init();
    index.setMetadata("title", "My Novel");
    index.setMetadata("title", "My Better Novel");
    expect(index.getMetadata("title")).toBe("My Better Novel");
    expect(index.getMetadata("missing")).toBeUndefined();

    const now = new Date().toISOString();
    index.upsertEntity({
      id: "THREAD_0001",
      kind: "plot_thread",
      name: "Missing photograph",
      data: { status: "introduced" },
      createdAt: now,
      updatedAt: now,
    });
    expect(index.getEntity("THREAD_0001")?.data).toEqual({ status: "introduced" });
    index.close();
  });

  it("persists to an on-disk database file across reopen", () => {
    const dbPath = join(dir, "derived.sqlite");
    const first = new ProjectIndex(new NodeSqlDatabase(dbPath));
    first.init();
    const now = new Date().toISOString();
    first.upsertEntity({
      id: "CHAPTER_0001",
      kind: "chapter",
      name: "One",
      createdAt: now,
      updatedAt: now,
    });
    first.close();

    const reopened = new ProjectIndex(new NodeSqlDatabase(dbPath));
    expect(reopened.init()).toBe(0); // already migrated
    expect(reopened.getEntity("CHAPTER_0001")?.name).toBe("One");
    reopened.close();
  });
});
