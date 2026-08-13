/**
 * The workspace navigation model.
 *
 * Fifteen panels in one flat strip is a list of features, not a workspace. They
 * are grouped here by the question a writer is asking, and this one registry
 * feeds the sidebar, the command palette and the keyboard shortcuts — so a
 * panel can never appear in one and be missing from another.
 */

export const LEFT_PANELS = [
  "files",
  "entities",
  "search",
  "history",
  "versions",
  "voice",
  "state",
  "knowledge",
  "relations",
  "objects",
  "threads",
  "timeline",
  "build",
  "tests",
  "debug",
  "skills",
  "workflows",
  "causality",
  "refactor",
] as const;

export type LeftPanelId = (typeof LEFT_PANELS)[number];

export type PanelGroupId = "project" | "story" | "verify" | "change";

export interface PanelDefinition {
  readonly id: LeftPanelId;
  readonly group: PanelGroupId;
  readonly label: string;
  /** What the panel answers, shown in the command palette. */
  readonly purpose: string;
}

export interface PanelGroup {
  readonly id: PanelGroupId;
  readonly label: string;
  readonly purpose: string;
}

export const PANEL_GROUPS: readonly PanelGroup[] = [
  { id: "project", label: "Project", purpose: "The files, the records and what has changed" },
  { id: "story", label: "Story", purpose: "What is true, who knows it and when it happens" },
  { id: "verify", label: "Verify", purpose: "What the project can check for itself" },
  { id: "change", label: "Change", purpose: "What a change would reach, before making it" },
];

export const PANELS: readonly PanelDefinition[] = [
  { id: "files", group: "project", label: "Files", purpose: "Browse the manuscript and records" },
  {
    id: "entities",
    group: "project",
    label: "Entities",
    purpose: "Characters, locations, objects, threads and facts",
  },
  { id: "search", group: "project", label: "Search", purpose: "Find anything in the project" },
  {
    id: "history",
    group: "project",
    label: "History",
    purpose: "Every change, with diffs and checkpoints",
  },
  {
    id: "versions",
    group: "project",
    label: "Versions",
    purpose: "Alternative versions of the whole story",
  },
  {
    id: "voice",
    group: "project",
    label: "Voice",
    purpose: "What Manu thinks your style is, and your rules for it",
  },
  {
    id: "state",
    group: "story",
    label: "State",
    purpose: "Where everyone was, at any point in the book",
  },
  {
    id: "knowledge",
    group: "story",
    label: "Knowledge",
    purpose: "Who knows what, and how they learned it",
  },
  {
    id: "relations",
    group: "story",
    label: "Relations",
    purpose: "How the characters stand to each other over time",
  },
  {
    id: "objects",
    group: "story",
    label: "Objects",
    purpose: "Where things are and who is holding them",
  },
  {
    id: "threads",
    group: "story",
    label: "Threads",
    purpose: "Plot threads, setups and the payoffs they promise",
  },
  {
    id: "timeline",
    group: "story",
    label: "Timeline",
    purpose: "Story chronology against manuscript order",
  },
  {
    id: "build",
    group: "verify",
    label: "Build",
    purpose: "Run every deterministic check and read the problems",
  },
  {
    id: "tests",
    group: "verify",
    label: "Tests",
    purpose: "The assertions you wrote, re-asked on every build",
  },
  {
    id: "debug",
    group: "verify",
    label: "Debug",
    purpose: "Investigate why something is not landing",
  },
  {
    id: "skills",
    group: "verify",
    label: "Skills",
    purpose: "Repeatable passes over the book, step by step",
  },
  {
    id: "workflows",
    group: "verify",
    label: "Workflows",
    purpose: "Specialists working together, one approved step at a time",
  },
  {
    id: "causality",
    group: "change",
    label: "Causality",
    purpose: "What depends on what, and the blast radius",
  },
  {
    id: "refactor",
    group: "change",
    label: "Refactor",
    purpose: "Analyse, plan and validate a structural change",
  },
];

const BY_ID = new Map(PANELS.map((panel) => [panel.id, panel]));

export function panelById(id: LeftPanelId): PanelDefinition {
  const found = BY_ID.get(id);
  /* istanbul ignore next — LeftPanelId is closed over PANELS. */
  if (found === undefined) throw new Error(`Unknown panel: ${id}`);
  return found;
}

export function panelsInGroup(group: PanelGroupId): readonly PanelDefinition[] {
  return PANELS.filter((panel) => panel.group === group);
}

/** The panel each group opens on when it has not been visited yet. */
export function firstPanelOfGroup(group: PanelGroupId): LeftPanelId {
  const first = panelsInGroup(group)[0];
  /* istanbul ignore next — every group has at least one panel. */
  if (first === undefined) throw new Error(`Empty panel group: ${group}`);
  return first.id;
}
