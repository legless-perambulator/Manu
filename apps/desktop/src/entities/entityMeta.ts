import {
  CHAPTER_STATUSES,
  SCENE_STATUSES,
  CHARACTER_STATUSES,
  OBJECT_STATUSES,
  PLOT_THREAD_STATUSES,
  FACT_STATUSES,
  WORLD_RULE_SEVERITIES,
} from "@jellytind/domain";
import type { GraphKind } from "@jellytind/story-repository";

export type Kind = GraphKind;

export const KIND_LABEL: Record<Kind, string> = {
  chapter: "Chapters",
  scene: "Scenes",
  character: "Characters",
  location: "Locations",
  object: "Objects",
  plot_thread: "Plot Threads",
  fact: "Facts",
  world_rule: "World Rules",
  event: "Events",
  relationship: "Relationships",
};

/** Order the entity panel presents kinds in. */
export const KIND_ORDER: Kind[] = [
  "character",
  "location",
  "object",
  "scene",
  "plot_thread",
  "fact",
  "world_rule",
  "event",
  "relationship",
  "chapter",
];

/** Kinds a user can create directly with a single default field. */
export const CREATABLE: Kind[] = [
  "character",
  "location",
  "object",
  "scene",
  "plot_thread",
  "fact",
  "world_rule",
  "event",
];

export interface ScalarField {
  readonly key: string;
  readonly label: string;
  readonly multiline?: boolean;
}

export const SCALAR_FIELDS: Record<Kind, readonly ScalarField[]> = {
  chapter: [{ key: "title", label: "Title" }],
  scene: [{ key: "title", label: "Title" }],
  character: [
    { key: "name", label: "Name" },
    { key: "role", label: "Role" },
    { key: "description", label: "Description", multiline: true },
    { key: "notes", label: "Notes", multiline: true },
  ],
  location: [
    { key: "name", label: "Name" },
    { key: "description", label: "Description", multiline: true },
    { key: "notes", label: "Notes", multiline: true },
  ],
  object: [
    { key: "name", label: "Name" },
    { key: "description", label: "Description", multiline: true },
  ],
  plot_thread: [
    { key: "name", label: "Name" },
    { key: "description", label: "Description", multiline: true },
  ],
  fact: [
    { key: "statement", label: "Statement", multiline: true },
    { key: "source", label: "Source" },
    { key: "notes", label: "Notes", multiline: true },
  ],
  world_rule: [
    { key: "name", label: "Name" },
    { key: "description", label: "Description", multiline: true },
    { key: "scope", label: "Scope" },
  ],
  event: [
    { key: "name", label: "Name" },
    { key: "description", label: "Description", multiline: true },
    { key: "storyTime", label: "Story time" },
  ],
  relationship: [
    { key: "type", label: "Type" },
    { key: "description", label: "Description", multiline: true },
  ],
};

export interface SelectField {
  readonly key: string;
  readonly label: string;
  readonly options: readonly string[];
}

export const SELECT_FIELDS: Partial<Record<Kind, readonly SelectField[]>> = {
  chapter: [{ key: "status", label: "Status", options: CHAPTER_STATUSES }],
  scene: [{ key: "status", label: "Status", options: SCENE_STATUSES }],
  character: [{ key: "status", label: "Status", options: CHARACTER_STATUSES }],
  object: [{ key: "status", label: "Status", options: OBJECT_STATUSES }],
  plot_thread: [{ key: "status", label: "Status", options: PLOT_THREAD_STATUSES }],
  fact: [{ key: "status", label: "Status", options: FACT_STATUSES }],
  world_rule: [{ key: "severity", label: "Severity", options: WORLD_RULE_SEVERITIES }],
};

/** Kinds that carry an `aliases` string list. */
export const ALIAS_KINDS: ReadonlySet<Kind> = new Set(["character", "location", "object"]);
