import { formatEntityId } from "@jellytind/domain";
import type { EntityId, ExtensionId, ExtensionRecord, ExtensionValue } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";

const DIR = "extensions";
const pathFor = (moduleId: string) => `${DIR}/${moduleId}.json`;

/**
 * Genre module records, on disk.
 *
 * One file per module, in the project proper rather than under `.writer/`,
 * because a culture, a faction or a relationship beat is **authored material**.
 * It belongs in the writer's revision history and travels with the book.
 *
 * The store knows nothing about any genre. It persists records whose shape a
 * module declared and the framework validated before they arrived here — which
 * is what lets a project be opened by a build that has never heard of the
 * module and still show its material rather than lose it (docs/GENRE_MODULES.md).
 *
 * Nothing here deletes a record because a module was switched off. Disabling is
 * a change to what Manu *shows you*, never to what your project *contains*.
 */
export class ExtensionStore {
  constructor(private readonly store: ProjectStore) {}

  private async read(moduleId: string): Promise<ExtensionRecord[]> {
    const raw = await this.store.readFile(pathFor(moduleId));
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as ExtensionRecord[]) : [];
    } catch {
      return [];
    }
  }

  private async write(moduleId: string, records: readonly ExtensionRecord[]): Promise<void> {
    await this.store.createDirectory(DIR);
    await this.store.writeFile(pathFor(moduleId), `${JSON.stringify(records, null, 2)}\n`);
  }

  /** Which modules have written anything. Used to report what disabling costs. */
  async modulesWithRecords(): Promise<string[]> {
    const out: string[] = [];
    for (const moduleId of await this.moduleFiles()) {
      if ((await this.read(moduleId)).length > 0) out.push(moduleId);
    }
    return out.sort();
  }

  list(moduleId: string, kind?: string): Promise<ExtensionRecord[]> {
    return this.read(moduleId).then((all) =>
      kind === undefined ? all : all.filter((record) => record.kind === kind),
    );
  }

  /** Every record across a set of modules — what the enabled ones hold. */
  async listAll(moduleIds: readonly string[]): Promise<ExtensionRecord[]> {
    const out: ExtensionRecord[] = [];
    for (const moduleId of moduleIds) out.push(...(await this.read(moduleId)));
    return out;
  }

  async get(moduleId: string, id: string): Promise<ExtensionRecord | null> {
    return (await this.read(moduleId)).find((record) => (record.id as string) === id) ?? null;
  }

  /** Every record attached to one core entity, whatever module owns it. */
  async attachedTo(moduleIds: readonly string[], entityId: string): Promise<ExtensionRecord[]> {
    return (await this.listAll(moduleIds)).filter((record) =>
      record.attachedTo.map(String).includes(entityId),
    );
  }

  async add(input: {
    moduleId: string;
    kind: string;
    name: string;
    summary?: string;
    fields?: Readonly<Record<string, ExtensionValue>>;
    attachedTo?: readonly EntityId[];
    notes?: string;
    now?: string;
  }): Promise<ExtensionRecord> {
    const all = await this.read(input.moduleId);
    // IDs are unique across modules, so the sequence is taken over everything
    // already written rather than over this module's own file.
    const everywhere = await this.listAll(await this.moduleFiles());
    const at = new Date().toISOString();

    const record: ExtensionRecord = {
      id: nextId(everywhere) as ExtensionId,
      moduleId: input.moduleId,
      kind: input.kind,
      name: input.name,
      ...(input.summary === undefined ? {} : { summary: input.summary }),
      fields: input.fields ?? {},
      attachedTo: input.attachedTo ?? [],
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      createdAt: input.now ?? at,
      updatedAt: input.now ?? at,
    };
    await this.write(input.moduleId, [...all, record]);
    return record;
  }

  async update(
    moduleId: string,
    id: string,
    patch: Partial<Omit<ExtensionRecord, "id" | "moduleId" | "kind" | "createdAt">>,
    now?: string,
  ): Promise<ExtensionRecord | null> {
    const all = await this.read(moduleId);
    let updated: ExtensionRecord | null = null;
    const next = all.map((record) => {
      if ((record.id as string) !== id) return record;
      updated = {
        ...record,
        ...patch,
        id: record.id,
        moduleId: record.moduleId,
        kind: record.kind,
        createdAt: record.createdAt,
        updatedAt: now ?? new Date().toISOString(),
      };
      return updated;
    });
    if (updated !== null) await this.write(moduleId, next);
    return updated;
  }

  /** Deleting is the writer's decision, and only ever the writer's. */
  async remove(moduleId: string, id: string): Promise<void> {
    const all = await this.read(moduleId);
    await this.write(
      moduleId,
      all.filter((record) => (record.id as string) !== id),
    );
  }

  private async moduleFiles(): Promise<string[]> {
    return (await this.store.list(`${DIR}/`))
      .filter((path) => path.endsWith(".json"))
      .map((path) => path.slice(`${DIR}/`.length, -".json".length));
  }
}

function nextId(existing: readonly { id: unknown }[]): string {
  const highest = existing.reduce((max, record) => {
    const n = Number.parseInt(String(record.id).split("_")[1] ?? "", 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return formatEntityId("extension", highest + 1);
}
