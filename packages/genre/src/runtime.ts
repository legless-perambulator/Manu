import type { EntityId, ExtensionRecord, ExtensionValue, StoryTest } from "@jellytind/domain";
import type { ModuleRuntime, StoryRepository } from "@jellytind/story-repository";
import type { StoryCompilerRule } from "@jellytind/story-compiler";
import {
  disableImpact,
  enabledModules,
  extensionKindById,
  extensionKindsFor,
  moduleById,
  rulesFor,
} from "./registry";
import { templateById } from "./templates";
import { GenreError, type DisableImpact, type ExtensionKind, type TestTemplate } from "./types";
import { validateRecord } from "./validate";

/**
 * The framework, bound to one project.
 *
 * Everything that needs to know both *what a module is* and *what this project
 * contains* lives here, and nothing below it does. The repository holds the
 * enabled set and the records; the registry holds the modules; this is the one
 * place the two meet (docs/GENRE_MODULES.md).
 */
export class GenreRuntime implements ModuleRuntime {
  constructor(private readonly repo: StoryRepository) {}

  /** Attach the framework to a repository, and hand back the runtime. */
  static attach(repo: StoryRepository): GenreRuntime {
    const runtime = new GenreRuntime(repo);
    repo.useModules(runtime);
    return runtime;
  }

  // ── ModuleRuntime: what the repository asks of us ────────────────────────

  rulesFor(enabled: readonly string[]): readonly StoryCompilerRule[] {
    return rulesFor(enabled);
  }

  async collect(
    enabled: readonly string[],
    reader: unknown,
  ): Promise<Readonly<Record<string, unknown>>> {
    const out: Record<string, unknown> = {};
    for (const module of enabledModules(enabled)) {
      if (module.collect === undefined) continue;
      out[module.id] = await module.collect(reader);
    }
    return out;
  }

  // ── Enablement ───────────────────────────────────────────────────────────

  enabled(): Promise<string[]> {
    return this.repo.modules.enabled();
  }

  async enable(moduleId: string): Promise<void> {
    // Refuses an unknown id rather than storing it: a settings file full of
    // names nothing honours is how this kind of framework rots.
    moduleById(moduleId);
    await this.repo.modules.enable(moduleId);
  }

  /**
   * What switching a module off would cost, before switching it off.
   *
   * Always answerable, and always reversible. The interface shows this and then
   * asks; nothing here decides on the writer's behalf.
   */
  async impactOfDisabling(moduleId: string): Promise<DisableImpact> {
    const records = await this.repo.extensions.list(moduleId);
    const module = moduleById(moduleId);
    const adopted = (await this.repo.listStoryTests()).filter((test) =>
      module.testTemplates.some((entry) => entry.name === test.name),
    );
    return disableImpact(moduleId, { records, adoptedTests: adopted.length });
  }

  /**
   * Switch a module off.
   *
   * Deletes nothing. The records stay on disk, the adopted tests keep running,
   * and enabling it again brings the views and the rules straight back.
   */
  async disable(moduleId: string, reason?: string): Promise<DisableImpact> {
    const impact = await this.impactOfDisabling(moduleId);
    await this.repo.modules.disable(moduleId, ...(reason === undefined ? [] : [{ reason }]));
    return impact;
  }

  /** Apply a project template's module set. Used once, at creation. */
  async applyTemplate(templateId: string): Promise<void> {
    const template = templateById(templateId);
    await this.repo.modules.applyTemplate(template.id, template.modules);
  }

  // ── Extension records ────────────────────────────────────────────────────

  /** The kinds a writer can create right now, given what is switched on. */
  async availableKinds(): Promise<readonly ExtensionKind[]> {
    return extensionKindsFor(await this.enabled());
  }

  /**
   * Add a record.
   *
   * Validated against the kind's declared schema before anything is written, so
   * a module extends the domain and never escapes it: an undeclared field, a
   * choice outside its list, or an attachment to the wrong kind of entity is
   * refused by name (docs/GENRE_MODULES.md).
   */
  async addRecord(input: {
    kind: string;
    name: string;
    summary?: string;
    fields?: Readonly<Record<string, ExtensionValue>>;
    attachedTo?: readonly EntityId[];
    notes?: string;
  }): Promise<ExtensionRecord> {
    const kind = extensionKindById(input.kind);
    if (!(await this.repo.modules.isEnabled(kind.moduleId))) {
      throw new GenreError(
        "invalid_record",
        `The ${moduleById(kind.moduleId).name} module is switched off, so there is nowhere to put a ${kind.label.toLowerCase()}.`,
        { details: { module: kind.moduleId, kind: kind.id } },
      );
    }
    validateRecord(kind, {
      name: input.name,
      ...(input.fields === undefined ? {} : { fields: input.fields }),
      ...(input.attachedTo === undefined ? {} : { attachedTo: input.attachedTo.map(String) }),
    });

    // Attachments are ordinary references, so they are checked like any other.
    for (const id of input.attachedTo ?? []) {
      if ((await this.repo.getEntity(id as string)) === null) {
        throw new GenreError("invalid_record", `${String(id)} is not in this project.`, {
          details: { attachedTo: id },
        });
      }
    }

    return this.repo.extensions.add({ moduleId: kind.moduleId, ...input });
  }

  async updateRecord(
    id: string,
    patch: {
      name?: string;
      summary?: string;
      fields?: Readonly<Record<string, ExtensionValue>>;
      notes?: string;
    },
  ): Promise<ExtensionRecord | null> {
    const existing = await this.findRecord(id);
    if (existing === null) return null;
    const kind = extensionKindById(existing.kind);
    validateRecord(kind, {
      name: patch.name ?? existing.name,
      fields: patch.fields ?? existing.fields,
      attachedTo: existing.attachedTo.map(String),
    });
    return this.repo.extensions.update(existing.moduleId, id, patch);
  }

  /** Every record of one kind, whether or not its module is currently on. */
  async records(kindId: string): Promise<ExtensionRecord[]> {
    return this.repo.extensions.list(extensionKindById(kindId).moduleId, kindId);
  }

  /** Everything the enabled modules hold, for a panel that browses them. */
  async visibleRecords(): Promise<ExtensionRecord[]> {
    return this.repo.extensions.listAll(await this.enabled());
  }

  async findRecord(id: string): Promise<ExtensionRecord | null> {
    for (const module of (await this.repo.extensions.modulesWithRecords()).values()) {
      const found = await this.repo.extensions.get(module, id);
      if (found !== null) return found;
    }
    return null;
  }

  // ── Test templates ───────────────────────────────────────────────────────

  async offeredTests(): Promise<readonly TestTemplate[]> {
    return enabledModules(await this.enabled()).flatMap((module) => module.testTemplates);
  }

  /**
   * Adopt a module's test as the writer's own.
   *
   * From this moment it is an ordinary story test: it runs on every build,
   * survives the module being switched off, and can be edited or deleted like
   * anything else the writer wrote.
   */
  async adoptTest(templateId: string): Promise<StoryTest> {
    for (const module of await this.modulesOn()) {
      const template = module.testTemplates.find((entry) => entry.id === templateId);
      if (template !== undefined) return this.repo.addStoryTest({ ...template.draft });
    }
    throw new GenreError("unknown_module", `No test template called "${templateId}" is offered.`, {
      details: { template: templateId },
    });
  }

  private async modulesOn() {
    return enabledModules(await this.enabled());
  }
}
