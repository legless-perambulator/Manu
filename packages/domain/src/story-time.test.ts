import { describe, expect, it } from "vitest";
import {
  boundsOf,
  describeDuration,
  describeStoryTime,
  durationMs,
  isAnchored,
  normaliseDuration,
  normaliseStoryTime,
} from "./story-time";

describe("story time bounds", () => {
  it("pins an exact instant to a single moment", () => {
    const bounds = boundsOf({ kind: "exact", instant: "1997-08-14T14:00:00Z" });
    expect(bounds.earliest).toBe(bounds.latest);
  });

  it("treats a bare date as the whole day, not an instant", () => {
    const bounds = boundsOf({ kind: "date", date: "1997-08-14" });
    expect(bounds.latest as number).toBeGreaterThan(bounds.earliest as number);
    expect((bounds.latest as number) - (bounds.earliest as number)).toBe(24 * 60 * 60_000 - 1);
  });

  it("leaves ordinal and unknown times unpinned", () => {
    expect(isAnchored({ kind: "ordinal", label: "Day 3, evening" })).toBe(false);
    expect(isAnchored({ kind: "unknown" })).toBe(false);
    expect(isAnchored(undefined)).toBe(false);
  });

  it("bounds an approximate time only where a bound was given", () => {
    const bounds = boundsOf({ kind: "approximate", earliest: "1997-01-01", label: "that year" });
    expect(bounds.earliest).toBeDefined();
    expect(bounds.latest).toBeUndefined();
  });
});

describe("durations", () => {
  it("adds components", () => {
    expect(durationMs({ hours: 1, minutes: 30 })).toBe(90 * 60_000);
  });

  it("returns nothing for a duration that carries only words", () => {
    expect(durationMs({ label: "most of the night" })).toBeUndefined();
    expect(describeDuration({ label: "most of the night" })).toBe("most of the night");
  });

  it("renders quantities alongside the writer's own words", () => {
    expect(describeDuration({ days: 3, label: "the long walk" })).toBe("3d (the long walk)");
  });
});

describe("reading stored story time", () => {
  /**
   * Events used to carry story time as free text. It is interpreted rather than
   * dropped, so no existing project loses its timeline on upgrade.
   */
  it("interprets a legacy free-form string as an ordinal marker", () => {
    expect(normaliseStoryTime("Day 3, evening")).toEqual({
      kind: "ordinal",
      label: "Day 3, evening",
    });
  });

  it("recognises a legacy string that plainly is a date", () => {
    expect(normaliseStoryTime("1997-08-14")).toEqual({ kind: "date", date: "1997-08-14" });
    expect(normaliseStoryTime("1997-08-14T14:00:00Z")).toEqual({
      kind: "exact",
      instant: "1997-08-14T14:00:00Z",
    });
  });

  it("rejects a structured time whose own fields are unusable", () => {
    expect(normaliseStoryTime({ kind: "exact", instant: "not a date" })).toBeUndefined();
    expect(normaliseStoryTime({ kind: "elsewhen" })).toBeUndefined();
    expect(normaliseStoryTime(undefined)).toBeUndefined();
  });

  it("keeps a relative time and its offset", () => {
    expect(
      normaliseStoryTime({
        kind: "relative",
        anchorId: "EVENT_0001",
        relation: "after",
        offset: { days: 3, bogus: "x" },
      }),
    ).toEqual({
      kind: "relative",
      anchorId: "EVENT_0001",
      relation: "after",
      offset: { days: 3 },
    });
  });

  it("drops non-numeric duration components", () => {
    expect(normaliseDuration({ hours: 2, minutes: "many" })).toEqual({ hours: 2 });
    expect(normaliseDuration({})).toBeUndefined();
  });
});

describe("describing story time", () => {
  it("prefers the writer's label to the machine-readable value", () => {
    expect(
      describeStoryTime({ kind: "exact", instant: "1997-08-14T14:00:00Z", label: "the fire" }),
    ).toBe("the fire");
  });

  it("describes a relative time in terms of its anchor", () => {
    expect(
      describeStoryTime({
        kind: "relative",
        anchorId: "EVENT_0001",
        relation: "after",
        offset: { days: 3 },
      }),
    ).toBe("3d after EVENT_0001");
  });

  it("says plainly when nothing is recorded", () => {
    expect(describeStoryTime(undefined)).toBe("no story time recorded");
  });
});
