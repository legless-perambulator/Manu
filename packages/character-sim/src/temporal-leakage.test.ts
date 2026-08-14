import { describe, expect, it } from "vitest";
import { leakageFixture } from "@jellytind/story-repository";
import { snapshotAt } from "./snapshot";

/**
 * Temporal leakage: the character's half.
 *
 * A character simulated at scene 10 must not receive what she learns at scene
 * 20 — not the facts, not the later relationship, not the later development.
 * The snapshot is the whole of what a simulation is given, so checking the
 * snapshot is checking the simulation (docs/SIMULATIONS.md).
 */

describe("a character snapshot at an earlier scene", () => {
  it("gives her nothing she learns after it", async () => {
    const n = await leakageFixture();
    const snapshot = await snapshotAt(n.repo, n.mara.id as string, n.s1.id as string);

    expect(snapshot.knowledge.map((entry) => entry.factId)).not.toContain(n.culprit.id as string);
    // Not anywhere in the record, not only in the knowledge list: the statement
    // must not reach the simulation by any field.
    expect(JSON.stringify(snapshot)).not.toContain("Elias killed the steward");
  });

  it("counts what a character does not know without naming it", async () => {
    // The honest way to say "there is more he does not hold" — a count is
    // checkable, and the content stays out. Elias is never recorded learning
    // the fact chapter one establishes.
    const n = await leakageFixture();
    const snapshot = await snapshotAt(n.repo, n.elias.id as string, n.s2.id as string);

    expect(snapshot.notKnownCount).toBeGreaterThan(0);
    expect(snapshot.knowledge.map((entry) => entry.factId)).not.toContain(n.early.id as string);
    expect(JSON.stringify(snapshot)).not.toContain("The steward is missing");
  });

  it("does not apply a relationship change recorded later", async () => {
    const n = await leakageFixture();
    const snapshot = await snapshotAt(n.repo, n.mara.id as string, n.s1.id as string);
    const link = snapshot.relationships.find((r) => r.withId === (n.elias.id as string));
    expect(link?.type).toBe("ally");
  });

  it("remembers only scenes before this one", async () => {
    const n = await leakageFixture();
    const snapshot = await snapshotAt(n.repo, n.mara.id as string, n.s2.id as string);
    const remembered = snapshot.memories.map((m) => m.sceneId);

    expect(remembered).toContain(n.s1.id as string);
    expect(remembered).not.toContain(n.s3.id as string);
  });

  it("is taken at the boundary before the scene, so the reveal scene does not pre-empt itself", async () => {
    // Entering the reveal she still does not hold it. She learns it there.
    const n = await leakageFixture();
    const entering = await snapshotAt(n.repo, n.mara.id as string, n.s3.id as string);
    expect(entering.knowledge.map((e) => e.factId)).not.toContain(n.culprit.id as string);

    // Positive control: the timeline does record her learning it in that scene.
    const timeline = await n.repo.getStoryTimeline();
    expect(
      timeline.knows(n.mara.id as string, n.culprit.id as string, {
        sceneId: n.s3.id as string,
        position: "after",
      }),
    ).not.toBeNull();
  });
});
