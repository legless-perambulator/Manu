import type { ProjectStore } from "@jellytind/persistence";
import { PATHS } from "./paths";

/**
 * A derived catalog entry for a story entity. Held in
 * `.writer/index/entities.json` so the app can list entities without scanning
 * every file, and mirrored into SQLite when an index is attached. The entity's
 * authoritative content is its own file; this is a convenience index.
 */
export interface CatalogEntity {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly filePath?: string;
  readonly order?: number;
  readonly status?: string;
  readonly aliases?: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export async function readCatalog(store: ProjectStore): Promise<CatalogEntity[]> {
  const raw = await store.readFile(PATHS.entitiesCatalog);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as { entities?: unknown };
    return Array.isArray(parsed.entities) ? (parsed.entities as CatalogEntity[]) : [];
  } catch {
    return [];
  }
}

export async function writeCatalog(store: ProjectStore, entities: CatalogEntity[]): Promise<void> {
  await store.writeFile(PATHS.entitiesCatalog, `${JSON.stringify({ entities }, null, 2)}\n`);
}
