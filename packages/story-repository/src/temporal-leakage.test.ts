import { describe, expect, it } from "vitest";
import { leakageFixture as mystery } from "./leakage-fixture";

/**
 * Temporal leakage: the repository's half.
 *
 * Story state, knowledge, relationships and the ordering they all rest on. The
 * Context Compiler and reader-facing halves live with the packages that own
 * them — `@jellytind/reader-sim` and `@jellytind/character-sim` — because a
 * guard belongs next to the code it guards, and they all read the same fixture.
 */

// ── Story state ─────────────────────────────────────────────────────────────

describe("story state at an earlier point", () => {
  it("does not carry a fact established later", async () => {
    const n = await mystery();
    const timeline = await n.repo.getStoryTimeline();

    const before = timeline.establishedFactsAt({ sceneId: n.s1.id as string, position: "before" });
    expect(before).not.toContain(n.culprit.id as string);

    // Positive control: the same query at the reveal does return it.
    const after = timeline.establishedFactsAt({ sceneId: n.s3.id as string, position: "after" });
    expect(after).toContain(n.culprit.id as string);
  });

  it("does not carry a character status recorded later", async () => {
    const n = await mystery();
    const early = await n.repo.getCharacterState(n.elias.id as string, {
      sceneId: n.s1.id as string,
      position: "before",
    });
    expect(early.status).not.toBe("deceased");

    const late = await n.repo.getCharacterState(n.elias.id as string, {
      sceneId: n.s3.id as string,
      position: "after",
    });
    expect(late.status).toBe("deceased");
  });

  it("does not move an object before the scene that moves it", async () => {
    const n = await mystery();
    const early = await n.repo.getObjectState(n.knife.id as string, {
      sceneId: n.s2.id as string,
      position: "before",
    });
    expect(early.locationId).toBe(n.manor.id as string);

    const late = await n.repo.getObjectState(n.knife.id as string, {
      sceneId: n.s3.id as string,
      position: "after",
    });
    expect(late.locationId).toBe(n.cellar.id as string);
  });
});

// ── Knowledge ───────────────────────────────────────────────────────────────

describe("knowledge at an earlier point", () => {
  it("does not give a character a fact they learn later", async () => {
    const n = await mystery();
    const timeline = await n.repo.getStoryTimeline();

    expect(
      timeline.knows(n.mara.id as string, n.culprit.id as string, {
        sceneId: n.s1.id as string,
        position: "after",
      }),
    ).toBeNull();

    expect(
      timeline.knows(n.mara.id as string, n.culprit.id as string, {
        sceneId: n.s3.id as string,
        position: "after",
      })?.state,
    ).toBe("known");
  });

  it("keeps a character's reconstructed knowledge list free of later facts", async () => {
    const n = await mystery();
    const state = await n.repo.getCharacterState(n.mara.id as string, {
      sceneId: n.s2.id as string,
      position: "before",
    });
    const held = state.knowledge.map((entry) => entry.factId);
    expect(held).toContain(n.early.id as string);
    expect(held).not.toContain(n.culprit.id as string);
  });
});

// ── Relationships ───────────────────────────────────────────────────────────

describe("relationships at an earlier point", () => {
  it("does not apply a change recorded in a later chapter", async () => {
    const n = await mystery();

    const early = await n.repo.getRelationshipAt(n.relationship.id as string, {
      sceneId: n.s1.id as string,
      position: "after",
    });
    expect(early?.type).toBe("ally");

    const late = await n.repo.getRelationshipAt(n.relationship.id as string, {
      sceneId: n.s3.id as string,
      position: "after",
    });
    expect(late?.type).toBe("enemy");
  });
});

// ── Timeline ────────────────────────────────────────────────────────────────

describe("the timeline", () => {
  it("orders the reveal after the setup, so 'before' means before", async () => {
    const n = await mystery();
    const timeline = await n.repo.getStoryTimeline();
    expect(timeline.positionOf(n.s1.id as string)).toBeLessThan(
      timeline.positionOf(n.s3.id as string),
    );
  });
});
