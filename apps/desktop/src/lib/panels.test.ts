import { describe, expect, it } from "vitest";
import {
  PANELS,
  firstPanelOfGroup,
  panelsInGroup,
  visiblePanels,
  type LeftPanelId,
} from "./panels";

/**
 * The workspace adapts to what is switched on.
 *
 * One registry feeds the sidebar, the command palette and the keyboard
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

  it("filters the group strip and the group's landing panel together", () => {
    const withoutMystery = visiblePanels([]);
    expect(ids(panelsInGroup("verify", withoutMystery))).not.toContain("mystery");
    // Every group still has somewhere to land with nothing enabled.
    for (const group of ["project", "story", "verify", "change"] as const) {
      expect(() => firstPanelOfGroup(group, withoutMystery)).not.toThrow();
    }
  });

  it("gives every panel a distinct id", () => {
    expect(new Set(PANELS.map((panel) => panel.id)).size).toBe(PANELS.length);
  });
});
