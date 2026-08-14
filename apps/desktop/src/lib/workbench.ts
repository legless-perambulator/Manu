/**
 * The workbench layout model.
 *
 * Manu stopped being a fixed three-column IDE here. A writer drafting a scene
 * wants the manuscript and one character sheet; a writer planning wants the
 * outline; a writer working with the agent wants the manuscript, the agent and
 * what the agent was given. Those are different rooms, not different
 * applications, so the workbench is a small data structure the writer rearranges
 * rather than a layout the code hard-codes.
 *
 * ## Two docks, each a stack of tabs
 *
 * The manuscript is not a dock. It is the centre, it is always present, and it
 * is what survives every narrowing — that is the product's shape and it is not
 * negotiable (docs/UX.md). Around it sit a left and a right dock; each holds an
 * ordered stack of panels with one active, and each can be closed entirely.
 *
 * ## Widths are fractions, never pixels
 *
 * A layout saved on a 3440px ultrawide and reopened on a 1280px laptop must not
 * leave a writer with 1100px of sidebar and no manuscript. Widths are stored as
 * a fraction of the window and clamped on both sides, so a layout is portable
 * between displays by construction (§16).
 *
 * Everything in this file is pure. `repairLayout` is the only entry point that
 * accepts unknown data, and it accepts *anything*: a corrupted value, a layout
 * from an older build, a panel that a genre module has since switched off.
 */

import { isPanelId, panelById, type DockSide, type LeftPanelId } from "./panels";

export interface DockState {
  /** Tabs, in the order they are shown. */
  readonly panels: readonly LeftPanelId[];
  readonly active: LeftPanelId | null;
  /** Fraction of the workbench width, clamped to [MIN_WIDTH, MAX_WIDTH]. */
  readonly width: number;
  readonly open: boolean;
}

export interface WorkbenchLayout {
  readonly left: DockState;
  readonly right: DockState;
  /**
   * Focus Mode: the manuscript alone.
   *
   * Stored as a flag over the layout rather than as a different layout, so
   * leaving it restores exactly what was there — which is the whole promise of
   * a mode you can enter with one key (§17).
   */
  readonly focus: boolean;
  readonly preset: PresetId;
}

export const MIN_WIDTH = 0.14;
export const MAX_WIDTH = 0.36;
/** The manuscript keeps at least this much of the window, whatever the docks want. */
export const MIN_EDITOR = 0.3;

export type PresetId = "write" | "plan" | "ai" | "edit" | "custom";

export interface Preset {
  readonly id: PresetId;
  readonly label: string;
  readonly purpose: string;
}

export const PRESETS: readonly Preset[] = [
  { id: "write", label: "Write", purpose: "The manuscript, and nothing in the way" },
  { id: "plan", label: "Plan", purpose: "The manuscript beside the outline and the cast" },
  { id: "ai", label: "AI", purpose: "The manuscript, Manu Agent, and what it was given" },
  { id: "edit", label: "Edit", purpose: "The manuscript with the checks and the changes" },
  { id: "custom", label: "Custom", purpose: "Whatever you last arranged" },
];

function dock(panels: readonly LeftPanelId[], width: number, open = true): DockState {
  return { panels, active: panels[0] ?? null, width, open };
}

/**
 * The four starting arrangements.
 *
 * Starting points, not modes: touching anything moves the layout to `custom`
 * and the writer keeps what they made. Four is deliberate — a preset system
 * with fifteen entries is another thing to learn.
 */
const PRESET_LAYOUTS: Readonly<Record<Exclude<PresetId, "custom">, WorkbenchLayout>> = {
  write: {
    left: dock(["manuscript"], 0.18, false),
    right: dock([], 0.22, false),
    focus: false,
    preset: "write",
  },
  plan: {
    left: dock(["outline", "manuscript", "notes"], 0.22),
    right: dock(["characters", "inspector"], 0.24),
    focus: false,
    preset: "plan",
  },
  ai: {
    left: dock(["manuscript"], 0.17),
    right: dock(["agent", "context", "history"], 0.32),
    focus: false,
    preset: "ai",
  },
  edit: {
    left: dock(["build", "tests", "search"], 0.22),
    right: dock(["inspector", "history"], 0.24),
    focus: false,
    preset: "edit",
  },
};

export function presetLayout(id: PresetId): WorkbenchLayout {
  if (id === "custom") return DEFAULT_LAYOUT;
  return PRESET_LAYOUTS[id];
}

/**
 * What a writer meets on a first run.
 *
 * Not the emptiest preset and not the fullest: the manuscript with a way to
 * find the next chapter, and the details panel where a selection will land.
 * "Great defaults, progressive customisation" means the default has to be the
 * one most people would have built (§29).
 */
export const DEFAULT_LAYOUT: WorkbenchLayout = {
  left: dock(["manuscript", "outline"], 0.2),
  right: dock(["inspector", "agent"], 0.24),
  focus: false,
  preset: "custom",
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * Make any value into a layout that works.
 *
 * Called on everything read from storage. The contract is that it never throws
 * and never returns something unusable: unknown panels are dropped (a genre
 * module was switched off, or the build changed), widths are clamped, the
 * active tab is corrected to one that exists, an empty dock is closed, and the
 * manuscript always has room left over.
 */
export function repairLayout(value: unknown, allowed: readonly LeftPanelId[]): WorkbenchLayout {
  const source = isRecord(value) ? value : {};
  const known = new Set(allowed);

  const left = repairDock(source["left"], known, DEFAULT_LAYOUT.left);
  const right = repairDock(source["right"], known, DEFAULT_LAYOUT.right);

  // A panel may only be in one dock. If a stale layout has it in both, the
  // left copy wins and the right one is dropped — silently, because the
  // alternative is a tab whose content appears twice and updates once.
  const deduped: DockState = {
    ...right,
    panels: right.panels.filter((id) => !left.panels.includes(id)),
  };
  const rightFixed = withValidActive(deduped);

  const preset = isPresetId(source["preset"]) ? source["preset"] : "custom";
  const focus = source["focus"] === true;

  return fitEditor({ left, right: rightFixed, focus, preset });
}

function repairDock(value: unknown, known: Set<LeftPanelId>, fallback: DockState): DockState {
  if (!isRecord(value)) return fallback;
  const raw = Array.isArray(value["panels"]) ? value["panels"] : [];
  const panels: LeftPanelId[] = [];
  for (const entry of raw) {
    if (isPanelId(entry) && known.has(entry) && !panels.includes(entry)) panels.push(entry);
  }
  const width =
    typeof value["width"] === "number" && Number.isFinite(value["width"])
      ? clamp(value["width"], MIN_WIDTH, MAX_WIDTH)
      : fallback.width;
  // A layout written by an older build may not say whether the dock was open.
  // Having tabs is the better guess than hiding them.
  const open = value["open"] === undefined ? panels.length > 0 : value["open"] === true;
  const active = value["active"];
  return withValidActive({
    panels,
    active: isPanelId(active) ? active : null,
    width,
    open,
  });
}

function withValidActive(state: DockState): DockState {
  const active =
    state.active !== null && state.panels.includes(state.active)
      ? state.active
      : (state.panels[0] ?? null);
  return { ...state, active, open: state.open && state.panels.length > 0 };
}

/**
 * Give the manuscript its floor back.
 *
 * Two docks at their maximum would leave under a third of the window for the
 * thing the application is for. Both are scaled down in proportion rather than
 * one being blamed, so the writer's sense of the arrangement survives.
 */
function fitEditor(layout: WorkbenchLayout): WorkbenchLayout {
  const used =
    (layout.left.open ? layout.left.width : 0) + (layout.right.open ? layout.right.width : 0);
  if (used <= 1 - MIN_EDITOR) return layout;
  const scale = (1 - MIN_EDITOR) / used;
  return {
    ...layout,
    left: { ...layout.left, width: clamp(layout.left.width * scale, MIN_WIDTH, MAX_WIDTH) },
    right: { ...layout.right, width: clamp(layout.right.width * scale, MIN_WIDTH, MAX_WIDTH) },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPresetId(value: unknown): value is PresetId {
  return PRESETS.some((preset) => preset.id === value);
}

/** Any change a writer makes to the arrangement is theirs, not the preset's. */
function asCustom(layout: WorkbenchLayout): WorkbenchLayout {
  return layout.preset === "custom" ? layout : { ...layout, preset: "custom" };
}

export function dockOf(layout: WorkbenchLayout, id: LeftPanelId): DockSide | null {
  if (layout.left.panels.includes(id)) return "left";
  if (layout.right.panels.includes(id)) return "right";
  return null;
}

/** Whether a panel is on screen right now — open dock, active tab, not in Focus. */
export function isShowing(layout: WorkbenchLayout, id: LeftPanelId): boolean {
  if (layout.focus) return false;
  const side = dockOf(layout, id);
  if (side === null) return false;
  const state = layout[side];
  return state.open && state.active === id;
}

/**
 * Show a panel, wherever it needs to come from.
 *
 * One verb for the whole application: the command palette, a keyboard shortcut
 * and a link inside another panel all end up here, so "open Characters" means
 * the same thing however it was asked. If the panel is already docked it is
 * activated where it is rather than moved — a writer who put it on the left
 * meant it.
 */
export function openPanel(
  layout: WorkbenchLayout,
  id: LeftPanelId,
  side?: DockSide,
): WorkbenchLayout {
  const existing = dockOf(layout, id);
  const target = side ?? existing ?? panelById(id).side;
  const next = asCustom({ ...layout, focus: false });

  if (existing !== null && existing !== target) return openPanel(movePanel(next, id, target), id);

  const state = next[target];
  const panels = state.panels.includes(id) ? state.panels : [...state.panels, id];
  return fitEditor({ ...next, [target]: { ...state, panels, active: id, open: true } });
}

/**
 * Close a tab.
 *
 * The tab is removed rather than merely deactivated, because a stack of hidden
 * tabs a writer cannot see is a mess they cannot tidy. Emptying a dock closes
 * it, and the panel is one palette entry away from coming back.
 */
export function closePanel(layout: WorkbenchLayout, id: LeftPanelId): WorkbenchLayout {
  const side = dockOf(layout, id);
  if (side === null) return layout;
  const state = layout[side];
  const panels = state.panels.filter((entry) => entry !== id);
  return fitEditor(
    asCustom({
      ...layout,
      [side]: withValidActive({ ...state, panels, open: state.open && panels.length > 0 }),
    }),
  );
}

export function setActive(
  layout: WorkbenchLayout,
  side: DockSide,
  id: LeftPanelId,
): WorkbenchLayout {
  const state = layout[side];
  if (!state.panels.includes(id)) return layout;
  return asCustom({ ...layout, [side]: { ...state, active: id, open: true } });
}

/** Put a panel in the other dock, at the end, and make it the active tab there. */
export function movePanel(layout: WorkbenchLayout, id: LeftPanelId, to: DockSide): WorkbenchLayout {
  const from = dockOf(layout, id);
  if (from === null || from === to) return layout;
  const source = layout[from];
  const destination = layout[to];
  return fitEditor(
    asCustom({
      ...layout,
      [from]: withValidActive({
        ...source,
        panels: source.panels.filter((entry) => entry !== id),
        open: source.open && source.panels.length > 1,
      }),
      [to]: { ...destination, panels: [...destination.panels, id], active: id, open: true },
    }),
  );
}

/** Reorder a tab inside its own dock, by drag or by keyboard. */
export function reorderPanel(
  layout: WorkbenchLayout,
  side: DockSide,
  id: LeftPanelId,
  index: number,
): WorkbenchLayout {
  const state = layout[side];
  const from = state.panels.indexOf(id);
  if (from === -1) return layout;
  const panels = [...state.panels];
  panels.splice(from, 1);
  panels.splice(clamp(index, 0, panels.length), 0, id);
  return asCustom({ ...layout, [side]: { ...state, panels } });
}

export function toggleDock(layout: WorkbenchLayout, side: DockSide): WorkbenchLayout {
  const state = layout[side];
  if (state.panels.length === 0) return layout;
  return fitEditor(asCustom({ ...layout, [side]: { ...state, open: !state.open }, focus: false }));
}

export function resizeDock(
  layout: WorkbenchLayout,
  side: DockSide,
  width: number,
): WorkbenchLayout {
  const safe = Number.isFinite(width) ? clamp(width, MIN_WIDTH, MAX_WIDTH) : layout[side].width;
  return fitEditor(asCustom({ ...layout, [side]: { ...layout[side], width: safe } }));
}

/**
 * Focus Mode, and the way back.
 *
 * The docks are left exactly as they were — the flag is what changes — so
 * leaving restores the arrangement rather than a guess at it. That is the
 * difference between a mode and a layout change (§17).
 */
export function setFocus(layout: WorkbenchLayout, focus: boolean): WorkbenchLayout {
  return layout.focus === focus ? layout : { ...layout, focus };
}

const STORAGE_KEY = "manu.workbench.v1";

export function loadLayout(allowed: readonly LeftPanelId[]): WorkbenchLayout {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return repairLayout(DEFAULT_LAYOUT, allowed);
    return repairLayout(JSON.parse(raw), allowed);
  } catch {
    // Corrupt storage, a locked-down webview, anything: the default is a good
    // workspace and losing an arrangement is a nuisance, not a failure.
    return repairLayout(DEFAULT_LAYOUT, allowed);
  }
}

export function saveLayout(layout: WorkbenchLayout): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Not remembering the arrangement must never interrupt writing.
  }
}
