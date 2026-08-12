import { describe, expect, it } from "vitest";
import { coerceRequest } from "./trace";
import { parseDebugCommand, type EntitySummary } from "./command";
import { renderDebugReport } from "./present";
import { EvidenceCollector, tracedEntities } from "./evidence";
import { countWords, excerpt } from "./project";
import { DebugError, type DebugReport } from "./types";

/**
 * The pure parts, tested without a project.
 *
 * A debug request arrives from an agent, a command line or a form — none of
 * them trustworthy — so the validation that stands between those and the
 * tracers is worth testing on its own.
 */

const ENTITIES: readonly EntitySummary[] = [
  { id: "CHAR_0001", name: "Marcus" },
  { id: "CHAR_0002", name: "Mara" },
  { id: "CHAR_0003", name: "Marcus Vale the younger" },
  { id: "THREAD_0001", name: "The betrayal" },
  { id: "SCENE_0004", name: "The turn" },
  { id: "CHAPTER_0002", name: "The House" },
];

describe("validating a request", () => {
  it("keeps only fields of the right kind", () => {
    const request = coerceRequest({
      mode: "reveal",
      problem: "It doesn't land.",
      characterId: "CHAR_0001",
      // Wrong prefixes: dropped rather than passed to a tracer that would fail.
      threadId: "CHAR_0002",
      factId: 12,
      lookBack: -4,
    });

    expect(request).toEqual({
      mode: "reveal",
      problem: "It doesn't land.",
      characterId: "CHAR_0001",
    });
  });

  it("accepts sceneId as the reveal scene", () => {
    expect(coerceRequest({ mode: "reveal", sceneId: "SCENE_0004" })).toMatchObject({
      revealSceneId: "SCENE_0004",
    });
  });

  it("refuses a mode it does not have, and names the ones it does", () => {
    expect(() => coerceRequest({ mode: "vibes" })).toThrow(/character_motivation/);
    expect(() => coerceRequest({ mode: "" })).toThrow(DebugError);
  });

  it("refuses each mode that is missing what it cannot work without", () => {
    expect(() => coerceRequest({ mode: "reveal" })).toThrow(/reveal scene, or the character/);
    expect(() => coerceRequest({ mode: "character_motivation", characterId: "CHAR_0001" })).toThrow(
      /scene/,
    );
    expect(() => coerceRequest({ mode: "continuity" })).toThrow(/DIAG_/);
  });

  it("lets pacing default to the whole book", () => {
    expect(coerceRequest({ mode: "pacing", problem: "It drags." })).toEqual({
      mode: "pacing",
      problem: "It drags.",
    });
  });
});

describe("the /debug command", () => {
  it("maps a writer's word to the mode that investigates it", () => {
    for (const word of ["betrayal", "twist", "reversal", "secret", "reveal"]) {
      expect(parseDebugCommand(`/debug ${word} Marcus`, ENTITIES).request.mode).toBe("reveal");
    }
    expect(parseDebugCommand("/debug pacing", ENTITIES).request.mode).toBe("pacing");
    expect(parseDebugCommand("/debug decision Mara SCENE_0004", ENTITIES).request.mode).toBe(
      "character_motivation",
    );
  });

  /** A prefix matching two characters names neither of them. */
  it("refuses to guess between two matching names", () => {
    const one = parseDebugCommand("/debug betrayal Mara", ENTITIES);
    expect(one.unresolved).toEqual([]);
    expect((one.request as { characterId?: string }).characterId).toBe("CHAR_0002");

    // "Marc" prefixes both Marcus and Marcus Vale the younger.
    expect(() => parseDebugCommand("/debug betrayal Marc", ENTITIES)).toThrow(/Name whose reveal/);
  });

  it("carries a build diagnostic through as itself", () => {
    const parsed = parseDebugCommand("/debug continuity DIAG_1A2B3C4D", ENTITIES);
    expect((parsed.request as { diagnosticId: string }).diagnosticId).toBe("DIAG_1a2b3c4d");
    expect(parsed.unresolved).toEqual([]);
  });

  it("keeps the writer's words as the problem", () => {
    const parsed = parseDebugCommand("/debug betrayal Marcus", ENTITIES);
    expect(parsed.request.problem).toBe("betrayal Marcus");
  });

  it("asks for a topic when given none", () => {
    expect(() => parseDebugCommand("/debug", ENTITIES)).toThrow(/Say what to investigate/);
  });
});

describe("collecting evidence", () => {
  it("numbers items in retrieval order and gathers scope from them", () => {
    const found = new EvidenceCollector();
    const first = found.add({
      system: "structure",
      statement: "A scene.",
      sceneId: "SCENE_0001",
      entities: ["CHAR_0001", "CHAR_0001"],
    });
    const second = found.add({
      system: "knowledge",
      statement: "A fact.",
      entities: ["FACT_0001"],
    });
    found.didNotInspect("The prose.");
    found.didNotInspect("The prose.");

    expect([first, second]).toEqual(["E1", "E2"]);
    // Duplicated entities are deduplicated; so are repeated gaps.
    expect(found.evidence[0]?.entities).toEqual(["CHAR_0001"]);

    const scope = found.scope("Two things.");
    expect(scope.systems).toEqual(["structure", "knowledge"]);
    expect(scope.sceneIds).toEqual(["SCENE_0001"]);
    expect(scope.notInspected).toEqual(["The prose."]);
    expect(tracedEntities(found.evidence, scope)).toEqual(["CHAR_0001", "FACT_0001"]);
  });
});

describe("reading prose", () => {
  it("counts words without front-matter or scene markers", () => {
    expect(
      countWords("---\nid: CHAPTER_0001\n---\n<!-- scene: SCENE_0001 -->\none two three\n"),
    ).toBe(3);
    expect(countWords("")).toBe(0);
  });

  /** A model told it has a whole scene when it has a third of one is dangerous. */
  it("says how much of an excerpt is missing", () => {
    const text = Array.from({ length: 50 }, (_, i) => `w${String(i)}`).join(" ");
    expect(excerpt(text, 10)).toContain("[… 40 further words not shown]");
    expect(excerpt(text, 100)).toBe(text);
  });
});

describe("rendering a report", () => {
  const base: DebugReport = {
    id: "DEBUG_0001",
    mode: "pacing",
    problem: "It drags.",
    createdAt: "2026-01-01T00:00:00.000Z",
    durationMs: 4,
    scope: {
      summary: "One chapter.",
      sceneIds: [],
      chapterIds: ["CHAPTER_0002"],
      entityIds: ["CHAPTER_0002"],
      systems: ["structure"],
      notInspected: ["Conflict."],
    },
    evidence: [{ id: "E1", system: "structure", statement: "It is long.", entities: [] }],
    measurements: [],
    excerpts: [],
    interventions: [],
    entities: ["CHAPTER_0002"],
  };

  /** All seven headings, always, in order. A vanishing section hides a fact. */
  it("prints every heading whether or not it has content", () => {
    const text = renderDebugReport(base);
    const order = [
      "PROBLEM",
      "SCOPE INSPECTED",
      "EVIDENCE (deterministic",
      "DIAGNOSIS",
      "CONFIDENCE AND UNCERTAINTY",
      "POSSIBLE INTERVENTIONS",
      "AFFECTED ENTITIES",
    ];
    let at = -1;
    for (const heading of order) {
      const next = text.indexOf(heading);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
    expect(text).toContain("Not diagnosed.");
    expect(text).toContain("None proposed.");
  });

  it("labels a diagnosis as judgement and shows citations to nothing", () => {
    const text = renderDebugReport({
      ...base,
      diagnosis: {
        statement: "Too much happens.",
        reasoning: "As cited.",
        confidence: "low",
        uncertainty: ["What the chapter is doing."],
        basis: ["E1"],
        unsupported: ["E9"],
      },
    });

    expect(text).toContain("MODEL JUDGEMENT: Too much happens.");
    expect(text).toContain("Cited evidence that does not exist: E9");
    expect(text).toContain("Confidence: low");
  });
});
