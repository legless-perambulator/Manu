/**
 * The workbench's panel registry.
 *
 * One list feeds the dock tabs, the command palette and the keyboard layer, so
 * a panel can never appear in one and be missing from another. Two rules hold
 * here and are asserted in the tests:
 *
 * 1. **A panel is a writer-facing concept, never a backing file.** There is no
 *    `relationships.json` panel; there is a Relationships view. The only place
 *    the filesystem appears is the deliberately secondary Project files panel.
 * 2. **A panel label is prose.** No extensions, no IDs, no schema words. The
 *    naming layer (`lib/naming.ts`) defines what that means and the tests apply
 *    it to every label in this file.
 *
 * `side` is the dock a panel prefers when it is opened without being told
 * where to go. It is a default, not a constraint: the writer can move any panel
 * to either dock (docs/UX.md).
 */

export const LEFT_PANELS = [
  "manuscript",
  "outline",
  "chapterplan",
  "notes",
  "research",
  "characters",
  "entities",
  "state",
  "knowledge",
  "relations",
  "objects",
  "threads",
  "timeline",
  "world",
  "storymap",
  "mapping",
  "universe",
  "chapterbuild",
  "actbuild",
  "bookbuild",
  "inspector",
  "agent",
  "terminal",
  "context",
  "search",
  "build",
  "tests",
  "debug",
  "skills",
  "workflows",
  "readers",
  "behaviour",
  "mystery",
  "voice",
  "history",
  "versions",
  "causality",
  "refactor",
  "usage",
  "export",
  "modules",
  "plugins",
  "studio",
  "files",
] as const;

export type LeftPanelId = (typeof LEFT_PANELS)[number];

export type PanelGroupId = "write" | "story" | "assist" | "check" | "change" | "advanced";

export type DockSide = "left" | "right";

export interface PanelDefinition {
  readonly id: LeftPanelId;
  readonly group: PanelGroupId;
  readonly label: string;
  /** What the panel answers, shown in the command palette. */
  readonly purpose: string;
  /** The dock this panel opens in when nothing says otherwise. */
  readonly side: DockSide;
  /**
   * The genre module this panel arrives with, when it is not a core panel.
   *
   * Hidden entirely while that module is off — from the docks, the command
   * palette and the shortcuts alike, because they all read this one registry
   * (docs/GENRE_MODULES.md).
   */
  readonly module?: string;
  /** Shown only when at least one module declaring record kinds is on. */
  readonly needsExtensionKinds?: boolean;
}

export interface PanelGroup {
  readonly id: PanelGroupId;
  readonly label: string;
  readonly purpose: string;
}

export const PANEL_GROUPS: readonly PanelGroup[] = [
  { id: "write", label: "Write", purpose: "The book, its shape and your notes" },
  { id: "story", label: "Story", purpose: "Who is in it, what is true and when" },
  { id: "assist", label: "Assist", purpose: "Manu's help, and exactly what it was given" },
  { id: "check", label: "Check", purpose: "What the project can verify for itself" },
  { id: "change", label: "Change", purpose: "What has changed, and what a change would reach" },
  { id: "advanced", label: "Advanced", purpose: "The project as it is stored on disk" },
];

export const PANELS: readonly PanelDefinition[] = [
  {
    id: "manuscript",
    group: "write",
    label: "Manuscript",
    purpose: "Your chapters, in order",
    side: "left",
  },
  {
    id: "outline",
    group: "write",
    label: "Outline",
    purpose: "The shape of the book, chapter by scene",
    side: "left",
  },
  {
    id: "chapterplan",
    group: "write",
    label: "Chapter plan",
    purpose: "Plan a chapter's scenes and beats before drafting",
    side: "left",
  },
  {
    id: "notes",
    group: "write",
    label: "Notes",
    purpose: "Anything you wrote to yourself",
    side: "left",
  },
  {
    id: "research",
    group: "write",
    label: "Research",
    purpose: "What you looked up while writing — sourced, linked, never canon",
    side: "left",
  },
  {
    id: "characters",
    group: "story",
    label: "Characters",
    purpose: "Who they are, what they want and where they appear",
    side: "right",
  },
  {
    id: "entities",
    group: "story",
    label: "Story bible",
    purpose: "Everything the project records, in one list",
    side: "left",
  },
  {
    id: "state",
    group: "story",
    label: "State",
    purpose: "Where everyone was, at any point in the book",
    side: "left",
  },
  {
    id: "knowledge",
    group: "story",
    label: "Knowledge",
    purpose: "Who knows what, and how they learned it",
    side: "left",
  },
  {
    id: "relations",
    group: "story",
    label: "Relationships",
    purpose: "How the characters stand to each other over time",
    side: "left",
  },
  {
    id: "objects",
    group: "story",
    label: "Objects",
    purpose: "Where things are and who is holding them",
    side: "left",
  },
  {
    id: "threads",
    group: "story",
    label: "Plot threads",
    purpose: "Threads, setups and the payoffs they promise",
    side: "left",
  },
  {
    id: "timeline",
    group: "story",
    label: "Timeline",
    purpose: "Story chronology against the order you tell it in",
    side: "left",
  },
  {
    id: "world",
    group: "story",
    label: "World",
    purpose: "Everything the enabled genre modules record",
    side: "left",
    needsExtensionKinds: true,
  },
  {
    id: "storymap",
    group: "story",
    label: "Story Map",
    purpose: "Explore the story visually: time, knowledge, relationships, causality",
    side: "left",
  },
  {
    id: "mapping",
    group: "story",
    label: "Map Manuscript",
    purpose: "Reconstruct structured story data from an imported book, with review",
    side: "left",
  },
  {
    id: "universe",
    group: "story",
    label: "Universe",
    purpose: "The shared world across books: canon, timeline, memory, boundaries",
    side: "left",
  },
  {
    id: "chapterbuild",
    group: "assist",
    label: "Write chapter",
    purpose: "Build a chapter from its scene plan, scene by scene",
    side: "right",
  },
  {
    id: "actbuild",
    group: "assist",
    label: "Write act",
    purpose: "Build an act chapter by chapter, toward its goals",
    side: "right",
  },
  {
    id: "bookbuild",
    group: "assist",
    label: "Write book",
    purpose: "Build the whole book from its plan, act by act",
    side: "right",
  },
  {
    id: "inspector",
    group: "assist",
    label: "Details",
    purpose: "The record behind whatever you have selected",
    side: "right",
  },
  {
    id: "agent",
    group: "assist",
    label: "Manu Agent",
    purpose: "Put Manu to work on the project",
    side: "right",
  },
  {
    id: "terminal",
    group: "assist",
    label: "Terminal",
    purpose: "Type commands over the real story systems",
    side: "left",
  },
  {
    id: "context",
    group: "assist",
    label: "Context",
    purpose: "Exactly what a model would be given",
    side: "right",
  },
  {
    id: "search",
    group: "assist",
    label: "Find in project",
    purpose: "Search every chapter, note and record",
    side: "left",
  },
  {
    id: "build",
    group: "check",
    label: "Story Build",
    purpose: "Run every deterministic check and read the problems",
    side: "left",
  },
  {
    id: "tests",
    group: "check",
    label: "Story tests",
    purpose: "The assertions you wrote, re-asked on every build",
    side: "left",
  },
  {
    id: "debug",
    group: "check",
    label: "Diagnose",
    purpose: "Investigate why something is not landing",
    side: "left",
  },
  {
    id: "skills",
    group: "check",
    label: "Passes",
    purpose: "Repeatable passes over the book, step by step",
    side: "left",
  },
  {
    id: "workflows",
    group: "check",
    label: "Workflows",
    purpose: "Specialists working together, one approved step at a time",
    side: "left",
  },
  {
    id: "readers",
    group: "check",
    label: "Readers",
    purpose: "How a reader experiences the book, chapter by chapter",
    side: "left",
  },
  {
    id: "behaviour",
    group: "check",
    label: "Behaviour",
    purpose: "Whether a character would really do this, here",
    side: "left",
  },
  {
    id: "mystery",
    group: "check",
    label: "Mystery",
    purpose: "Clues, deductions, and whether the reader could have got there",
    side: "left",
    module: "mystery",
  },
  {
    id: "voice",
    group: "check",
    label: "Voice",
    purpose: "What Manu thinks your style is, and your rules for it",
    side: "left",
  },
  {
    id: "history",
    group: "change",
    label: "Changes",
    purpose: "Every change, with diffs and checkpoints",
    side: "right",
  },
  {
    id: "versions",
    group: "change",
    label: "Versions",
    purpose: "Alternative versions of the whole story",
    side: "left",
  },
  {
    id: "causality",
    group: "change",
    label: "Consequences",
    purpose: "What depends on what, and the blast radius",
    side: "left",
  },
  {
    id: "refactor",
    group: "change",
    label: "Restructure",
    purpose: "Analyse, plan and validate a structural change",
    side: "left",
  },
  {
    id: "usage",
    group: "advanced",
    label: "Usage & costs",
    purpose: "What AI work actually cost — today, this month, this project",
    side: "left",
  },
  {
    id: "export",
    group: "write",
    label: "Export",
    purpose: "The manuscript as DOCX, EPUB, PDF or text — and the project as an archive",
    side: "left",
  },
  {
    id: "modules",
    group: "advanced",
    label: "Modules",
    purpose: "Which genre modules this project uses",
    side: "left",
  },
  {
    id: "studio",
    group: "assist",
    label: "Studio",
    purpose: "Create your own agents and multi-step skills, no code required",
    side: "left",
  },
  {
    id: "plugins",
    group: "advanced",
    label: "Plugins",
    purpose: "Extensions this project uses, and exactly what each may touch",
    side: "left",
  },
  {
    id: "files",
    group: "advanced",
    label: "Project files",
    purpose: "The real folder on disk, for when you want it",
    side: "left",
  },
];

const BY_ID = new Map(PANELS.map((panel) => [panel.id, panel]));

export function panelById(id: LeftPanelId): PanelDefinition {
  const found = BY_ID.get(id);
  /* istanbul ignore next — LeftPanelId is closed over PANELS. */
  if (found === undefined) throw new Error(`Unknown panel: ${id}`);
  return found;
}

export function isPanelId(value: unknown): value is LeftPanelId {
  return typeof value === "string" && BY_ID.has(value as LeftPanelId);
}

/**
 * The panels a project can currently see.
 *
 * One filter, applied everywhere. The alternative — each consumer deciding for
 * itself — is how a panel ends up reachable by keyboard shortcut after being
 * hidden from the docks.
 */
export function visiblePanels(
  enabled: readonly string[],
  options: { hasExtensionKinds?: boolean } = {},
): readonly PanelDefinition[] {
  return PANELS.filter((panel) => {
    if (panel.module !== undefined && !enabled.includes(panel.module)) return false;
    if (panel.needsExtensionKinds === true && options.hasExtensionKinds !== true) return false;
    return true;
  });
}

export function panelsInGroup(
  group: PanelGroupId,
  visible: readonly PanelDefinition[] = PANELS,
): readonly PanelDefinition[] {
  return visible.filter((panel) => panel.group === group);
}
