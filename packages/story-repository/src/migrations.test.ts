import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type ProjectManifest } from "@jellytind/domain";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { migrateProject, MIGRATIONS, type Migration } from "./migrations";

/**
 * Migration fixtures (Phase 46 §5–§6).
 *
 * Fixtures representing project manifests from other eras run through the
 * migration gate in CI. Three invariants hold and must keep holding:
 *
 * 1. A **newer** schema is refused with an "update Manu" message — never
 *    reinterpreted under old assumptions.
 * 2. An **older** schema with no registered path is refused untouched —
 *    never opened by guesswork.
 * 3. When steps exist, they apply **in order**, each exactly once, and an
 *    interrupted run can be re-run safely (steps are idempotent by
 *    contract).
 *
 * The multi-step path is exercised with an injected registry, because
 * schema 1 is the only version Manu has ever written and inventing a fake
 * 0→1 production migration would pretend to support projects that never
 * existed.
 */

function fixture(schemaVersion: number): ProjectManifest {
  return {
    schemaVersion,
    id: "PROJ_0001" as ProjectManifest["id"],
    title: "Fixture project",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-06-01T00:00:00.000Z",
    appFormatVersion: "0.0.1",
  };
}

describe("the migration gate", () => {
  it("passes a current-schema project through untouched", async () => {
    const outcome = await migrateProject(new InMemoryProjectStore(), fixture(SCHEMA_VERSION));
    expect(outcome).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION, applied: [] });
  });

  it("refuses a future schema and says to update Manu", async () => {
    await expect(
      migrateProject(new InMemoryProjectStore(), fixture(SCHEMA_VERSION + 41)),
    ).rejects.toThrow(/newer version of Manu/);
  });

  it("refuses an unknown old schema without changing anything", async () => {
    const store = new InMemoryProjectStore();
    await store.writeFile("manuscript/CH_0001.md", "The prose.");
    await expect(migrateProject(store, fixture(0))).rejects.toThrow(/has not changed it/);
    expect(await store.readFile("manuscript/CH_0001.md")).toBe("The prose.");
  });

  it("the production registry has no gaps up to the current schema", () => {
    // Every registered step must chain: from N produces N+1, and versions
    // covered by the registry must be contiguous. With an empty registry
    // this holds trivially; when the first real migration lands, this test
    // starts guarding its shape.
    const froms = MIGRATIONS.map((held) => held.from).sort((a, b) => a - b);
    for (let index = 1; index < froms.length; index += 1) {
      expect(froms[index]).toBe((froms[index - 1] ?? 0) + 1);
    }
    if (froms.length > 0) {
      expect((froms[froms.length - 1] ?? 0) + 1).toBeLessThanOrEqual(SCHEMA_VERSION);
    }
  });

  it("applies a multi-step upgrade in order, and re-runs safely after interruption", async () => {
    const store = new InMemoryProjectStore();
    await store.writeFile(".writer/legacy-notes.txt", "old format");
    const ran: string[] = [];
    const synthetic: Migration[] = [
      {
        from: SCHEMA_VERSION - 2,
        description: "Fold legacy notes into the notes directory",
        run: async (held) => {
          ran.push("step-1");
          const legacy = await held.readFile(".writer/legacy-notes.txt");
          if (legacy !== null) {
            // Idempotent: a re-run finds the work already done.
            await held.writeFile(".writer/notes/migrated.md", legacy);
          }
        },
      },
      {
        from: SCHEMA_VERSION - 1,
        description: "Record the notes index",
        run: async (held) => {
          ran.push("step-2");
          await held.writeFile(".writer/notes/index.json", "[]");
        },
      },
    ];

    const outcome = await migrateProject(store, fixture(SCHEMA_VERSION - 2), synthetic);
    expect(outcome.from).toBe(SCHEMA_VERSION - 2);
    expect(outcome.to).toBe(SCHEMA_VERSION);
    expect(outcome.applied).toEqual([
      "Fold legacy notes into the notes directory",
      "Record the notes index",
    ]);
    expect(ran).toEqual(["step-1", "step-2"]);
    expect(await store.readFile(".writer/notes/migrated.md")).toBe("old format");

    // Interrupted half-way: the same steps re-run without harm.
    const again = await migrateProject(store, fixture(SCHEMA_VERSION - 1), synthetic);
    expect(again.applied).toEqual(["Record the notes index"]);
    expect(await store.readFile(".writer/notes/migrated.md")).toBe("old format");
  });
});
