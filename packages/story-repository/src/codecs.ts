import {
  isChapterId,
  isCharacterId,
  isLocationId,
  isObjectId,
  isSceneId,
  isPlotThreadId,
  isFactId,
  isWorldRuleId,
  isEventId,
  isRelationshipId,
  CHAPTER_STATUSES,
  SCENE_STATUSES,
  CHARACTER_STATUSES,
  OBJECT_STATUSES,
  PLOT_THREAD_STATUSES,
  FACT_STATUSES,
  WORLD_RULE_SEVERITIES,
  type Chapter,
  type Character,
  type Location,
  type StoryObject,
  type Scene,
  type PlotThread,
  type Fact,
  type WorldRule,
  type StoryEvent,
  type Relationship,
  type CharacterId,
  type LocationId,
  type SceneId,
  type PlotThreadId,
  type ObjectId,
  type ChapterId,
} from "@jellytind/domain";
import { chapterFilePath, characterFilePath, locationFilePath, objectFilePath } from "./paths";
import type { MarkdownCodec } from "./stores";

// ── Coercion helpers ─────────────────────────────────────────────────────────

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const optStr = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

const idArray = <T extends string>(v: unknown, guard: (s: string) => s is T): T[] =>
  Array.isArray(v) ? v.filter((x): x is T => typeof x === "string" && guard(x)) : [];

function optId<T extends string>(v: unknown, guard: (s: string) => s is T): T | undefined {
  return typeof v === "string" && guard(v) ? (v as T) : undefined;
}

// ── Markdown codecs (one file per entity) ────────────────────────────────────

export const chapterCodec: MarkdownCodec<Chapter> = {
  toData: (c) => ({ id: c.id, title: c.title, order: c.order, status: c.status }),
  toBody: (c) => `# ${c.title}\n`,
  fromData: (d) => {
    if (!isChapterId(str(d.id))) return null;
    const id = d.id as ChapterId;
    return {
      id,
      title: str(d.title),
      order: typeof d.order === "number" ? d.order : 0,
      status: oneOf(d.status, CHAPTER_STATUSES, "outline"),
      filePath: chapterFilePath(id),
    };
  },
};

export const characterCodec: MarkdownCodec<Character> = {
  toData: (c) => ({
    id: c.id,
    name: c.name,
    aliases: c.aliases,
    role: c.role,
    status: c.status,
    description: c.description,
    notes: c.notes,
  }),
  toBody: (c) => `# ${c.name}\n`,
  fromData: (d) => {
    if (!isCharacterId(str(d.id))) return null;
    const id = d.id as CharacterId;
    return {
      id,
      name: str(d.name),
      aliases: strArray(d.aliases),
      description: str(d.description),
      role: str(d.role),
      notes: str(d.notes),
      status: oneOf(d.status, CHARACTER_STATUSES, "active"),
      filePath: characterFilePath(id),
    };
  },
};

export const locationCodec: MarkdownCodec<Location> = {
  toData: (l) => ({
    id: l.id,
    name: l.name,
    aliases: l.aliases,
    parentLocationId: l.parentLocationId,
    description: l.description,
    notes: l.notes,
  }),
  toBody: (l) => `# ${l.name}\n`,
  fromData: (d) => {
    if (!isLocationId(str(d.id))) return null;
    const id = d.id as LocationId;
    const parent = optId(d.parentLocationId, isLocationId);
    return {
      id,
      name: str(d.name),
      aliases: strArray(d.aliases),
      description: str(d.description),
      ...(parent !== undefined ? { parentLocationId: parent } : {}),
      notes: str(d.notes),
      filePath: locationFilePath(id),
    };
  },
};

export const objectCodec: MarkdownCodec<StoryObject> = {
  toData: (o) => ({
    id: o.id,
    name: o.name,
    aliases: o.aliases,
    status: o.status,
    description: o.description,
  }),
  toBody: (o) => `# ${o.name}\n`,
  fromData: (d) => {
    if (!isObjectId(str(d.id))) return null;
    const id = d.id as ObjectId;
    return {
      id,
      name: str(d.name),
      aliases: strArray(d.aliases),
      description: str(d.description),
      status: oneOf(d.status, OBJECT_STATUSES, "intact"),
      filePath: objectFilePath(id),
    };
  },
};

// ── Collection normalizers ───────────────────────────────────────────────────

export function normalizeScene(raw: unknown): Scene | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (!isSceneId(str(d.id))) return null;
  return {
    id: d.id as SceneId,
    title: str(d.title),
    ...(optId(d.chapterId, isChapterId) !== undefined
      ? { chapterId: d.chapterId as ChapterId }
      : {}),
    ...(optId(d.pov, isCharacterId) !== undefined ? { pov: d.pov as CharacterId } : {}),
    ...(optId(d.locationId, isLocationId) !== undefined
      ? { locationId: d.locationId as LocationId }
      : {}),
    characterIds: idArray(d.characterIds, isCharacterId),
    plotThreadIds: idArray(d.plotThreadIds, isPlotThreadId),
    objectIds: idArray(d.objectIds, isObjectId),
    purpose: strArray(d.purpose),
    status: oneOf(d.status, SCENE_STATUSES, "planned"),
  };
}

export function normalizePlotThread(raw: unknown): PlotThread | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (!isPlotThreadId(str(d.id))) return null;
  return {
    id: d.id as PlotThreadId,
    name: str(d.name),
    description: str(d.description),
    status: oneOf(d.status, PLOT_THREAD_STATUSES, "planned"),
    ...(optId(d.introducedSceneId, isSceneId) !== undefined
      ? { introducedSceneId: d.introducedSceneId as SceneId }
      : {}),
    ...(optId(d.resolvedSceneId, isSceneId) !== undefined
      ? { resolvedSceneId: d.resolvedSceneId as SceneId }
      : {}),
    relatedSceneIds: idArray(d.relatedSceneIds, isSceneId),
  };
}

export function normalizeFact(raw: unknown): Fact | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (!isFactId(str(d.id))) return null;
  return {
    id: d.id as Fact["id"],
    statement: str(d.statement),
    status: oneOf(d.status, FACT_STATUSES, "canonical"),
    ...(optStr(d.source) !== undefined ? { source: optStr(d.source) } : {}),
    ...(optStr(d.notes) !== undefined ? { notes: optStr(d.notes) } : {}),
  };
}

export function normalizeWorldRule(raw: unknown): WorldRule | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (!isWorldRuleId(str(d.id))) return null;
  return {
    id: d.id as WorldRule["id"],
    name: str(d.name),
    description: str(d.description),
    severity: oneOf(d.severity, WORLD_RULE_SEVERITIES, "soft"),
    scope: str(d.scope, "global"),
  };
}

export function normalizeEvent(raw: unknown): StoryEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (!isEventId(str(d.id))) return null;
  return {
    id: d.id as StoryEvent["id"],
    name: str(d.name),
    description: str(d.description),
    ...(optStr(d.storyTime) !== undefined ? { storyTime: optStr(d.storyTime) } : {}),
    ...(optId(d.sceneId, isSceneId) !== undefined ? { sceneId: d.sceneId as SceneId } : {}),
    ...(optId(d.locationId, isLocationId) !== undefined
      ? { locationId: d.locationId as LocationId }
      : {}),
    characterIds: idArray(d.characterIds, isCharacterId),
  };
}

export function normalizeRelationship(raw: unknown): Relationship | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (!isRelationshipId(str(d.id))) return null;
  if (!isCharacterId(str(d.characterAId)) || !isCharacterId(str(d.characterBId))) return null;
  return {
    id: d.id as Relationship["id"],
    characterAId: d.characterAId as CharacterId,
    characterBId: d.characterBId as CharacterId,
    type: str(d.type),
    description: str(d.description),
  };
}
