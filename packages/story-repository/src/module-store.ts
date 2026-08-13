import { WRITER_DIR } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";

const PATH = `${WRITER_DIR}/modules.json`;

/**
 * Which genre modules this project has switched on.
 *
 * A small file, and deliberately so. It records **what the writer chose**, not
 * what the project contains: the material lives in `extensions/` and in the
 * subsystems the modules wire up, and none of it is conditional on this file.
 * A project whose modules record is deleted loses its interface configuration
 * and not one word of its book.
 *
 * `template` is the template the project was created from, kept for the record
 * only. It confers nothing — a project made from the Mystery template can
 * switch mystery off and fantasy on the same afternoon, which is the point of
 * templates being a starting configuration rather than a project type
 * (docs/GENRE_MODULES.md).
 */
export interface ModuleSettings {
  readonly enabled: readonly string[];
  readonly template?: string;
  /**
   * When a module was last switched off, and why the writer said. Kept because
   * a module going quiet is the kind of thing a writer later wonders about.
   */
  readonly disabled?: Readonly<Record<string, { at: string; reason?: string }>>;
}

const EMPTY: ModuleSettings = { enabled: [] };

export class ModuleStore {
  constructor(private readonly store: ProjectStore) {}

  async read(): Promise<ModuleSettings> {
    const raw = await this.store.readFile(PATH);
    if (raw === null) return EMPTY;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return EMPTY;
      const record = parsed as Partial<ModuleSettings>;
      return {
        enabled: Array.isArray(record.enabled) ? record.enabled.map(String) : [],
        ...(typeof record.template === "string" ? { template: record.template } : {}),
        ...(typeof record.disabled === "object" && record.disabled !== null
          ? { disabled: record.disabled }
          : {}),
      };
    } catch {
      // An unreadable settings file must not stop a project opening. The book
      // is not in here.
      return EMPTY;
    }
  }

  private async write(settings: ModuleSettings): Promise<ModuleSettings> {
    await this.store.createDirectory(WRITER_DIR);
    await this.store.writeFile(PATH, `${JSON.stringify(settings, null, 2)}\n`);
    return settings;
  }

  async enabled(): Promise<string[]> {
    return [...(await this.read()).enabled];
  }

  async isEnabled(moduleId: string): Promise<boolean> {
    return (await this.read()).enabled.includes(moduleId);
  }

  async enable(moduleId: string): Promise<ModuleSettings> {
    const settings = await this.read();
    if (settings.enabled.includes(moduleId)) return settings;
    // Switching a module back on restores everything it ever wrote, because
    // switching it off never took anything away.
    const { [moduleId]: _removed, ...remaining } = settings.disabled ?? {};
    return this.write({
      ...settings,
      enabled: [...settings.enabled, moduleId].sort(),
      ...(Object.keys(remaining).length === 0 ? {} : { disabled: remaining }),
    });
  }

  async disable(moduleId: string, options: { reason?: string; now?: string } = {}) {
    const settings = await this.read();
    return this.write({
      ...settings,
      enabled: settings.enabled.filter((id) => id !== moduleId),
      disabled: {
        ...settings.disabled,
        [moduleId]: {
          at: options.now ?? new Date().toISOString(),
          ...(options.reason === undefined ? {} : { reason: options.reason }),
        },
      },
    });
  }

  /** Apply a template's module set. Used once, when a project is created. */
  async applyTemplate(template: string, moduleIds: readonly string[]): Promise<ModuleSettings> {
    return this.write({ ...(await this.read()), template, enabled: [...moduleIds].sort() });
  }
}
