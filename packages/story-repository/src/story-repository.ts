import {
  SequentialIdGenerator,
  createStoryProjectId,
  SCHEMA_VERSION,
  APP_FORMAT_VERSION,
  normalizeSequenceSnapshot,
  type ProjectManifest,
  type Project,
  type Chapter,
  type Character,
  type Location,
  type PlotThread,
  type ChapterStatus,
  type PlotThreadStatus,
  type StoryProjectId,
} from "@jellytind/domain";
import { normalizeProjectPath, type ProjectStore, type ProjectIndex } from "@jellytind/persistence";
import { RepositoryError } from "./errors";
import {
  PATHS,
  EXPLORER_ROOTS,
  chapterFilePath,
  characterFilePath,
  locationFilePath,
} from "./paths";
import { scaffoldProject } from "./scaffold";
import { buildManifest, validateManifest } from "./manifest";
import { readCatalog, writeCatalog, type CatalogEntity } from "./catalog";

export interface CreateProjectOptions {
  readonly store: ProjectStore;
  readonly title: string;
  /** Absolute path of the project root (informational; used to build `Project`). */
  readonly rootPath?: string;
  /** Optional SQLite-backed derived index to keep in sync. */
  readonly index?: ProjectIndex;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => string;
  /** Injectable project id (tests). */
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

const nowIso = (): string => new Date().toISOString();

/**
 * The Story Repository service: the authoritative gateway to a fiction project
 * on disk. All file access is project-relative and confined to the project root
 * (path traversal is rejected). Writes go through the store's atomic write. See
 * docs/STORY_REPOSITORY.md.
 */
export class StoryRepository {
  private constructor(
    private readonly store: ProjectStore,
    private manifest: ProjectManifest,
    private readonly ids: SequentialIdGenerator,
    private readonly rootPath: string,
    private readonly index: ProjectIndex | undefined,
    private readonly clock: () => string,
  ) {}

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

  // These are `async` so an unsafe-path rejection surfaces as a rejected promise
  // (path validation throws synchronously) rather than a thrown call.

  async listProjectFiles(prefix?: string): Promise<string[]> {
    return this.store.list(prefix === undefined ? undefined : normalizeProjectPath(prefix));
  }

  async readProjectFile(path: string): Promise<string | null> {
    return this.store.readFile(normalizeProjectPath(path));
  }

  async writeProjectFile(path: string, content: string): Promise<void> {
    await this.store.writeFile(normalizeProjectPath(path), content);
    await this.touch();
  }

  async createDirectory(path: string): Promise<void> {
    return this.store.createDirectory(normalizeProjectPath(path));
  }

  async fileExists(path: string): Promise<boolean> {
    return this.store.exists(normalizeProjectPath(path));
  }

  // ── Entities ─────────────────────────────────────────────────────────────

  async addChapter(input: {
    title: string;
    order?: number;
    status?: ChapterStatus;
  }): Promise<Chapter> {
    const id = this.ids.next("chapter");
    const existing = await this.listChapters();
    const order = input.order ?? existing.length;
    const chapter: Chapter = {
      id,
      title: input.title,
      order,
      filePath: chapterFilePath(id),
      status: input.status ?? "outline",
    };
    await this.store.writeFile(chapter.filePath, `# ${input.title}\n\n`);
    await this.recordEntity({
      id,
      kind: "chapter",
      name: input.title,
      filePath: chapter.filePath,
      order,
      status: chapter.status,
    });
    return chapter;
  }

  async addCharacter(input: { name: string; aliases?: readonly string[] }): Promise<Character> {
    const id = this.ids.next("character");
    const character: Character = {
      id,
      name: input.name,
      aliases: input.aliases ?? [],
      filePath: characterFilePath(id),
    };
    await this.store.writeFile(character.filePath, `# ${input.name}\n\n`);
    await this.recordEntity({
      id,
      kind: "character",
      name: input.name,
      filePath: character.filePath,
      aliases: character.aliases,
    });
    return character;
  }

  async addLocation(input: { name: string; aliases?: readonly string[] }): Promise<Location> {
    const id = this.ids.next("location");
    const location: Location = {
      id,
      name: input.name,
      aliases: input.aliases ?? [],
      filePath: locationFilePath(id),
    };
    await this.store.writeFile(location.filePath, `# ${input.name}\n\n`);
    await this.recordEntity({
      id,
      kind: "location",
      name: input.name,
      filePath: location.filePath,
      aliases: location.aliases,
    });
    return location;
  }

  async addPlotThread(input: { name: string; status?: PlotThreadStatus }): Promise<PlotThread> {
    const id = this.ids.next("plot_thread");
    const thread: PlotThread = { id, name: input.name, status: input.status ?? "planned" };
    // Plot threads are canonical in plot/plot_threads.json (human-readable).
    const threads = await this.listPlotThreads();
    await this.store.writeFile(
      PATHS.plotThreads,
      `${JSON.stringify({ threads: [...threads, thread] }, null, 2)}\n`,
    );
    await this.recordEntity({ id, kind: "plot_thread", name: input.name, status: thread.status });
    return thread;
  }

  async listChapters(): Promise<Chapter[]> {
    const rows = (await readCatalog(this.store)).filter((e) => e.kind === "chapter");
    return rows
      .map((e) => ({
        id: e.id as Chapter["id"],
        title: e.name,
        order: e.order ?? 0,
        filePath: e.filePath ?? chapterFilePath(e.id as Chapter["id"]),
        status: (e.status ?? "outline") as ChapterStatus,
      }))
      .sort((a, b) => a.order - b.order);
  }

  async listCharacters(): Promise<Character[]> {
    return (await readCatalog(this.store))
      .filter((e) => e.kind === "character")
      .map((e) => ({
        id: e.id as Character["id"],
        name: e.name,
        aliases: e.aliases ?? [],
        filePath: e.filePath ?? characterFilePath(e.id as Character["id"]),
      }));
  }

  async listLocations(): Promise<Location[]> {
    return (await readCatalog(this.store))
      .filter((e) => e.kind === "location")
      .map((e) => ({
        id: e.id as Location["id"],
        name: e.name,
        aliases: e.aliases ?? [],
        filePath: e.filePath ?? locationFilePath(e.id as Location["id"]),
      }));
  }

  async listPlotThreads(): Promise<PlotThread[]> {
    const raw = await this.store.readFile(PATHS.plotThreads);
    if (raw === null) return [];
    try {
      const parsed = JSON.parse(raw) as { threads?: PlotThread[] };
      return Array.isArray(parsed.threads) ? parsed.threads : [];
    } catch {
      return [];
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async recordEntity(
    entity: Omit<CatalogEntity, "createdAt" | "updatedAt">,
  ): Promise<void> {
    const now = this.clock();
    const catalog = await readCatalog(this.store);
    const record: CatalogEntity = { ...entity, createdAt: now, updatedAt: now };
    const next = [...catalog.filter((e) => e.id !== entity.id), record].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    await writeCatalog(this.store, next);

    this.index?.upsertEntity({
      id: record.id,
      kind: record.kind,
      name: record.name,
      ...(record.filePath !== undefined ? { filePath: record.filePath } : {}),
      data: {
        ...(record.order !== undefined ? { order: record.order } : {}),
        ...(record.status !== undefined ? { status: record.status } : {}),
        ...(record.aliases !== undefined ? { aliases: record.aliases } : {}),
      },
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });

    await this.persistIdState();
    await this.touch();
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
  // Reconstruct from any existing catalog IDs so new IDs never collide.
  const ids = (await readCatalog(store)).map((e) => e.id);
  return SequentialIdGenerator.fromExistingIds(ids);
}

// Re-export so the constant set is discoverable from the service module.
export { SCHEMA_VERSION, APP_FORMAT_VERSION };
