import { describe, expect, it } from "vitest";
import { ContextCompiler, allItems, renderContextPackage } from "@jellytind/context-compiler";
import { leakageFixture, REVEAL_TOKEN } from "@jellytind/story-repository";
import { EMPTY_READER_STATE } from "@jellytind/domain";
import { BUILT_IN_PROFILES } from "./profiles";
import { buildPacket } from "./simulator";

/**
 * Temporal leakage: the reader's half.
 *
 * A reader at chapter one must not have chapter three. This covers both the
 * compiled context a reading is made from and the packet the simulator builds,
 * because a leak could enter at either — the recipe could select too much, or
 * the packet could carry structured state a reader has no business holding
 * (docs/SIMULATIONS.md).
 *
 * No model is involved: `buildPacket` is the deterministic half, and it is the
 * half where a leak would happen.
 */

const profile = () => BUILT_IN_PROFILES[0] as NonNullable<(typeof BUILT_IN_PROFILES)[number]>;

describe("compiled context for an early scene", () => {
  it("contains no material from the reveal", async () => {
    const n = await leakageFixture();
    const text = renderContextPackage(
      await new ContextCompiler(n.repo).compile({
        recipe: "scene_inspection",
        targetId: n.s1.id as string,
      }),
    );

    expect(text).not.toContain(REVEAL_TOKEN);
    expect(text).not.toContain("Elias killed the steward");
    expect(text).not.toContain(n.culprit.id as string);
  });

  it("reconstructs every state element at the target's own boundary, never later", async () => {
    // The machine-checkable form of the same claim: no element may carry a
    // story point past the target (docs/CONTEXT_COMPILER.md — provenance).
    const n = await leakageFixture();
    const timeline = await n.repo.getStoryTimeline();
    const target = timeline.positionOf(n.s1.id as string);

    const pkg = await new ContextCompiler(n.repo).compile({
      recipe: "scene_inspection",
      targetId: n.s1.id as string,
    });

    const points = allItems(pkg)
      .map((item) => item.provenance.storyPoint)
      .filter((point): point is string => point !== undefined);

    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      expect(timeline.positionOf(point.split(":")[1] as string)).toBeLessThanOrEqual(target);
    }
  });

  it("still includes the reveal when the target is the reveal", async () => {
    // Positive control: without this the section could pass by selecting
    // nothing at all.
    const n = await leakageFixture();
    const pkg = await new ContextCompiler(n.repo).compile({
      recipe: "scene_inspection",
      targetId: n.s3.id as string,
    });
    expect(renderContextPackage(pkg)).toContain(n.culprit.id as string);
  });
});

describe("the reader simulator", () => {
  it("reads chapter one with no sight of chapter three", async () => {
    const n = await leakageFixture();
    const packet = await buildPacket(n.repo, profile(), EMPTY_READER_STATE, n.ch1.id as string);

    expect(packet.pages).not.toContain(REVEAL_TOKEN);
    expect(packet.pages).not.toContain("face went white");
    // Nor the structured half: a reader has read pages, not records.
    expect(packet.pages).not.toContain(n.culprit.id as string);
    expect(packet.pages).toContain("did not come down to dinner");
  });

  it("records exposure at the chapter read, with nothing from later on the page", async () => {
    const n = await leakageFixture();
    const packet = await buildPacket(n.repo, profile(), EMPTY_READER_STATE, n.ch1.id as string);

    expect(packet.exposure.chapterId).toBe(n.ch1.id);
    expect(packet.exposure.position).toBe(1);
    // What the manuscript has put in front of this reader so far.
    expect(packet.exposure.factsOnPage).not.toContain(n.culprit.id as string);
    expect(packet.exposure.sceneIds).toContain(n.s1.id as string);
    expect(packet.exposure.sceneIds).not.toContain(n.s3.id as string);
  });

  it("does show the reveal once the reader reaches it", async () => {
    const n = await leakageFixture();
    const packet = await buildPacket(n.repo, profile(), EMPTY_READER_STATE, n.ch3.id as string);
    expect(packet.pages).toContain(REVEAL_TOKEN);
  });
});
