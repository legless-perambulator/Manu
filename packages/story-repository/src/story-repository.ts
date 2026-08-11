import {
  SequentialIdGenerator,
  createStoryProjectId,
  entityKindOf,
  normalizeSequenceSnapshot,
  SCHEMA_VERSION,
  APP_FORMAT_VERSION,
  type ProjectManifest,
  type Project,
  type Chapter,
  type Scene,
  type Character,
  type Location,
  type StoryObject,
  type PlotThread,
  type Fact,
  type WorldRule,
  type StoryEvent,
  type Relationship,
  type ChapterStatus,
  type SceneStatus,
  type CharacterStatus,
  type ObjectStatus,
  type PlotThreadStatus,
  type FactStatus,
  type WorldRuleSeverity,
  type StoryProjectId,
  type ChapterId,
  type SceneId,
  type CharacterId,
  type LocationId,
  type ObjectId,
  type PlotThreadId,
} from "@jellytind/domain";
import { normalizeProjectPath, type ProjectStore, type ProjectIndex } from "@jellytind/persistence";
import type { SearchHit, SearchQuery } from "@jellytind/search";
import { RepositoryError } from "./errors";
import { ProjectSearch } from "./project-search";
import {
  scenesByCharacter,
  scenesByPov,
  scenesByLocation,
  scenesByObject,
  scenesByPlotThread,
  scenesBetweenChapters,
  characterAppearances,
} from "./queries";
import {
  PATHS,
  EXPLORER_ROOTS,
  chapterFilePath,
  characterFilePath,
  locationFilePath,
  objectFilePath,
} from "./paths";
import { scaffoldProject } from "./scaffold";
import { buildManifest, validateManifest } from "./manifest";
import { readCatalog, writeCatalog, type CatalogEntity } from "./catalog";
import {
  EntityGraph,
  outgoingEdges,
  type GraphKind,
  type ReferenceEdge,
  type IntegrityReport,
} from "./graph";
import type { HasId } from "./stores";

export interface CreateProjectOptions {
  readonly store: ProjectStore;
  readonly title: string;
  readonly rootPath?: string;
  readonly index?: ProjectIndex;
  readonly now?: () => string;
  readonly projectId?: StoryProjectId;
}

export interface OpenProjectOptions {
  readonly store: ProjectStore;
  readonly rootPath?: string;
  readonly index?: ProjectIndex;
  readonly now?: () => string;
}

export interface ProjectValidation {
  readonly ok: boolean;
  readonly manifest?: ProjectManifest;
  readonly errors: readonly string[];
  readonly code?: string;
}

/** How to handle a delete when other entities reference the target. */
export type DeleteMode = "prevent" | "unlink";

export interface DeleteResult {
  readonly deletedId: string;
  /** Entities that were modified/removed to remove references (unlink mode). */
  readonly unlinked: readonly string[];
}

const nowIso = (): string => new Date().toISOString();

/**
 * The Story Repository service: the authoritative gateway to a fiction project.
 * Beyond files and the manifest it owns the fiction-domain graph — structured,
 * first-class story entities linked by stable ID, with referential integrity.
 * See docs/STORY_REPOSITORY.md and docs/DOMAIN_MODEL.md.
 */
export class StoryRepository {
  private readonly graph: EntityGraph;
  private readonly search: ProjectSearch;

  private constructor(
    private readonly store: ProjectStore,
    private manifest: ProjectManifest,
    private readonly ids: SequentialIdGenerator,
    private readonly rootPath: string,
    private readonly index: ProjectIndex | undefined,
    private readonly clock: () => string,
  ) {
    this.graph = new EntityGraph(store);
    this.search = new ProjectSearch(store, this.graph);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  static async createProject(options: CreateProjectOptions): Promise<StoryRepository> {
    const { store } = options;
    const clock = options.now ?? nowIso;

    if (await store.exists(PATHS.manifest)) {
      throw new RepositoryError(
        "already_exists",
        "A project already exists at this location (.writer/project.json present).",
      );
    }

    const title = options.title.trim();
    if (title.length === 0) {
      throw new RepositoryError("invalid_manifest", "Project title must not be empty.");
    }

    const now = clock();
    const manifest = buildManifest({
      id: options.projectId ?? createStoryProjectId(),
      title,
      now,
    });

    await scaffoldProject(store, title);
    await store.writeFile(PATHS.manifest, serialize(manifest));

    if (options.index) {
      options.index.init();
      options.index.setMetadata("projectId", manifest.id);
      options.index.setMetadata("schemaVersion", String(manifest.schemaVersion));
    }

    return new StoryRepository(
      store,
      manifest,
      new SequentialIdGenerator(),
      options.rootPath ?? "",
      options.index,
      clock,
    );
  }

  static async openProject(options: OpenProjectOptions): Promise<StoryRepository> {
    const { store } = options;
    const validation = await StoryRepository.validateProject(store);
    if (!validation.ok || validation.manifest === undefined) {
      const message = validation.errors[0] ?? "Not a valid project.";
      throw new RepositoryError((validation.code as never) ?? "not_a_project", message);
    }

    const ids = await loadIdGenerator(store);
    if (options.index) options.index.init();

    return new StoryRepository(
      store,
      validation.manifest,
      ids,
      options.rootPath ?? "",
      options.index,
      options.now ?? nowIso,
    );
  }

  /** Validate that a store contains a well-formed project. Never throws. */
  static async validateProject(store: ProjectStore): Promise<ProjectValidation> {
    const raw = await store.readFile(PATHS.manifest);
    if (raw === null) {
      return {
        ok: false,
        errors: ["No project manifest found (.writer/project.json is missing)."],
        code: "not_a_project",
      };
    }
    const parsed = validateManifest(raw);
    if (!parsed.ok) {
      return { ok: false, errors: [parsed.error.message], code: parsed.error.code };
    }

    const missing: string[] = [];
    for (const dir of [...EXPLORER_ROOTS, ".writer"]) {
      if (!(await store.exists(dir))) missing.push(dir);
    }
    return {
      ok: true,
      manifest: parsed.value,
      errors: missing.map((d) => `Expected directory "${d}" is missing.`),
    };
  }

  // ── Metadata ─────────────────────────────────────────────────────────────

  get project(): Project {
    return {
      id: this.manifest.id,
      title: this.manifest.title,
      rootPath: this.rootPath,
      createdAt: this.manifest.createdAt,
      updatedAt: this.manifest.updatedAt,
      schemaVersion: this.manifest.schemaVersion,
    };
  }

  getManifest(): ProjectManifest {
    return this.manifest;
  }

  async saveProjectMetadata(patch: { title?: string }): Promise<ProjectManifest> {
    const title = patch.title?.trim();
    if (title !== undefined && title.length === 0) {
      throw new RepositoryError("invalid_manifest", "Project title must not be empty.");
    }
    this.manifest = {
      ...this.manifest,
      ...(title !== undefined ? { title } : {}),
      updatedAt: this.clock(),
    };
    await this.store.writeFile(PATHS.manifest, serialize(this.manifest));
    this.index?.setMetadata("title", this.manifest.title);
    return this.manifest;
  }

  // ── Safe file operations ─────────────────────────────────────────────────

  async listProjectFiles(prefix?: string): Promise<string[]> {
    return this.store.list(prefix === undefined ? undefined : normalizeProjectPath(prefix));
  }

  async readProjectFile(path: string): Promise<string | null> {
    return this.store.readFile(normalizeProjectPath(path));
  }

  async writeProjectFile(path: string, content: string): Promise<void> {
    const safePath = normalizeProjectPath(path);
    await this.store.writeFile(safePath, content);
    await this.search.onFileWritten(safePath);
    await this.touch();
  }

  async createDirectory(path: string): Promise<void> {
    return this.store.createDirectory(normalizeProjectPath(path));
  }

  async fileExists(path: string): Promise<boolean> {
    return this.store.exists(normalizeProjectPath(path));
  }

  // ── Entity creation ────────────────────────────────────────────────────────

  async addChapter(input: {
    title: string;
    order?: number;
    status?: ChapterStatus;
  }): Promise<Chapter> {
    const id = this.ids.next("chapter");
    const order = input.order ?? (await this.listChapters()).length;
    const chapter: Chapter = {
      id,
      title: input.title,
      order,
      filePath: chapterFilePath(id),
      status: input.status ?? "outline",
    };
    await this.persistEntity("chapter", chapter, chapter.title, chapter.filePath);
    return chapter;
  }

  async addScene(input: {
    title: string;
    chapterId?: ChapterId;
    pov?: CharacterId;
    locationId?: LocationId;
    characterIds?: readonly CharacterId[];
    plotThreadIds?: readonly PlotThreadId[];
    objectIds?: readonly ObjectId[];
    purpose?: readonly string[];
    status?: SceneStatus;
  }): Promise<Scene> {
    const id = this.ids.next("scene");
    const scene: Scene = {
      id,
      title: input.title,
      ...(input.chapterId !== undefined ? { chapterId: input.chapterId } : {}),
      ...(input.pov !== undefined ? { pov: input.pov } : {}),
      ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
      characterIds: input.characterIds ?? [],
      plotThreadIds: input.plotThreadIds ?? [],
      objectIds: input.objectIds ?? [],
      purpose: input.purpose ?? [],
      status: input.status ?? "planned",
    };
    await this.persistEntity("scene", scene, scene.title);
    return scene;
  }

  async addCharacter(input: {
    name: string;
    aliases?: readonly string[];
    description?: string;
    role?: string;
    notes?: string;
    status?: CharacterStatus;
  }): Promise<Character> {
    const id = this.ids.next("character");
    const character: Character = {
      id,
      name: input.name,
      aliases: input.aliases ?? [],
      description: input.description ?? "",
      role: input.role ?? "",
      notes: input.notes ?? "",
      status: input.status ?? "active",
      filePath: characterFilePath(id),
    };
    await this.persistEntity("character", character, character.name, character.filePath);
    return character;
  }

  async addLocation(input: {
    name: string;
    aliases?: readonly string[];
    description?: string;
    parentLocationId?: LocationId;
    notes?: string;
  }): Promise<Location> {
    const id = this.ids.next("location");
    const location: Location = {
      id,
      name: input.name,
      aliases: input.aliases ?? [],
      description: input.description ?? "",
      ...(input.parentLocationId !== undefined ? { parentLocationId: input.parentLocationId } : {}),
      notes: input.notes ?? "",
      filePath: locationFilePath(id),
    };
    await this.persistEntity("location", location, location.name, location.filePath);
    return location;
  }

  async addObject(input: {
    name: string;
    aliases?: readonly string[];
    description?: string;
    status?: ObjectStatus;
  }): Promise<StoryObject> {
    const id = this.ids.next("object");
    const object: StoryObject = {
      id,
      name: input.name,
      aliases: input.aliases ?? [],
      description: input.description ?? "",
      status: input.status ?? "intact",
      filePath: objectFilePath(id),
    };
    await this.persistEntity("object", object, object.name, object.filePath);
    return object;
  }

  async addPlotThread(input: {
    name: string;
    description?: string;
    status?: PlotThreadStatus;
    introducedSceneId?: SceneId;
    resolvedSceneId?: SceneId;
    relatedSceneIds?: readonly SceneId[];
  }): Promise<PlotThread> {
    const id = this.ids.next("plot_thread");
    const thread: PlotThread = {
      id,
      name: input.name,
      description: input.description ?? "",
      status: input.status ?? "planned",
      ...(input.introducedSceneId !== undefined
        ? { introducedSceneId: input.introducedSceneId }
        : {}),
      ...(input.resolvedSceneId !== undefined ? { resolvedSceneId: input.resolvedSceneId } : {}),
      relatedSceneIds: input.relatedSceneIds ?? [],
    };
    await this.persistEntity("plot_thread", thread, thread.name);
    return thread;
  }

  async addFact(input: {
    statement: string;
    status?: FactStatus;
    source?: string;
    notes?: string;
  }): Promise<Fact> {
    const id = this.ids.next("fact");
    const fact: Fact = {
      id,
      statement: input.statement,
      status: input.status ?? "canonical",
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };
    await this.persistEntity("fact", fact, fact.statement);
    return fact;
  }

  async addWorldRule(input: {
    name: string;
    description?: string;
    severity?: WorldRuleSeverity;
    scope?: string;
  }): Promise<WorldRule> {
    const id = this.ids.next("world_rule");
    const rule: WorldRule = {
      id,
      name: input.name,
      description: input.description ?? "",
      severity: input.severity ?? "soft",
      scope: input.scope ?? "global",
    };
    await this.persistEntity("world_rule", rule, rule.name);
    return rule;
  }

  async addEvent(input: {
    name: string;
    description?: string;
    storyTime?: string;
    sceneId?: SceneId;
    locationId?: LocationId;
    characterIds?: readonly CharacterId[];
  }): Promise<StoryEvent> {
    const id = this.ids.next("event");
    const event: StoryEvent = {
      id,
      name: input.name,
      description: input.description ?? "",
      ...(input.storyTime !== undefined ? { storyTime: input.storyTime } : {}),
      ...(input.sceneId !== undefined ? { sceneId: input.sceneId } : {}),
      ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
      characterIds: input.characterIds ?? [],
    };
    await this.persistEntity("event", event, event.name);
    return event;
  }

  async addRelationship(input: {
    characterAId: CharacterId;
    characterBId: CharacterId;
    type: string;
    description?: string;
  }): Promise<Relationship> {
    const id = this.ids.next("relationship");
    const rel: Relationship = {
      id,
      characterAId: input.characterAId,
      characterBId: input.characterBId,
      type: input.type,
      description: input.description ?? "",
    };
    await this.persistEntity("relationship", rel, rel.type);
    return rel;
  }

  // ── Entity reads ───────────────────────────────────────────────────────────

  listChapters = (): Promise<Chapter[]> => this.listOf<Chapter>("chapter");
  listScenes = (): Promise<Scene[]> => this.listOf<Scene>("scene");
  listCharacters = (): Promise<Character[]> => this.listOf<Character>("character");
  listLocations = (): Promise<Location[]> => this.listOf<Location>("location");
  listObjects = (): Promise<StoryObject[]> => this.listOf<StoryObject>("object");
  listPlotThreads = (): Promise<PlotThread[]> => this.listOf<PlotThread>("plot_thread");
  listFacts = (): Promise<Fact[]> => this.listOf<Fact>("fact");
  listWorldRules = (): Promise<WorldRule[]> => this.listOf<WorldRule>("world_rule");
  listEvents = (): Promise<StoryEvent[]> => this.listOf<StoryEvent>("event");
  listRelationships = (): Promise<Relationship[]> => this.listOf<Relationship>("relationship");

  private async listOf<T>(kind: GraphKind): Promise<T[]> {
    return (await this.graph.store(kind).list()) as unknown as T[];
  }

  /** Fetch any entity by id, inferring its kind from the id prefix. */
  async getEntity<T = Record<string, unknown>>(id: string): Promise<T | null> {
    const kind = kindOf(id);
    if (kind === null) return null;
    return (await this.graph.store(kind).get(id)) as unknown as T | null;
  }

  /** A flat listing of all entities (id, kind, display name) for browsing. */
  async listEntitySummaries(): Promise<Array<{ id: string; kind: GraphKind; name: string }>> {
    const rows = await this.graph.listAll();
    return rows.map(({ kind, entity }) => ({
      id: entity.id as string,
      kind,
      name: displayName(kind, entity),
    }));
  }

  // ── Search & retrieval ──────────────────────────────────────────────────────

  /** Project-wide lexical full-text search. Deterministic; no LLM. */
  searchText(query: SearchQuery): Promise<SearchHit[]> {
    return this.search.search(query);
  }

  /** Force a full rebuild of the search index (e.g. after bulk external edits). */
  rebuildSearchIndex(): Promise<void> {
    return this.search.rebuild();
  }

  // Structured graph queries — exact, deterministic answers with no LLM.

  async getScenesByCharacter(id: CharacterId): Promise<Scene[]> {
    return scenesByCharacter(await this.listScenes(), id);
  }
  async getScenesByPOV(id: CharacterId): Promise<Scene[]> {
    return scenesByPov(await this.listScenes(), id);
  }
  async getScenesByLocation(id: LocationId): Promise<Scene[]> {
    return scenesByLocation(await this.listScenes(), id);
  }
  async getScenesByPlotThread(id: PlotThreadId): Promise<Scene[]> {
    const [scenes, threads] = await Promise.all([this.listScenes(), this.listPlotThreads()]);
    const thread = threads.find((t) => t.id === id);
    const linked = thread
      ? [
          ...(thread.introducedSceneId ? [thread.introducedSceneId] : []),
          ...(thread.resolvedSceneId ? [thread.resolvedSceneId] : []),
          ...thread.relatedSceneIds,
        ]
      : [];
    return scenesByPlotThread(scenes, id, linked);
  }
  async getScenesBetweenChapters(start: ChapterId, end: ChapterId): Promise<Scene[]> {
    const [scenes, chapters] = await Promise.all([this.listScenes(), this.listChapters()]);
    return scenesBetweenChapters(scenes, chapters, start, end);
  }
  async getCharacterAppearances(
    id: CharacterId,
  ): Promise<{ scenes: Scene[]; events: StoryEvent[] }> {
    const [scenes, events] = await Promise.all([this.listScenes(), this.listEvents()]);
    return characterAppearances(scenes, events, id);
  }
  async getObjectAppearances(id: ObjectId): Promise<Scene[]> {
    return scenesByObject(await this.listScenes(), id);
  }
  async getPlotThreadAppearances(id: PlotThreadId): Promise<Scene[]> {
    return this.getScenesByPlotThread(id);
  }

  // ── Entity update / delete / integrity ──────────────────────────────────────

  /**
   * Merge `patch` into an existing entity (id and kind are immutable — renaming
   * never changes the ID). References in the patch are validated.
   */
  async updateEntity<T extends HasId>(id: string, patch: Partial<T>): Promise<T> {
    const kind = kindOf(id);
    if (kind === null) throw new RepositoryError("entity_not_found", `Unknown entity id: ${id}`);
    const store = this.graph.store(kind);
    const existing = await store.get(id);
    if (existing === null) {
      throw new RepositoryError("entity_not_found", `No ${kind} with id ${id}.`);
    }
    const next = { ...(existing as object), ...patch, id } as unknown as HasId;
    await this.persistEntity(
      kind,
      next,
      displayName(kind, next as unknown as Record<string, unknown>),
    );
    return next as unknown as T;
  }

  /** Every reference in the project that points at `id`. */
  findReferences(id: string): Promise<ReferenceEdge[]> {
    return this.graph.findReferrers(id);
  }

  /** Report references that point at non-existent entities. */
  checkIntegrity(): Promise<IntegrityReport> {
    return this.graph.checkIntegrity();
  }

  /**
   * Delete an entity safely. In `prevent` mode (default) a delete that would
   * orphan references throws with the dependency list; in `unlink` mode the
   * references are removed first. Never leaves dangling references.
   */
  async deleteEntity(id: string, options: { mode?: DeleteMode } = {}): Promise<DeleteResult> {
    const kind = kindOf(id);
    if (kind === null) throw new RepositoryError("entity_not_found", `Unknown entity id: ${id}`);
    const store = this.graph.store(kind);
    if ((await store.get(id)) === null) {
      throw new RepositoryError("entity_not_found", `No ${kind} with id ${id}.`);
    }

    const mode = options.mode ?? "prevent";
    const referrers = await this.graph.findReferrers(id);
    let unlinked: string[] = [];

    if (referrers.length > 0) {
      if (mode === "prevent") {
        throw new RepositoryError(
          "has_references",
          `${id} is referenced by ${referrers.length} entit${referrers.length === 1 ? "y" : "ies"} (${referrers
            .map((r) => r.fromId)
            .join(", ")}). Unlink them first or delete with mode "unlink".`,
          { details: { referrers } },
        );
      }
      unlinked = await this.graph.unlinkReferences(id);
      for (const otherId of unlinked) await this.reindexAfterUnlink(otherId);
    }

    await store.remove(id);
    await this.deindexEntity(id);
    this.search.onEntityRemoved(kind, id);
    await this.touch();
    return { deletedId: id, unlinked };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async persistEntity(
    kind: GraphKind,
    entity: HasId,
    name: string,
    filePath?: string,
  ): Promise<void> {
    await this.validateReferences(kind, entity);
    await this.graph.store(kind).put(entity);
    await this.recordEntity({
      id: entity.id,
      kind,
      name,
      ...(filePath !== undefined ? { filePath } : {}),
    });
    await this.search.onEntityChanged(kind, entity.id);
    await this.persistIdState();
    await this.touch();
  }

  /** Ensure every outgoing reference targets an existing entity (no dangling refs). */
  private async validateReferences(kind: GraphKind, entity: HasId): Promise<void> {
    const edges = outgoingEdges(kind, entity as unknown as Record<string, unknown>);
    if (edges.length === 0) return;
    const existing = await this.graph.existingIds();
    for (const edge of edges) {
      if (edge.toId === entity.id) {
        throw new RepositoryError("invalid_reference", `${entity.id} cannot reference itself.`);
      }
      if (!existing.has(edge.toId)) {
        throw new RepositoryError(
          "invalid_reference",
          `${entity.id}.${edge.field} references ${edge.toId}, which does not exist.`,
          { details: { edge } },
        );
      }
    }
  }

  private async recordEntity(
    entity: Omit<CatalogEntity, "createdAt" | "updatedAt"> & { createdAt?: string },
  ): Promise<void> {
    const now = this.clock();
    const catalog = await readCatalog(this.store);
    const prior = catalog.find((e) => e.id === entity.id);
    const record: CatalogEntity = {
      ...entity,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    };
    const next = [...catalog.filter((e) => e.id !== entity.id), record].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    await writeCatalog(this.store, next);

    this.index?.upsertEntity({
      id: record.id,
      kind: record.kind,
      name: record.name,
      ...(record.filePath !== undefined ? { filePath: record.filePath } : {}),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  private async reindexAfterUnlink(id: string): Promise<void> {
    const kind = kindOf(id);
    if (kind === null) return;
    const entity = await this.graph.store(kind).get(id);
    if (entity === null) {
      await this.deindexEntity(id);
      this.search.onEntityRemoved(kind, id);
      return;
    }
    await this.recordEntity({
      id,
      kind,
      name: displayName(kind, entity as unknown as Record<string, unknown>),
    });
    await this.search.onEntityChanged(kind, id);
  }

  private async deindexEntity(id: string): Promise<void> {
    const catalog = await readCatalog(this.store);
    await writeCatalog(
      this.store,
      catalog.filter((e) => e.id !== id),
    );
    this.index?.removeEntity(id);
  }

  private async persistIdState(): Promise<void> {
    await this.store.writeFile(
      PATHS.idSequences,
      `${JSON.stringify(this.ids.snapshot(), null, 2)}\n`,
    );
  }

  private async touch(): Promise<void> {
    this.manifest = { ...this.manifest, updatedAt: this.clock() };
    await this.store.writeFile(PATHS.manifest, serialize(this.manifest));
  }
}

function serialize(manifest: ProjectManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function kindOf(id: string): GraphKind | null {
  const kind = entityKindOf(id);
  if (kind === null || kind === "project") return null;
  return kind as GraphKind;
}

/** A human-friendly label for any entity record, per kind. */
function displayName(kind: GraphKind, entity: Record<string, unknown>): string {
  switch (kind) {
    case "chapter":
    case "scene":
      return String(entity.title ?? entity.id);
    case "fact":
      return String(entity.statement ?? entity.id);
    case "relationship":
      return String(entity.type ?? entity.id);
    default:
      return String(entity.name ?? entity.id);
  }
}

async function loadIdGenerator(store: ProjectStore): Promise<SequentialIdGenerator> {
  const raw = await store.readFile(PATHS.idSequences);
  if (raw !== null) {
    try {
      const snapshot = normalizeSequenceSnapshot(JSON.parse(raw));
      return new SequentialIdGenerator(snapshot);
    } catch {
      // fall through to reconstruction
    }
  }
  // Reconstruct from every existing entity id so new IDs never collide.
  const ids = [...(await new EntityGraph(store).existingIds())];
  return SequentialIdGenerator.fromExistingIds(ids);
}

export { SCHEMA_VERSION, APP_FORMAT_VERSION };
