import type { ProjectStore } from "@jellytind/persistence";
import { ENTITY_DIRS, PATHS } from "./paths";
import { MarkdownEntityStore, JsonCollectionStore, type EntityStore, type HasId } from "./stores";
import {
  chapterCodec,
  characterCodec,
  locationCodec,
  objectCodec,
  normalizeScene,
  normalizePlotThread,
  normalizeFact,
  normalizeWorldRule,
  normalizeEvent,
  normalizeRelationship,
} from "./codecs";

/** Entity kinds that carry structured records (excludes the project container). */
export type GraphKind =
  | "chapter"
  | "scene"
  | "character"
  | "location"
  | "object"
  | "plot_thread"
  | "fact"
  | "world_rule"
  | "event"
  | "relationship";

/** Describes one reference-bearing field on an entity kind. */
interface RefField {
  readonly field: string;
  readonly target: GraphKind;
  readonly multi: boolean;
  /** If true, removing the reference invalidates the entity (delete it). */
  readonly required: boolean;
}

/** The outgoing reference fields for each kind. Kinds absent here have none. */
const REFERENCE_FIELDS: Partial<Record<GraphKind, readonly RefField[]>> = {
  location: [{ field: "parentLocationId", target: "location", multi: false, required: false }],
  scene: [
    { field: "chapterId", target: "chapter", multi: false, required: false },
    { field: "pov", target: "character", multi: false, required: false },
    { field: "locationId", target: "location", multi: false, required: false },
    { field: "characterIds", target: "character", multi: true, required: false },
    { field: "plotThreadIds", target: "plot_thread", multi: true, required: false },
    { field: "objectIds", target: "object", multi: true, required: false },
  ],
  plot_thread: [
    { field: "introducedSceneId", target: "scene", multi: false, required: false },
    { field: "resolvedSceneId", target: "scene", multi: false, required: false },
    { field: "relatedSceneIds", target: "scene", multi: true, required: false },
  ],
  event: [
    { field: "sceneId", target: "scene", multi: false, required: false },
    { field: "locationId", target: "location", multi: false, required: false },
    { field: "characterIds", target: "character", multi: true, required: false },
  ],
  relationship: [
    { field: "characterAId", target: "character", multi: false, required: true },
    { field: "characterBId", target: "character", multi: false, required: true },
  ],
};

export interface ReferenceEdge {
  /** The entity that holds the reference. */
  readonly fromKind: GraphKind;
  readonly fromId: string;
  readonly field: string;
  /** The referenced entity id. */
  readonly toId: string;
  readonly toKind: GraphKind;
}

export interface IntegrityReport {
  readonly ok: boolean;
  /** Edges whose target entity does not exist. */
  readonly dangling: readonly ReferenceEdge[];
}

/**
 * The fiction-domain graph: the set of authoritative per-kind entity stores plus
 * reference-aware operations (finding referrers, integrity checks, controlled
 * unlinking). Records are the file-backed source of truth; the SQLite/catalog
 * index is derived elsewhere.
 */
export class EntityGraph {
  private readonly stores: Record<GraphKind, EntityStore<HasId>>;

  constructor(store: ProjectStore) {
    this.stores = {
      chapter: new MarkdownEntityStore(store, ENTITY_DIRS.chapter, chapterCodec),
      character: new MarkdownEntityStore(store, ENTITY_DIRS.character, characterCodec),
      location: new MarkdownEntityStore(store, ENTITY_DIRS.location, locationCodec),
      object: new MarkdownEntityStore(store, ENTITY_DIRS.object, objectCodec),
      scene: new JsonCollectionStore(store, PATHS.scenes, normalizeScene),
      plot_thread: new JsonCollectionStore(store, PATHS.plotThreads, normalizePlotThread),
      fact: new JsonCollectionStore(store, PATHS.facts, normalizeFact),
      world_rule: new JsonCollectionStore(store, PATHS.worldRules, normalizeWorldRule),
      event: new JsonCollectionStore(store, PATHS.events, normalizeEvent),
      relationship: new JsonCollectionStore(store, PATHS.relationships, normalizeRelationship),
    };
  }

  store(kind: GraphKind): EntityStore<HasId> {
    return this.stores[kind];
  }

  static kinds(): GraphKind[] {
    return [
      "chapter",
      "scene",
      "character",
      "location",
      "object",
      "plot_thread",
      "fact",
      "world_rule",
      "event",
      "relationship",
    ];
  }

  /** All records across every kind, tagged with their kind. */
  async listAll(): Promise<Array<{ kind: GraphKind; entity: Record<string, unknown> }>> {
    const out: Array<{ kind: GraphKind; entity: Record<string, unknown> }> = [];
    for (const kind of EntityGraph.kinds()) {
      for (const entity of await this.stores[kind].list()) {
        out.push({ kind, entity: entity as unknown as Record<string, unknown> });
      }
    }
    return out;
  }

  /** All entity ids that currently exist, keyed for existence checks. */
  async existingIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const { entity } of await this.listAll()) ids.add(entity.id as string);
    return ids;
  }

  /** Find every edge in the project that points at `targetId`. */
  async findReferrers(targetId: string): Promise<ReferenceEdge[]> {
    const edges: ReferenceEdge[] = [];
    for (const { kind, entity } of await this.listAll()) {
      for (const edge of outgoingEdges(kind, entity)) {
        if (edge.toId === targetId) {
          edges.push({ fromKind: kind, fromId: entity.id as string, ...edge });
        }
      }
    }
    return edges;
  }

  /** Report references that point at entities which no longer exist. */
  async checkIntegrity(): Promise<IntegrityReport> {
    const existing = await this.existingIds();
    const dangling: ReferenceEdge[] = [];
    for (const { kind, entity } of await this.listAll()) {
      for (const edge of outgoingEdges(kind, entity)) {
        if (!existing.has(edge.toId)) {
          dangling.push({ fromKind: kind, fromId: entity.id as string, ...edge });
        }
      }
    }
    return { ok: dangling.length === 0, dangling };
  }

  /**
   * Remove all references to `targetId` from other entities, persisting the
   * changes. A referrer whose *required* field pointed at the target is deleted
   * (e.g. a relationship loses one of its two characters). Returns the ids of
   * entities that were modified or removed.
   */
  async unlinkReferences(targetId: string): Promise<string[]> {
    const touched: string[] = [];
    for (const { kind, entity } of await this.listAll()) {
      const fields = REFERENCE_FIELDS[kind] ?? [];
      let changed = false;
      let deleteEntity = false;
      const next: Record<string, unknown> = { ...entity };
      for (const rf of fields) {
        const value = next[rf.field];
        if (rf.multi) {
          if (Array.isArray(value) && value.includes(targetId)) {
            next[rf.field] = value.filter((v) => v !== targetId);
            changed = true;
          }
        } else if (value === targetId) {
          if (rf.required) {
            deleteEntity = true;
          } else {
            delete next[rf.field];
          }
          changed = true;
        }
      }
      if (!changed) continue;
      const id = entity.id as string;
      if (deleteEntity) {
        await this.stores[kind].remove(id);
      } else {
        await this.stores[kind].put(next as unknown as HasId);
      }
      touched.push(id);
    }
    return touched;
  }
}

/** Extract the outgoing reference edges (field + target) of one entity. */
export function outgoingEdges(
  kind: GraphKind,
  entity: Record<string, unknown>,
): Array<{ field: string; toId: string; toKind: GraphKind }> {
  const out: Array<{ field: string; toId: string; toKind: GraphKind }> = [];
  for (const rf of REFERENCE_FIELDS[kind] ?? []) {
    const value = entity[rf.field];
    if (rf.multi) {
      if (Array.isArray(value)) {
        for (const v of value) {
          if (typeof v === "string") out.push({ field: rf.field, toId: v, toKind: rf.target });
        }
      }
    } else if (typeof value === "string") {
      out.push({ field: rf.field, toId: value, toKind: rf.target });
    }
  }
  return out;
}

export { REFERENCE_FIELDS };
