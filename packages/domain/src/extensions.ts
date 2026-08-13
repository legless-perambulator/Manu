import type { EntityId, ExtensionId } from "./ids";

/**
 * How a genre module extends the story domain without replacing it.
 *
 * The temptation here is to give every genre its own entity types — a
 * `Culture`, a `Faction`, a `SceneHeading` — until the core is a union of every
 * genre Manu has ever supported and the ID space encodes which kinds of book
 * are permissible. This does the opposite. There is **one** extension entity,
 * and what makes a record a culture rather than a threat is a string in the
 * record, validated against a schema the module declares at registration
 * (docs/GENRE_MODULES.md).
 *
 * The consequence worth stating: the core knows that extensions exist, and
 * knows nothing whatever about fantasy. Adding a genre adds no entity kind, no
 * ID prefix and no branch in the core.
 */

/**
 * A field's value.
 *
 * Strings and lists of strings only. Not because richer values are
 * unimaginable, but because every consumer — the compiler, search, the entity
 * graph, the context renderer — must be able to read a record it has never
 * heard of. A closed value type is what makes that possible.
 */
export type ExtensionValue = string | readonly string[];

export interface ExtensionRecord {
  readonly id: ExtensionId;
  /** Which module owns it. Disabling that module hides it; nothing deletes it. */
  readonly moduleId: string;
  /** Which of the module's declared kinds this is: "culture", "threat". */
  readonly kind: string;
  readonly name: string;
  readonly summary?: string;
  /** Values keyed by the field keys the kind declares. Nothing else is allowed. */
  readonly fields: Readonly<Record<string, ExtensionValue>>;
  /**
   * Core entities this record is about — the location a culture occupies, the
   * relationship a beat belongs to. These are ordinary references and the
   * entity graph checks them like any other, so an extension cannot dangle.
   */
  readonly attachedTo: readonly EntityId[];
  readonly notes?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One value, rendered for a report or a context package. */
export function renderValue(value: ExtensionValue): string {
  return typeof value === "string" ? value : value.join(", ");
}

/**
 * A record as a line of prose.
 *
 * Used wherever a record must be shown by something that does not know the
 * module — the entity inspector, a context package, a build diagnostic. It
 * reads the schema off the record itself rather than needing the module loaded,
 * which is what lets a project opened without its modules still show its own
 * material rather than a row of IDs.
 */
export function describeExtension(record: ExtensionRecord): string {
  const parts = Object.entries(record.fields)
    .filter(([, value]) => renderValue(value) !== "")
    .map(([key, value]) => `${key.replace(/_/g, " ")}: ${renderValue(value)}`);
  return [
    `${record.name}${record.summary === undefined ? "" : ` — ${record.summary}`}`,
    ...parts,
  ].join("; ");
}
