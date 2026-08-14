import { describe, expect, it } from "vitest";
import { LEFT_PANELS, type LeftPanelId } from "./panels";
import {
  DEFAULT_LAYOUT,
  MAX_WIDTH,
  MIN_EDITOR,
  MIN_WIDTH,
  PRESETS,
  closePanel,
  dockOf,
  isShowing,
  movePanel,
  openPanel,
  presetLayout,
  reorderPanel,
  repairLayout,
  resizeDock,
  setActive,
  setFocus,
  toggleDock,
  type WorkbenchLayout,
} from "./workbench";

const ALL: readonly LeftPanelId[] = LEFT_PANELS;
const fresh = () => repairLayout(DEFAULT_LAYOUT, ALL);
const editorWidth = (layout: WorkbenchLayout) =>
  1 - (layout.left.open ? layout.left.width : 0) - (layout.right.open ? layout.right.width : 0);

describe("opening and closing panels", () => {
  it("opens a panel in the dock it belongs to and makes it the active tab", () => {
    const layout = openPanel(fresh(), "characters");
    expect(dockOf(layout, "characters")).toBe("right");
    expect(layout.right.active).toBe("characters");
    expect(isShowing(layout, "characters")).toBe(true);
  });

  it("activates a panel where it already is rather than moving it", () => {
    // A writer who put the outline on the right meant it. "Open Outline" from
    // the palette should not undo that.
    const moved = movePanel(openPanel(fresh(), "outline"), "outline", "right");
    const again = openPanel(moved, "outline");
    expect(dockOf(again, "outline")).toBe("right");
  });

  it("takes a panel out of the stack when it is closed", () => {
    const layout = closePanel(fresh(), "manuscript");
    expect(layout.left.panels).not.toContain("manuscript");
    expect(layout.left.active).toBe("outline");
  });

  it("closes a dock once its last tab is gone", () => {
    let layout = fresh();
    for (const id of layout.left.panels) layout = closePanel(layout, id);
    expect(layout.left.open).toBe(false);
    expect(layout.left.active).toBeNull();
  });

  it("ignores a request to close something that is not open", () => {
    const layout = fresh();
    expect(closePanel(layout, "mystery")).toBe(layout);
  });

  it("leaves Focus Mode when a panel is asked for", () => {
    const layout = openPanel(setFocus(fresh(), true), "agent");
    expect(layout.focus).toBe(false);
  });
});

describe("tab stacks", () => {
  it("stacks several panels in one dock with one active", () => {
    const layout = openPanel(openPanel(fresh(), "notes"), "research");
    expect(layout.left.panels).toEqual(["manuscript", "outline", "notes", "research"]);
    expect(layout.left.active).toBe("research");
    expect(isShowing(layout, "notes")).toBe(false);
  });

  it("switches the active tab without disturbing the stack", () => {
    const layout = setActive(openPanel(fresh(), "notes"), "left", "manuscript");
    expect(layout.left.active).toBe("manuscript");
    expect(layout.left.panels).toContain("notes");
  });

  it("will not activate a tab that is not in that dock", () => {
    const layout = fresh();
    expect(setActive(layout, "right", "manuscript")).toBe(layout);
  });

  it("reorders tabs and clamps a silly index", () => {
    const layout = reorderPanel(fresh(), "left", "outline", 0);
    expect(layout.left.panels).toEqual(["outline", "manuscript"]);
    expect(reorderPanel(layout, "left", "outline", 99).left.panels).toEqual([
      "manuscript",
      "outline",
    ]);
    expect(reorderPanel(layout, "left", "agent", 0)).toBe(layout);
  });
});

describe("moving panels between docks", () => {
  it("moves a panel across and activates it where it lands", () => {
    const layout = movePanel(fresh(), "outline", "right");
    expect(dockOf(layout, "outline")).toBe("right");
    expect(layout.right.active).toBe("outline");
    expect(layout.left.panels).not.toContain("outline");
  });

  it("closes the dock a move emptied", () => {
    let layout = closePanel(fresh(), "outline");
    layout = movePanel(layout, "manuscript", "right");
    expect(layout.left.open).toBe(false);
  });

  it("does nothing when the panel is already there", () => {
    const layout = fresh();
    expect(movePanel(layout, "manuscript", "left")).toBe(layout);
    expect(movePanel(layout, "mystery", "right")).toBe(layout);
  });
});

describe("Focus Mode", () => {
  it("hides everything but the manuscript and gives it back unchanged", () => {
    const arranged = openPanel(openPanel(fresh(), "notes"), "agent");
    const focused = setFocus(arranged, true);
    expect(isShowing(focused, "notes")).toBe(false);
    expect(isShowing(focused, "agent")).toBe(false);
    // The docks are untouched: leaving restores the arrangement, not a guess.
    expect(setFocus(focused, false)).toEqual(arranged);
  });

  it("is a no-op when it is already in the state asked for", () => {
    const layout = fresh();
    expect(setFocus(layout, false)).toBe(layout);
  });
});

describe("sizing", () => {
  it("clamps a dock to sensible bounds", () => {
    expect(resizeDock(fresh(), "left", 0.9).left.width).toBeLessThanOrEqual(MAX_WIDTH);
    expect(resizeDock(fresh(), "left", 0.01).left.width).toBeGreaterThanOrEqual(MIN_WIDTH);
    expect(resizeDock(fresh(), "left", Number.NaN).left.width).toBe(fresh().left.width);
  });

  it("never lets the docks squeeze the manuscript below its floor", () => {
    const wide = resizeDock(resizeDock(fresh(), "left", MAX_WIDTH), "right", MAX_WIDTH);
    expect(editorWidth(wide)).toBeGreaterThanOrEqual(MIN_EDITOR - 1e-9);
  });

  it("hides and shows a dock without losing its tabs", () => {
    const closed = toggleDock(fresh(), "right");
    expect(closed.right.open).toBe(false);
    expect(closed.right.panels).toEqual(fresh().right.panels);
    expect(toggleDock(closed, "right").right.open).toBe(true);
  });

  it("will not open a dock that has nothing in it", () => {
    let layout = fresh();
    for (const id of layout.right.panels) layout = closePanel(layout, id);
    expect(toggleDock(layout, "right")).toBe(layout);
  });
});

describe("presets are starting points, not modes", () => {
  it("gives the manuscript the room in Write", () => {
    const write = presetLayout("write");
    expect(write.left.open).toBe(false);
    expect(write.right.open).toBe(false);
  });

  it("puts the agent and its evidence together in AI", () => {
    const ai = presetLayout("ai");
    expect(ai.right.panels).toContain("agent");
    expect(ai.right.panels).toContain("context");
  });

  it("becomes the writer's own the moment they change anything", () => {
    for (const preset of PRESETS) {
      const layout = presetLayout(preset.id);
      expect(openPanel(layout, "notes").preset).toBe("custom");
    }
  });

  it("keeps every preset inside the rules the layout enforces", () => {
    for (const preset of PRESETS) {
      const repaired = repairLayout(presetLayout(preset.id), ALL);
      expect(editorWidth(repaired)).toBeGreaterThanOrEqual(MIN_EDITOR - 1e-9);
      for (const side of ["left", "right"] as const) {
        expect(repaired[side].width).toBeGreaterThanOrEqual(MIN_WIDTH);
        expect(repaired[side].width).toBeLessThanOrEqual(MAX_WIDTH);
      }
    }
  });
});

/**
 * The layout is read from storage, which means it is untrusted input: it can be
 * corrupt, it can be from an older build, and it can name a panel a genre
 * module has since switched off. Repair never throws and always returns
 * something a writer can work in.
 */
describe("repairing a layout from storage", () => {
  it("survives anything at all", () => {
    for (const value of [null, undefined, 7, "layout", [], { left: 3 }, { left: { panels: 9 } }]) {
      expect(() => repairLayout(value, ALL)).not.toThrow();
      expect(repairLayout(value, ALL).left.width).toBeGreaterThanOrEqual(MIN_WIDTH);
    }
  });

  it("drops a panel that is no longer available", () => {
    // Exactly what happens when the Mystery module is switched off while its
    // panel is docked.
    const stored = { left: { panels: ["manuscript", "mystery"], active: "mystery", open: true } };
    const allowed = ALL.filter((id) => id !== "mystery");
    const repaired = repairLayout(stored, allowed);
    expect(repaired.left.panels).toEqual(["manuscript"]);
    expect(repaired.left.active).toBe("manuscript");
  });

  it("drops names that were never panels", () => {
    const stored = { left: { panels: ["manuscript", "relationships.json", 42], open: true } };
    expect(repairLayout(stored, ALL).left.panels).toEqual(["manuscript"]);
  });

  it("keeps a panel in one dock only", () => {
    const stored = {
      left: { panels: ["manuscript", "agent"], open: true },
      right: { panels: ["agent", "inspector"], active: "agent", open: true },
    };
    const repaired = repairLayout(stored, ALL);
    expect(dockOf(repaired, "agent")).toBe("left");
    expect(repaired.right.panels).toEqual(["inspector"]);
    expect(repaired.right.active).toBe("inspector");
  });

  it("rescales a layout saved on a much wider display", () => {
    // 0.45 + 0.45 of an ultrawide leaves a tenth of a laptop for the book.
    const stored = {
      left: { panels: ["manuscript"], width: 0.45, open: true },
      right: { panels: ["agent"], width: 0.45, open: true },
    };
    const repaired = repairLayout(stored, ALL);
    expect(editorWidth(repaired)).toBeGreaterThanOrEqual(MIN_EDITOR - 1e-9);
  });

  it("closes a dock whose tabs all went away", () => {
    const stored = { right: { panels: ["mystery"], open: true } };
    const repaired = repairLayout(
      stored,
      ALL.filter((id) => id !== "mystery"),
    );
    expect(repaired.right.open).toBe(false);
    expect(repaired.right.active).toBeNull();
  });

  it("keeps a recognised preset and falls back to custom otherwise", () => {
    expect(repairLayout({ preset: "ai" }, ALL).preset).toBe("ai");
    expect(repairLayout({ preset: "nonsense" }, ALL).preset).toBe("custom");
  });

  it("round-trips a layout through JSON unchanged", () => {
    const arranged = resizeDock(openPanel(openPanel(fresh(), "notes"), "agent"), "left", 0.25);
    expect(repairLayout(JSON.parse(JSON.stringify(arranged)), ALL)).toEqual(arranged);
  });
});
