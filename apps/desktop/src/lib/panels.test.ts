import { describe, expect, it } from "vitest";
import {
  PANELS,
  PANEL_GROUPS,
  isPanelId,
  panelById,
  panelsInGroup,
  visiblePanels,
  type LeftPanelId,
} from "./panels";
import { isWriterFacing } from "./naming";

/**
 * The workspace adapts to what is switched on.
 *
 * One registry feeds the docks, the command palette and the keyboard
 * shortcuts, so this is the only place the rule needs to hold — and the reason
 * a hidden panel cannot still be reachable by shortcut (docs/GENRE_MODULES.md).
 */
describe("panels are filtered by the modules a project uses", () => {
  const ids = (panels: readonly { id: LeftPanelId }[]) => panels.map((panel) => panel.id);

  it("hides a module's panel until its module is on", () => {
    expect(ids(visiblePanels([]))).not.toContain("mystery");
    expect(ids(visiblePanels(["mystery"]))).toContain("mystery");
  });

  it("keeps every core panel whatever is enabled", () => {
    const core = PANELS.filter(
      (panel) => panel.module === undefined && panel.needsExtensionKinds !== true,
    );
    for (const panel of core) {
      expect(ids(visiblePanels([]))).toContain(panel.id);
      expect(ids(visiblePanels(["mystery", "fantasy"]))).toContain(panel.id);
    }
  });

  it("shows the World panel only once something records into it", () => {
    // Mystery has a subsystem of its own and declares no record kinds, so
    // enabling it alone gives the writer nothing to browse there.
    expect(ids(visiblePanels(["mystery"], { hasExtensionKinds: false }))).not.toContain("world");
    expect(ids(visiblePanels(["fantasy"], { hasExtensionKinds: true }))).toContain("world");
  });

  it("always offers the Modules panel, so a project is never stuck", () => {
    expect(ids(visiblePanels([]))).toContain("modules");
  });

  it("keeps the manuscript reachable with nothing enabled at all", () => {
    expect(ids(visiblePanels([]))).toContain("manuscript");
    expect(ids(visiblePanels([]))).toContain("outline");
  });

  it("filters a group and never leaves one empty", () => {
    const withoutMystery = visiblePanels([]);
    expect(ids(panelsInGroup("check", withoutMystery))).not.toContain("mystery");
    for (const group of PANEL_GROUPS) {
      expect(panelsInGroup(group.id, withoutMystery).length).toBeGreaterThan(0);
    }
  });

  it("gives every panel a distinct id and a real group", () => {
    expect(new Set(PANELS.map((panel) => panel.id)).size).toBe(PANELS.length);
    const groups = new Set(PANEL_GROUPS.map((group) => group.id));
    for (const panel of PANELS) expect(groups.has(panel.group)).toBe(true);
  });

  it("recognises its own ids and rejects anything else", () => {
    expect(isPanelId("manuscript")).toBe(true);
    expect(isPanelId("relationships.json")).toBe(false);
    expect(isPanelId(undefined)).toBe(false);
    expect(panelById("outline").label).toBe("Outline");
  });
});

/**
 * The rule of this phase, asserted rather than asserted-to.
 *
 * A panel is a writer-facing concept. If somebody adds `facts.json` as a panel
 * label, or names one after a schema, this fails — which is the only way the
 * principle survives the next feature.
 */
describe("no panel leaks a backend concept", () => {
  it("labels every panel in prose", () => {
    for (const panel of PANELS) {
      expect(isWriterFacing(panel.label), `${panel.id} label: ${panel.label}`).toBe(true);
      expect(panel.purpose.length).toBeGreaterThan(8);
    }
  });

  it("keeps the raw filesystem out of the normal groups", () => {
    // Openness is not removed — it is made secondary. "Project files" exists,
    // and it is the only panel that shows a path, and it lives in Advanced.
    const raw = PANELS.filter((panel) => panel.id === "files");
    expect(raw).toHaveLength(1);
    expect(raw[0]?.group).toBe("advanced");
  });

  it("opens reference material on the side it is read from", () => {
    // A character sheet belongs beside the manuscript, not underneath the
    // navigation the writer just used to find it.
    expect(panelById("characters").side).toBe("right");
    expect(panelById("agent").side).toBe("right");
    expect(panelById("manuscript").side).toBe("left");
  });
});
