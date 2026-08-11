import {
  isChapterId,
  type Scene,
  type PlotThread,
  type Fact,
  type WorldRule,
  type StoryEvent,
  type Relationship,
} from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";
import {
  LexicalIndex,
  type SearchDocument,
  type SearchHit,
  type SearchQuery,
  type SearchMeta,
  type ResultKind,
} from "@jellytind/search";
import type { EntityGraph, GraphKind } from "./graph";
import { chapterFilePath, characterFilePath, locationFilePath, objectFilePath } from "./paths";

const AREA_KINDS: Record<string, ResultKind> = {
  story: "story",
  world: "world",
  plot: "plot",
  style: "style",
  research: "research",
  notes: "notes",
};

const COLLECTION_KINDS: GraphKind[] = [
  "scene",
  "plot_thread",
  "fact",
  "world_rule",
  "event",
  "relationship",
];

/**
 * Project-wide lexical search. Builds documents from the repository's files
 * (manuscript prose, entity files, notes/research/style/world/plot/story) and
 * from collection entities, and keeps the index fresh with incremental updates
 * so a small change never forces a full reindex. Built lazily on first search;
 * always consistent with the authoritative files (docs/SEARCH.md).
 */
export class ProjectSearch {
  private readonly index = new LexicalIndex();
  private built = false;

  constructor(
    private readonly store: ProjectStore,
    private readonly graph: EntityGraph,
  ) {}

  async search(query: SearchQuery): Promise<SearchHit[]> {
    await this.ensureBuilt();
    return this.index.search(query);
  }

  async ensureBuilt(): Promise<void> {
    if (this.built) return;
    await this.rebuild();
  }

  /** Full rebuild from source. Cheap enough to run on open; not per keystroke. */
  async rebuild(): Promise<void> {
    this.index.clear();
    for (const doc of await this.buildDocuments()) this.index.upsert(doc);
    this.built = true;
  }

  // ── Incremental updates (no-ops until the index is first built) ─────────────

  async onFileWritten(path: string): Promise<void> {
    if (!this.built) return;
    await this.upsertFile(path);
  }

  async onEntityChanged(kind: GraphKind, id: string): Promise<void> {
    if (!this.built) return;
    const filePath = fileBackedPath(kind, id);
    if (filePath !== null) {
      await this.upsertFile(filePath);
    } else {
      const record = await this.graph.store(kind).get(id);
      if (record !== null) {
        this.index.upsert(collectionDoc(kind, record as unknown as Record<string, unknown>));
      }
    }
  }

  onEntityRemoved(kind: GraphKind, id: string): void {
    if (!this.built) return;
    const filePath = fileBackedPath(kind, id);
    this.index.remove(filePath !== null ? `file:${filePath}` : `${kind}:${id}`);
  }

  onFileRemoved(path: string): void {
    if (!this.built) return;
    this.index.remove(`file:${path}`);
  }

  // ── Building ────────────────────────────────────────────────────────────────

  private async upsertFile(path: string): Promise<void> {
    const meta = classifyFile(path);
    if (meta === null) return;
    const text = await this.store.readFile(path);
    if (text === null) {
      this.index.remove(`file:${path}`);
      return;
    }
    this.index.upsert({ id: `file:${path}`, text, meta: withTitle(meta, text, path) });
  }

  private async buildDocuments(): Promise<SearchDocument[]> {
    const docs: SearchDocument[] = [];

    for (const path of await this.store.list()) {
      const meta = classifyFile(path);
      if (meta === null) continue;
      const text = await this.store.readFile(path);
      if (text === null) continue;
      docs.push({ id: `file:${path}`, text, meta: withTitle(meta, text, path) });
    }

    for (const kind of COLLECTION_KINDS) {
      for (const record of await this.graph.store(kind).list()) {
        docs.push(collectionDoc(kind, record as unknown as Record<string, unknown>));
      }
    }
    return docs;
  }
}

// ── File classification ───────────────────────────────────────────────────────

type PartialMeta = Omit<SearchMeta, "title">;

function classifyFile(path: string): PartialMeta | null {
  if (path.startsWith(".writer/")) return null;
  if (!path.endsWith(".md") && !path.endsWith(".txt")) return null; // skips JSON collections

  const segments = path.split("/");
  const top = segments[0] ?? "";
  const stem = basename(path);

  if (top === "characters" && segments.length === 2) {
    return { kind: "character", entityId: stem, path };
  }
  if (path.startsWith("world/locations/") && segments.length === 3) {
    return { kind: "location", entityId: stem, path };
  }
  if (path.startsWith("world/objects/") && segments.length === 3) {
    return { kind: "object", entityId: stem, path };
  }
  if (top === "manuscript") {
    return { kind: "prose", path, ...(isChapterId(stem) ? { chapterId: stem } : {}) };
  }
  const area = AREA_KINDS[top];
  if (area !== undefined) return { kind: area, path };
  return null;
}

function collectionDoc(kind: GraphKind, record: Record<string, unknown>): SearchDocument {
  const id = String(record.id);
  const s = (v: unknown): string => (typeof v === "string" ? v : "");
  const arr = (v: unknown): string =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string").join(" ") : "";
  let text = "";
  let title = id;
  switch (kind) {
    case "scene":
      title = s(record.title) || id;
      text = `${title} ${arr((record as Partial<Scene>).purpose)}`;
      break;
    case "plot_thread":
      title = s((record as Partial<PlotThread>).name) || id;
      text = `${title} ${s((record as Partial<PlotThread>).description)}`;
      break;
    case "fact":
      title = s((record as Partial<Fact>).statement) || id;
      text = `${title} ${s((record as Partial<Fact>).notes)}`;
      break;
    case "world_rule":
      title = s((record as Partial<WorldRule>).name) || id;
      text = `${title} ${s((record as Partial<WorldRule>).description)} ${s((record as Partial<WorldRule>).scope)}`;
      break;
    case "event":
      title = s((record as Partial<StoryEvent>).name) || id;
      text = `${title} ${s((record as Partial<StoryEvent>).description)} ${s((record as Partial<StoryEvent>).storyTime)}`;
      break;
    case "relationship":
      title = s((record as Partial<Relationship>).type) || id;
      text = `${title} ${s((record as Partial<Relationship>).description)}`;
      break;
    default:
      text = title;
  }
  const meta: SearchMeta = {
    kind: kind as ResultKind,
    title,
    entityId: id,
    ...(kind === "scene" ? { sceneId: id } : {}),
    ...(kind === "scene" && typeof record.chapterId === "string"
      ? { chapterId: record.chapterId }
      : {}),
  };
  return { id: `${kind}:${id}`, text, meta };
}

function fileBackedPath(kind: GraphKind, id: string): string | null {
  switch (kind) {
    case "chapter":
      return chapterFilePath(id as never);
    case "character":
      return characterFilePath(id as never);
    case "location":
      return locationFilePath(id as never);
    case "object":
      return objectFilePath(id as never);
    default:
      return null;
  }
}

function withTitle(meta: PartialMeta, text: string, path: string): SearchMeta {
  const heading = /^#\s+(.+)$/m.exec(text);
  return { ...meta, title: heading?.[1]?.trim() ?? basename(path) };
}

function basename(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}
