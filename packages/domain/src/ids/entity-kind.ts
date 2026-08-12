/**
 * Entity kinds and their stable ID prefixes.
 *
 * Every meaningful story entity has a permanent internal ID whose prefix
 * encodes its kind (see MASTER_BUILD.md §3 and AGENTS.md — "Stable Entity IDs").
 * Prefixes and kinds are part of the on-disk contract and must not change
 * casually: existing repositories depend on them.
 */

/** All entity kinds that receive a stable ID. */
export const ENTITY_KINDS = [
  "project",
  "chapter",
  "scene",
  "character",
  "location",
  "plot_thread",
  "fact",
  "object",
  "event",
  "world_rule",
  "relationship",
  "setup",
  "test",
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

/**
 * Kinds whose IDs are allocated from a monotonic per-kind sequence
 * (e.g. `CHAR_0001`). A project is the container, not an entity within a
 * project, so its ID is minted differently (see `createStoryProjectId`).
 */
export type SequenceKind = Exclude<EntityKind, "project">;

/** ID prefix for each entity kind. Presentation-independent and stable. */
export const ID_PREFIX = {
  project: "PROJ",
  chapter: "CHAPTER",
  scene: "SCENE",
  character: "CHAR",
  location: "LOC",
  plot_thread: "THREAD",
  fact: "FACT",
  object: "OBJECT",
  event: "EVENT",
  world_rule: "RULE",
  relationship: "REL",
  setup: "SETUP",
  test: "TEST",
} as const satisfies Record<EntityKind, string>;

export type IdPrefix = (typeof ID_PREFIX)[EntityKind];

/** Reverse lookup: prefix string -> entity kind. */
export const KIND_BY_PREFIX: Readonly<Record<string, EntityKind>> = Object.freeze(
  Object.fromEntries(ENTITY_KINDS.map((kind) => [ID_PREFIX[kind], kind])),
);

export function isEntityKind(value: string): value is EntityKind {
  return (ENTITY_KINDS as readonly string[]).includes(value);
}

export function isSequenceKind(kind: EntityKind): kind is SequenceKind {
  return kind !== "project";
}
