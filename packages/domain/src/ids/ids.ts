import type { Brand } from "@jellytind/shared";
import {
  ID_PREFIX,
  KIND_BY_PREFIX,
  isSequenceKind,
  type EntityKind,
  type SequenceKind,
} from "./entity-kind";

/**
 * Branded, mutually-incompatible entity identifiers.
 *
 * Each ID is a `string` at runtime but carries a distinct compile-time brand so
 * that, for example, a {@link CharacterId} cannot be passed where a
 * {@link SceneId} is expected. Names are presentation; IDs are identity, and IDs
 * never derive from names (AGENTS.md — "Stable Entity IDs").
 */
export type StoryProjectId = Brand<string, "StoryProjectId">;
export type ChapterId = Brand<string, "ChapterId">;
export type SceneId = Brand<string, "SceneId">;
export type CharacterId = Brand<string, "CharacterId">;
export type LocationId = Brand<string, "LocationId">;
export type PlotThreadId = Brand<string, "PlotThreadId">;
export type FactId = Brand<string, "FactId">;
export type ObjectId = Brand<string, "ObjectId">;
export type EventId = Brand<string, "EventId">;
export type WorldRuleId = Brand<string, "WorldRuleId">;
export type RelationshipId = Brand<string, "RelationshipId">;
export type SetupId = Brand<string, "SetupId">;

/**
 * Any identifier for an entity *within* a project. A project's own ID
 * ({@link StoryProjectId}) is deliberately excluded: it identifies the
 * container, not a member.
 */
export type EntityId =
  | ChapterId
  | SceneId
  | CharacterId
  | LocationId
  | PlotThreadId
  | FactId
  | ObjectId
  | EventId
  | WorldRuleId
  | RelationshipId
  | SetupId;

/** Any identifier this system mints, including the project container. */
export type AnyId = StoryProjectId | EntityId;

/** Maps an entity kind to its concrete branded ID type. */
export interface IdTypeByKind {
  project: StoryProjectId;
  chapter: ChapterId;
  scene: SceneId;
  character: CharacterId;
  location: LocationId;
  plot_thread: PlotThreadId;
  fact: FactId;
  object: ObjectId;
  event: EventId;
  world_rule: WorldRuleId;
  relationship: RelationshipId;
  setup: SetupId;
}

export type IdFor<K extends EntityKind> = IdTypeByKind[K];

/** Minimum zero-padding width for sequence numbers (e.g. `CHAR_0001`). */
export const ID_SEQUENCE_PAD = 4;

const SEQUENCE_ID_PATTERN = /^([A-Z]+)_(\d+)$/;

/** The underlying string value of a branded ID (identity at runtime). */
export function idValue(id: AnyId): string {
  return id as unknown as string;
}

/**
 * Format a sequence-based entity ID from a kind and a positive sequence number.
 * The number is zero-padded to at least {@link ID_SEQUENCE_PAD} digits and may
 * grow beyond it.
 */
export function formatEntityId<K extends SequenceKind>(kind: K, sequence: number): IdFor<K> {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`Sequence must be a positive integer, received: ${String(sequence)}`);
  }
  const padded = String(sequence).padStart(ID_SEQUENCE_PAD, "0");
  return `${ID_PREFIX[kind]}_${padded}` as IdFor<K>;
}

export interface ParsedId {
  readonly kind: EntityKind;
  readonly prefix: string;
  /** Sequence number for sequence-based kinds; `null` for project IDs. */
  readonly sequence: number | null;
  readonly raw: string;
}

/**
 * Parse and validate any raw ID string. Returns structured parts, or `null` if
 * the string is not a well-formed ID for a known kind.
 */
export function parseId(raw: string): ParsedId | null {
  const underscore = raw.indexOf("_");
  if (underscore <= 0 || underscore === raw.length - 1) return null;

  const prefix = raw.slice(0, underscore);
  const kind = KIND_BY_PREFIX[prefix];
  if (kind === undefined) return null;

  if (isSequenceKind(kind)) {
    const match = SEQUENCE_ID_PATTERN.exec(raw);
    if (match === null || match[1] !== prefix) return null;
    const sequence = Number.parseInt(match[2] as string, 10);
    if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
    return { kind, prefix, sequence, raw };
  }

  // Project IDs: `PROJ_<opaque>` where the suffix is any non-empty token.
  return { kind, prefix, sequence: null, raw };
}

/** The entity kind of a raw ID string, or `null` if it is not a valid ID. */
export function entityKindOf(raw: string): EntityKind | null {
  return parseId(raw)?.kind ?? null;
}

/** Type guard: is this string any well-formed entity ID (excludes project)? */
export function isEntityId(raw: string): raw is EntityId {
  const kind = entityKindOf(raw);
  return kind !== null && kind !== "project";
}

/** Type guard: is this string a well-formed project ID? */
export function isStoryProjectId(raw: string): raw is StoryProjectId {
  return entityKindOf(raw) === "project";
}

function makeKindGuard<K extends EntityKind>(kind: K) {
  return (raw: string): raw is IdFor<K> => entityKindOf(raw) === kind;
}

export const isChapterId = makeKindGuard("chapter");
export const isSceneId = makeKindGuard("scene");
export const isCharacterId = makeKindGuard("character");
export const isLocationId = makeKindGuard("location");
export const isPlotThreadId = makeKindGuard("plot_thread");
export const isFactId = makeKindGuard("fact");
export const isObjectId = makeKindGuard("object");
export const isEventId = makeKindGuard("event");
export const isWorldRuleId = makeKindGuard("world_rule");
export const isRelationshipId = makeKindGuard("relationship");
export const isSetupId = makeKindGuard("setup");

/**
 * Mint a project ID. The suffix is opaque and does not derive from the project
 * name. Defaults to a random UUID; an explicit token may be supplied (e.g. a
 * deterministic value in tests, or a migrated legacy ID).
 */
export function createStoryProjectId(token: string = crypto.randomUUID()): StoryProjectId {
  if (token.length === 0 || token.includes("_")) {
    throw new RangeError("Project ID token must be non-empty and contain no underscore.");
  }
  return `${ID_PREFIX.project}_${token}` as StoryProjectId;
}

/**
 * Assert that a raw string is a valid entity ID of the given kind, returning the
 * branded value. Throws on mismatch. Use at trust boundaries (e.g. after reading
 * from disk or model output).
 */
export function assertIdOfKind<K extends EntityKind>(kind: K, raw: string): IdFor<K> {
  if (entityKindOf(raw) !== kind) {
    throw new TypeError(`Expected a ${kind} ID, received: ${JSON.stringify(raw)}`);
  }
  return raw as IdFor<K>;
}

export type { EntityKind, SequenceKind };
