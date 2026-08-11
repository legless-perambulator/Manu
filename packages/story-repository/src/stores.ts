import type { ProjectStore } from "@jellytind/persistence";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter";

/** Minimal shape every stored entity shares. */
export interface HasId {
  readonly id: string;
}

export interface EntityStore<T extends HasId> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  put(entity: T): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Codec between a typed entity and its Markdown-with-frontmatter file. */
export interface MarkdownCodec<T extends HasId> {
  /** Structured fields written to the YAML front-matter (authoritative). */
  toData(entity: T): Record<string, unknown>;
  /** Human-readable Markdown body (a rendering; not parsed back). */
  toBody(entity: T): string;
  /** Reconstruct the entity from front-matter data. Returns null if invalid. */
  fromData(data: Record<string, unknown>): T | null;
}

/**
 * One Markdown file per entity under `dir` (`dir/ID.md`), the file being the
 * human-readable authoritative record. Used for prose entities (characters,
 * locations, objects, chapters).
 */
export class MarkdownEntityStore<T extends HasId> implements EntityStore<T> {
  constructor(
    private readonly store: ProjectStore,
    private readonly dir: string,
    private readonly codec: MarkdownCodec<T>,
  ) {}

  private filePath(id: string): string {
    return `${this.dir}/${id}.md`;
  }

  async list(): Promise<T[]> {
    const files = await this.store.list(this.dir);
    const prefix = `${this.dir}/`;
    const out: T[] = [];
    for (const file of files) {
      if (!file.startsWith(prefix) || !file.endsWith(".md")) continue;
      if (file.slice(prefix.length).includes("/")) continue; // direct children only
      const raw = await this.store.readFile(file);
      if (raw === null) continue;
      const entity = this.codec.fromData(parseFrontmatter(raw).data);
      if (entity !== null) out.push(entity);
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<T | null> {
    const raw = await this.store.readFile(this.filePath(id));
    if (raw === null) return null;
    return this.codec.fromData(parseFrontmatter(raw).data);
  }

  async put(entity: T): Promise<void> {
    await this.store.writeFile(
      this.filePath(entity.id),
      serializeFrontmatter(this.codec.toData(entity), this.codec.toBody(entity)),
    );
  }

  async remove(id: string): Promise<void> {
    await this.store.delete(this.filePath(id));
  }
}

/**
 * A single JSON file holding `{ items: T[] }`. Used for data-oriented entities
 * (scenes, plot threads, facts, world rules, events, relationships).
 */
export class JsonCollectionStore<T extends HasId> implements EntityStore<T> {
  constructor(
    private readonly store: ProjectStore,
    private readonly path: string,
    /** Coerce/validate an untrusted item; return null to drop it. */
    private readonly normalize: (raw: unknown) => T | null,
  ) {}

  private async readAll(): Promise<T[]> {
    const raw = await this.store.readFile(this.path);
    if (raw === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    const items = (parsed as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];
    const out: T[] = [];
    for (const item of items) {
      const normalized = this.normalize(item);
      if (normalized !== null) out.push(normalized);
    }
    return out;
  }

  private async writeAll(items: T[]): Promise<void> {
    const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
    await this.store.writeFile(this.path, `${JSON.stringify({ items: sorted }, null, 2)}\n`);
  }

  async list(): Promise<T[]> {
    return (await this.readAll()).sort((a, b) => a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<T | null> {
    return (await this.readAll()).find((i) => i.id === id) ?? null;
  }

  async put(entity: T): Promise<void> {
    const items = (await this.readAll()).filter((i) => i.id !== entity.id);
    items.push(entity);
    await this.writeAll(items);
  }

  async remove(id: string): Promise<void> {
    const items = (await this.readAll()).filter((i) => i.id !== id);
    await this.writeAll(items);
  }
}
