import type {
  BookDigest,
  CanonConflict,
  CanonEntity,
  CanonKind,
  SeriesArc,
  SeriesThread,
  UniverseBook,
  UniverseEvent,
  UniverseManifest,
  UniverseTest,
} from "./types";

/**
 * The shared world repository (§14).
 *
 * A universe is a folder with `.universe/` inside it — a manifest, the shared
 * canon, series threads and arcs, the cross-book timeline, digests and
 * conflicts — and the books as ordinary, fully portable Manu projects
 * alongside. Nothing in a book folder changes meaning when the universe
 * folder is absent: books stay self-contained; the universe layer holds
 * identity *links*, not copies.
 */

export interface UniverseStorePort {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  list(prefix: string): Promise<readonly string[]>;
}

/** Any ProjectStore (Node or Tauri) already speaks this port. */
export function universeStoreOver(store: {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}): UniverseStorePort {
  return {
    read: (path) => store.readFile(path),
    write: (path, content) => store.writeFile(path, content),
    list: (prefix) => store.list(prefix),
  };
}

export const UNIVERSE_PATHS = {
  manifest: ".universe/universe.json",
  canon: ".universe/canon",
  threads: ".universe/threads.json",
  arcs: ".universe/arcs.json",
  events: ".universe/timeline/events.json",
  digests: ".universe/memory",
  conflicts: ".universe/conflicts.json",
  tests: ".universe/tests.json",
} as const;

function nowIso(): string {
  return new Date().toISOString();
}

/** The universe, loaded and saved as plain files through the port. */
export class Universe {
  private constructor(
    private readonly store: UniverseStorePort,
    private manifest: UniverseManifest,
    private readonly clock: () => string,
  ) {}

  static async create(
    store: UniverseStorePort,
    input: { name: string; description?: string; now?: () => string },
  ): Promise<Universe> {
    if ((await store.read(UNIVERSE_PATHS.manifest)) !== null) {
      throw new Error("A universe already exists at this location.");
    }
    const clock = input.now ?? nowIso;
    const manifest: UniverseManifest = {
      id: `UNIVERSE_${Date.now().toString(36)}`,
      name: input.name.trim(),
      ...(input.description !== undefined ? { description: input.description } : {}),
      createdAt: clock(),
      updatedAt: clock(),
      books: [],
      series: [],
    };
    const universe = new Universe(store, manifest, clock);
    await universe.saveManifest();
    return universe;
  }

  static async open(
    store: UniverseStorePort,
    options: { now?: () => string } = {},
  ): Promise<Universe> {
    const raw = await store.read(UNIVERSE_PATHS.manifest);
    if (raw === null) {
      throw new Error("Not a universe (.universe/universe.json is missing).");
    }
    return new Universe(store, JSON.parse(raw) as UniverseManifest, options.now ?? nowIso);
  }

  get name(): string {
    return this.manifest.name;
  }

  getManifest(): UniverseManifest {
    return this.manifest;
  }

  private async saveManifest(): Promise<void> {
    this.manifest = { ...this.manifest, updatedAt: this.clock() };
    await this.store.write(UNIVERSE_PATHS.manifest, JSON.stringify(this.manifest, null, 2));
  }

  // ── Books and series ─────────────────────────────────────────────────────

  async addBook(input: {
    title: string;
    path: string;
    readingOrder?: number;
    storyOrder?: number;
    seriesId?: string;
    projectId?: string;
  }): Promise<UniverseBook> {
    const readingOrder =
      input.readingOrder ??
      this.manifest.books.reduce((max, book) => Math.max(max, book.readingOrder), 0) + 1;
    const book: UniverseBook = {
      bookId: `BOOK_${String(this.manifest.books.length + 1).padStart(4, "0")}`,
      title: input.title,
      path: input.path,
      readingOrder,
      ...(input.storyOrder !== undefined ? { storyOrder: input.storyOrder } : {}),
      ...(input.seriesId !== undefined ? { seriesId: input.seriesId } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    };
    this.manifest = { ...this.manifest, books: [...this.manifest.books, book] };
    await this.saveManifest();
    return book;
  }

  book(bookId: string): UniverseBook | null {
    return this.manifest.books.find((book) => book.bookId === bookId) ?? null;
  }

  booksInReadingOrder(): readonly UniverseBook[] {
    return [...this.manifest.books].sort((a, b) => a.readingOrder - b.readingOrder);
  }

  async addSeries(input: { name: string; description?: string }): Promise<void> {
    const series = {
      id: `SERIES_${String(this.manifest.series.length + 1).padStart(4, "0")}`,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      order: this.manifest.series.length + 1,
      bookIds: [],
    };
    this.manifest = { ...this.manifest, series: [...this.manifest.series, series] };
    await this.saveManifest();
  }

  // ── Shared canon ─────────────────────────────────────────────────────────

  private canonPath(id: string): string {
    return `${UNIVERSE_PATHS.canon}/${id}.json`;
  }

  async listCanon(kind?: CanonKind): Promise<CanonEntity[]> {
    const paths = await this.store.list(UNIVERSE_PATHS.canon);
    const out: CanonEntity[] = [];
    for (const path of paths.filter((held) => held.endsWith(".json")).sort()) {
      const raw = await this.store.read(path);
      if (raw === null) continue;
      const entity = JSON.parse(raw) as CanonEntity;
      if (kind === undefined || entity.kind === kind) out.push(entity);
    }
    return out;
  }

  async getCanon(id: string): Promise<CanonEntity | null> {
    const raw = await this.store.read(this.canonPath(id));
    return raw === null ? null : (JSON.parse(raw) as CanonEntity);
  }

  async addCanon(input: {
    kind: CanonKind;
    name: string;
    aliases?: readonly string[];
    description?: string;
    scope?: CanonEntity["scope"];
    statement?: string;
    birthYear?: number;
  }): Promise<CanonEntity> {
    const existing = await this.listCanon();
    const entity: CanonEntity = {
      id: `CANON_${String(existing.length + 1).padStart(4, "0")}`,
      kind: input.kind,
      name: input.name,
      aliases: input.aliases ?? [],
      description: input.description ?? "",
      scope: input.scope ?? { level: "universe" },
      ...(input.statement !== undefined ? { statement: input.statement } : {}),
      ...(input.birthYear !== undefined ? { birthYear: input.birthYear } : {}),
      bindings: [],
      createdAt: this.clock(),
      updatedAt: this.clock(),
    };
    await this.store.write(this.canonPath(entity.id), JSON.stringify(entity, null, 2));
    return entity;
  }

  async updateCanon(id: string, patch: Partial<CanonEntity>): Promise<CanonEntity> {
    const entity = await this.getCanon(id);
    if (entity === null) throw new Error(`No canon entity ${id}.`);
    const next: CanonEntity = { ...entity, ...patch, id: entity.id, updatedAt: this.clock() };
    await this.store.write(this.canonPath(id), JSON.stringify(next, null, 2));
    return next;
  }

  /**
   * Bind a canon entity to its manifestation in one book (§7). One binding
   * per book: rebinding replaces it, and never touches any other book's.
   */
  async bindCanon(
    id: string,
    binding: { bookId: string; localId: string; presentation?: string },
  ): Promise<CanonEntity> {
    const entity = await this.getCanon(id);
    if (entity === null) throw new Error(`No canon entity ${id}.`);
    const bindings = [
      ...entity.bindings.filter((held) => held.bookId !== binding.bookId),
      {
        bookId: binding.bookId,
        localId: binding.localId,
        ...(binding.presentation !== undefined ? { presentation: binding.presentation } : {}),
      },
    ];
    return this.updateCanon(id, { bindings });
  }

  /** localId → canon entity, for one book. The reconciliation lookup. */
  async bindingsForBook(bookId: string): Promise<Map<string, CanonEntity>> {
    const out = new Map<string, CanonEntity>();
    for (const entity of await this.listCanon()) {
      const binding = entity.bindings.find((held) => held.bookId === bookId);
      if (binding !== undefined) out.set(binding.localId, entity);
    }
    return out;
  }

  // ── Timeline events, threads, arcs ───────────────────────────────────────

  private async readList<T>(path: string): Promise<T[]> {
    const raw = await this.store.read(path);
    return raw === null ? [] : (JSON.parse(raw) as T[]);
  }

  private async writeList<T>(path: string, list: readonly T[]): Promise<void> {
    await this.store.write(path, JSON.stringify(list, null, 2));
  }

  listEvents(): Promise<UniverseEvent[]> {
    return this.readList<UniverseEvent>(UNIVERSE_PATHS.events);
  }

  async addEvent(input: Omit<UniverseEvent, "id">): Promise<UniverseEvent> {
    const events = await this.listEvents();
    const event: UniverseEvent = {
      id: `UEVENT_${String(events.length + 1).padStart(4, "0")}`,
      ...input,
    };
    await this.writeList(UNIVERSE_PATHS.events, [...events, event]);
    return event;
  }

  listThreads(): Promise<SeriesThread[]> {
    return this.readList<SeriesThread>(UNIVERSE_PATHS.threads);
  }

  async saveThread(thread: Omit<SeriesThread, "id"> & { id?: string }): Promise<SeriesThread> {
    const threads = await this.listThreads();
    const held: SeriesThread = {
      ...thread,
      id: thread.id ?? `STHREAD_${String(threads.length + 1).padStart(4, "0")}`,
    };
    await this.writeList(UNIVERSE_PATHS.threads, [
      ...threads.filter((existing) => existing.id !== held.id),
      held,
    ]);
    return held;
  }

  listArcs(): Promise<SeriesArc[]> {
    return this.readList<SeriesArc>(UNIVERSE_PATHS.arcs);
  }

  async saveArc(arc: Omit<SeriesArc, "id"> & { id?: string }): Promise<SeriesArc> {
    const arcs = await this.listArcs();
    const held: SeriesArc = {
      ...arc,
      id: arc.id ?? `SARC_${String(arcs.length + 1).padStart(4, "0")}`,
    };
    await this.writeList(UNIVERSE_PATHS.arcs, [
      ...arcs.filter((existing) => existing.id !== held.id),
      held,
    ]);
    return held;
  }

  // ── Digests, conflicts, tests ────────────────────────────────────────────

  async saveDigest(digest: BookDigest): Promise<void> {
    await this.store.write(
      `${UNIVERSE_PATHS.digests}/${digest.bookId}.json`,
      JSON.stringify(digest, null, 2),
    );
  }

  async getDigest(bookId: string): Promise<BookDigest | null> {
    const raw = await this.store.read(`${UNIVERSE_PATHS.digests}/${bookId}.json`);
    return raw === null ? null : (JSON.parse(raw) as BookDigest);
  }

  listConflicts(): Promise<CanonConflict[]> {
    return this.readList<CanonConflict>(UNIVERSE_PATHS.conflicts);
  }

  async saveConflicts(conflicts: readonly CanonConflict[]): Promise<void> {
    await this.writeList(UNIVERSE_PATHS.conflicts, conflicts);
  }

  listTests(): Promise<UniverseTest[]> {
    return this.readList<UniverseTest>(UNIVERSE_PATHS.tests);
  }

  async addTest(input: Omit<UniverseTest, "id">): Promise<UniverseTest> {
    const tests = await this.listTests();
    const test: UniverseTest = {
      id: `UTEST_${String(tests.length + 1).padStart(4, "0")}`,
      ...input,
    };
    await this.writeList(UNIVERSE_PATHS.tests, [...tests, test]);
    return test;
  }
}
