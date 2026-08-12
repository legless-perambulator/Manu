import { describe, expect, it } from "vitest";
import type { PlotThread, Scene, Setup } from "@jellytind/domain";
import { checkNarrative, openSetupsBefore, setupsForScene } from "./narrative-checks";
import { describeDormancy, isOpen, isRunning } from "./threads";
import { StoryTimeline, type ManuscriptMetrics } from "./timeline";
import type { StateTransition, TransitionKind } from "./types";

const PHOTO = "THREAD_0001";
const VAULT = "THREAD_0002";
const SETUP = "SETUP_0001";

// A twelve-scene book across three chapters, so dormancy has room to happen.
const SCENES = Array.from({ length: 12 }, (_, i) => `SCENE_${String(i + 1).padStart(4, "0")}`);
const CHAPTER_OF = new Map(
  SCENES.map((id, i) => [id, `CHAPTER_000${String(Math.floor(i / 4) + 1)}`]),
);
const WORDS = new Map(SCENES.map((id) => [id, 1000]));
const METRICS: ManuscriptMetrics = { chapterBySceneId: CHAPTER_OF, wordsBySceneId: WORDS };

let seq = 0;
const t = (
  sceneId: string,
  kind: TransitionKind,
  subjectId: string,
  value: string,
  extra: Partial<StateTransition> = {},
): StateTransition => ({
  id: `TRANS_${String(++seq).padStart(4, "0")}`,
  sceneId,
  kind,
  subjectId,
  value,
  source: "author",
  confirmationStatus: "confirmed",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

function timeline(transitions: readonly StateTransition[]): StoryTimeline {
  seq = 0;
  return new StoryTimeline(SCENES, transitions);
}

function thread(id: string, name: string, fields: Record<string, unknown> = {}): PlotThread {
  return {
    id,
    name,
    description: "",
    status: "planned",
    relatedSceneIds: [],
    ...fields,
  } as unknown as PlotThread;
}

function scene(id: string): Scene {
  return {
    id,
    title: id,
    chapterId: CHAPTER_OF.get(id),
    characterIds: [],
    plotThreadIds: [],
    objectIds: [],
    factIds: [],
    purpose: [],
    status: "drafted",
  } as unknown as Scene;
}

function setup(fields: Record<string, unknown> = {}): Setup {
  return {
    id: SETUP,
    description: "Brass key visible in father's drawer.",
    setupSceneIds: [],
    payoffSceneIds: [],
    subtlety: "subtle",
    ...fields,
  } as unknown as Setup;
}

const at = (sceneId: string) => ({ sceneId, position: "after" }) as const;

/**
 * The worked example from the specification: a thread introduced early,
 * advanced twice, quiet for a stretch, then resolved.
 */
function missingPhotograph(): StoryTimeline {
  return timeline([
    t("SCENE_0001", "thread_appearance", PHOTO, "introduces"),
    t("SCENE_0003", "thread_appearance", PHOTO, "advances"),
    t("SCENE_0004", "thread_appearance", PHOTO, "advances"),
    t("SCENE_0005", "thread_status", PHOTO, "dormant"),
    t("SCENE_0011", "thread_appearance", PHOTO, "resolves"),
  ]);
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

describe("thread lifecycle", () => {
  it("reconstructs a thread's status at any point in the book", () => {
    const tl = missingPhotograph();
    const identity = { id: PHOTO, name: "The missing photograph", status: "planned" as const };

    expect(tl.threadStateAt(identity, at("SCENE_0001")).status).toBe("introduced");
    expect(tl.threadStateAt(identity, at("SCENE_0003")).status).toBe("active");
    expect(tl.threadStateAt(identity, at("SCENE_0007")).status).toBe("dormant");
    expect(tl.threadStateAt(identity, at("SCENE_0011")).status).toBe("resolved");
    // Before anything happens, it is only planned.
    expect(tl.threadStateAt(identity, { sceneId: "SCENE_0001", position: "before" }).status).toBe(
      "planned",
    );
  });

  it("infers a status from the interaction where one is obvious", () => {
    const tl = timeline([t("SCENE_0002", "thread_appearance", VAULT, "escalates")]);
    expect(tl.threadStateAt({ id: VAULT }, at("SCENE_0002")).status).toBe("escalating");
  });

  /** A passing mention is not progress, and treating it as progress hides dormancy. */
  it("does not treat a passing reference as a status change", () => {
    const tl = timeline([
      t("SCENE_0001", "thread_status", VAULT, "dormant"),
      t("SCENE_0003", "thread_appearance", VAULT, "references"),
    ]);
    expect(tl.threadStateAt({ id: VAULT }, at("SCENE_0003")).status).toBe("dormant");
  });

  it("lets an explicit status override the interaction's implication", () => {
    const tl = timeline([
      t("SCENE_0002", "thread_appearance", VAULT, "advances"),
      t("SCENE_0002", "thread_status", VAULT, "escalating"),
    ]);
    expect(tl.threadStateAt({ id: VAULT }, at("SCENE_0002")).status).toBe("escalating");
  });

  it("records where a thread was introduced and resolved", () => {
    const state = missingPhotograph().threadStateAt({ id: PHOTO }, at("SCENE_0012"));
    expect(state.introducedSceneId).toBe("SCENE_0001");
    expect(state.resolvedSceneId).toBe("SCENE_0011");
    expect(state.appearanceSceneIds).toEqual([
      "SCENE_0001",
      "SCENE_0003",
      "SCENE_0004",
      "SCENE_0011",
    ]);
  });

  it("reads a thread's history as a trail with what each step changed from", () => {
    const history = missingPhotograph().threadHistory(PHOTO);
    expect(history.map((s) => [s.sceneId, s.interaction, s.status, s.statusSource])).toEqual([
      ["SCENE_0001", "introduces", "introduced", "implied"],
      ["SCENE_0003", "advances", "active", "implied"],
      ["SCENE_0004", "advances", "active", "unchanged"],
      ["SCENE_0005", undefined, "dormant", "explicit"],
      ["SCENE_0011", "resolves", "resolved", "implied"],
    ]);
    expect(history[1]?.previousStatus).toBe("introduced");
  });

  it("lists threads with any recorded activity", () => {
    const tl = timeline([
      t("SCENE_0001", "thread_appearance", PHOTO, "introduces"),
      t("SCENE_0002", "thread_status", VAULT, "active"),
    ]);
    expect(tl.knownThreadIds()).toEqual([PHOTO, VAULT]);
  });

  it("separates open threads from finished ones", () => {
    expect(isOpen("dormant")).toBe(true);
    expect(isOpen("resolved")).toBe(false);
    expect(isOpen("abandoned")).toBe(false);
    // Dormant is open but not running: the story still owes it, quietly.
    expect(isRunning("dormant")).toBe(false);
    expect(isRunning("escalating")).toBe(true);
  });
});

// ── Dormancy ─────────────────────────────────────────────────────────────────

describe("dormancy", () => {
  it("measures the gap in scenes, chapters and words", () => {
    const dormancy = missingPhotograph().threadDormancy(PHOTO, at("SCENE_0010"), METRICS);

    expect(dormancy.lastAppearanceSceneId).toBe("SCENE_0004");
    expect(dormancy.lastInteraction).toBe("advances");
    expect(dormancy.scenesSinceAppearance).toBe(6);
    // SCENE_0004 is in chapter 1; SCENE_0010 is in chapter 3.
    expect(dormancy.chaptersSinceAppearance).toBe(2);
    expect(dormancy.wordsSinceAppearance).toBe(6000);
    expect(dormancy.neverAppeared).toBe(false);
  });

  it("reports a thread that has never appeared as exactly that", () => {
    const dormancy = missingPhotograph().threadDormancy(VAULT, at("SCENE_0010"), METRICS);
    expect(dormancy.neverAppeared).toBe(true);
    expect(dormancy.scenesSinceAppearance).toBeUndefined();
    expect(describeDormancy(dormancy)).toBe("has not appeared yet");
  });

  it("omits measures it cannot compute rather than guessing", () => {
    const dormancy = missingPhotograph().threadDormancy(PHOTO, at("SCENE_0010"));
    expect(dormancy.scenesSinceAppearance).toBe(6);
    expect(dormancy.chaptersSinceAppearance).toBeUndefined();
    expect(dormancy.wordsSinceAppearance).toBeUndefined();
  });

  it("reads zero at the scene the thread appears in", () => {
    const dormancy = missingPhotograph().threadDormancy(PHOTO, at("SCENE_0004"), METRICS);
    expect(dormancy.scenesSinceAppearance).toBe(0);
    expect(dormancy.chaptersSinceAppearance).toBe(0);
    expect(dormancy.wordsSinceAppearance).toBe(0);
  });

  it("answers about the past, not about the end of the book", () => {
    // At SCENE_0006 the thread has not yet been resolved in SCENE_0011.
    const dormancy = missingPhotograph().threadDormancy(PHOTO, at("SCENE_0006"), METRICS);
    expect(dormancy.lastAppearanceSceneId).toBe("SCENE_0004");
  });

  it("describes a gap without judging it", () => {
    const dormancy = missingPhotograph().threadDormancy(PHOTO, at("SCENE_0010"), METRICS);
    const said = describeDormancy(dormancy);
    expect(said).toBe("6 scene(s), 2 chapter(s), 6,000 words since SCENE_0004");
    for (const verdict of ["too long", "should", "problem", "stale"]) {
      expect(said).not.toContain(verdict);
    }
  });
});

// ── Setups and payoffs ───────────────────────────────────────────────────────

describe("setups and payoffs", () => {
  const scenes = SCENES.map(scene);
  const threads = [thread(PHOTO, "The missing photograph")];

  const check = (setups: readonly Setup[], extra: Record<string, unknown> = {}) =>
    checkNarrative({
      timeline: missingPhotograph(),
      scenes,
      threads,
      setups,
      ...extra,
    });

  it("finds a promise with nothing on the other end", () => {
    const found = check([setup({ setupSceneIds: ["SCENE_0002"] })]);
    const finding = found.find((f) => f.kind === "setup_without_payoff");
    expect(finding?.severity).toBe("warning");
    expect(finding?.setupId).toBe(SETUP);
    expect(finding?.message).toContain("Brass key");
  });

  it("says nothing about a promise the writer deliberately dropped", () => {
    const found = check([setup({ setupSceneIds: ["SCENE_0002"], abandoned: true })]);
    expect(found.map((f) => f.kind)).not.toContain("setup_without_payoff");
  });

  it("finds a payoff the reader reaches before its planting", () => {
    const found = check([setup({ setupSceneIds: ["SCENE_0008"], payoffSceneIds: ["SCENE_0003"] })]);
    const finding = found.find((f) => f.kind === "payoff_before_setup");
    expect(finding?.severity).toBe("error");
    expect(finding?.sceneIds).toEqual(["SCENE_0003", "SCENE_0008"]);
  });

  it("accepts a payoff after its planting", () => {
    const found = check([setup({ setupSceneIds: ["SCENE_0002"], payoffSceneIds: ["SCENE_0009"] })]);
    expect(found.map((f) => f.kind)).not.toContain("payoff_before_setup");
  });

  it("supports several plantings paid off at once", () => {
    const found = check([
      setup({
        setupSceneIds: ["SCENE_0002", "SCENE_0005", "SCENE_0007"],
        payoffSceneIds: ["SCENE_0009"],
      }),
    ]);
    expect(found).toEqual([]);
  });

  it("supports one planting paid off repeatedly", () => {
    const found = check([
      setup({ setupSceneIds: ["SCENE_0002"], payoffSceneIds: ["SCENE_0006", "SCENE_0009"] }),
    ]);
    expect(found).toEqual([]);
  });

  it("finds a reference to a scene the project does not have", () => {
    const found = check([setup({ setupSceneIds: ["SCENE_9999"], payoffSceneIds: ["SCENE_0009"] })]);
    const finding = found.find((f) => f.kind === "dangling_setup_reference");
    expect(finding?.severity).toBe("error");
    expect(finding?.sceneIds).toEqual(["SCENE_9999"]);
  });

  it("finds a promise whose thread finishes without it landing", () => {
    const found = check([
      setup({
        setupSceneIds: ["SCENE_0002"],
        payoffSceneIds: ["SCENE_0012"],
        targetThreadId: PHOTO,
      }),
    ]);
    // The thread resolves in SCENE_0011; the payoff arrives after.
    const finding = found.find((f) => f.kind === "unresolved_setup");
    expect(finding?.severity).toBe("warning");
    expect(finding?.threadId).toBe(PHOTO);
  });

  it("accepts a promise that lands before its thread finishes", () => {
    const found = check([
      setup({
        setupSceneIds: ["SCENE_0002"],
        payoffSceneIds: ["SCENE_0010"],
        targetThreadId: PHOTO,
      }),
    ]);
    expect(found.map((f) => f.kind)).not.toContain("unresolved_setup");
  });

  it("reads which setups a scene plants and which it keeps", () => {
    const setups = [
      setup({ setupSceneIds: ["SCENE_0002"], payoffSceneIds: ["SCENE_0009"] }),
      setup({ id: "SETUP_0002", setupSceneIds: ["SCENE_0009"], payoffSceneIds: [] }),
    ];
    const { planted, paidOff } = setupsForScene(setups, "SCENE_0009");
    expect(planted.map((s) => s.id)).toEqual(["SETUP_0002"]);
    expect(paidOff.map((s) => s.id)).toEqual([SETUP]);
  });

  /**
   * The guard against handing an earlier scene a piece of the ending: only
   * promises already made, and not yet kept, count as outstanding.
   */
  it("lists only promises outstanding entering a scene", () => {
    const tl = missingPhotograph();
    const setups = [
      setup({ setupSceneIds: ["SCENE_0002"], payoffSceneIds: ["SCENE_0009"] }),
      setup({ id: "SETUP_0002", setupSceneIds: ["SCENE_0010"], payoffSceneIds: [] }),
      setup({ id: "SETUP_0003", setupSceneIds: ["SCENE_0001"], payoffSceneIds: ["SCENE_0003"] }),
    ];

    // Entering SCENE_0006: the first is planted and unpaid; the second has not
    // been planted yet; the third was already kept.
    expect(openSetupsBefore(setups, tl, "SCENE_0006").map((s) => s.id)).toEqual([SETUP]);
    // Entering SCENE_0011 the first has been paid off too.
    expect(openSetupsBefore(setups, tl, "SCENE_0011").map((s) => s.id)).toEqual(["SETUP_0002"]);
  });
});

// ── Threads under check ──────────────────────────────────────────────────────

describe("thread findings", () => {
  const scenes = SCENES.map(scene);

  it("reports an abandoned thread and what still points at it", () => {
    const tl = timeline([
      t("SCENE_0002", "thread_appearance", VAULT, "introduces"),
      t("SCENE_0006", "thread_status", VAULT, "abandoned"),
    ]);
    const found = checkNarrative({
      timeline: tl,
      scenes,
      threads: [thread(VAULT, "The sealed vault")],
      setups: [setup({ setupSceneIds: ["SCENE_0003"], targetThreadId: VAULT })],
    });
    const finding = found.find((f) => f.kind === "abandoned_thread");
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("1 setup(s) still point at it");
  });

  /**
   * Dormancy is reported only against a threshold the caller names. There is no
   * default worth having: the right number for a thriller is wrong for a saga.
   */
  it("reports dormancy only when asked, and only as a measurement", () => {
    const threads = [thread(PHOTO, "The missing photograph")];
    const base = {
      timeline: timeline([
        t("SCENE_0001", "thread_appearance", PHOTO, "introduces"),
        t("SCENE_0002", "thread_appearance", PHOTO, "advances"),
      ]),
      scenes,
      threads,
      setups: [],
      metrics: METRICS,
    };

    expect(checkNarrative(base).map((f) => f.kind)).not.toContain("dormant_thread");

    const found = checkNarrative({ ...base, dormantAfterScenes: 5 });
    const finding = found.find((f) => f.kind === "dormant_thread");
    expect(finding?.dormancy?.scenesSinceAppearance).toBe(10);
    expect(finding?.message).toContain("has not appeared for 10 scene(s)");
    expect(finding?.message).not.toContain("too long");
  });

  it("does not call a resolved thread dormant", () => {
    const found = checkNarrative({
      timeline: missingPhotograph(),
      scenes,
      threads: [thread(PHOTO, "The missing photograph")],
      setups: [],
      dormantAfterScenes: 1,
    });
    expect(found.map((f) => f.kind)).not.toContain("dormant_thread");
  });

  it("finds nothing wrong with a project that records nothing", () => {
    expect(checkNarrative({ timeline: timeline([]), scenes, threads: [], setups: [] })).toEqual([]);
  });
});

// ── Canon boundary ───────────────────────────────────────────────────────────

describe("proposed thread state", () => {
  it("ignores proposals unless asked to preview them", () => {
    const tl = timeline([
      t("SCENE_0002", "thread_appearance", VAULT, "introduces", {
        confirmationStatus: "proposed",
      }),
    ]);
    expect(tl.threadStateAt({ id: VAULT }, at("SCENE_0004")).status).toBe("planned");
    expect(
      tl.threadStateAt({ id: VAULT }, at("SCENE_0004"), { include: "with_proposed" }).status,
    ).toBe("introduced");
  });
});
