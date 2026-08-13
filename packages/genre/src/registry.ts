import type { ExtensionRecord } from "@jellytind/domain";
import { BUILT_IN_SKILLS } from "@jellytind/skills";
import type { StoryCompilerRule } from "@jellytind/story-compiler";
import { FANTASY_MODULE } from "./modules/fantasy";
import { MYSTERY_MODULE } from "./modules/mystery";
import { ROMANCE_MODULE } from "./modules/romance";
import { SCREENPLAY_MODULE } from "./modules/screenplay";
import { THRILLER_MODULE } from "./modules/thriller";
import {
  GenreError,
  type DisableImpact,
  type ExtensionKind,
  type GenreModule,
  type ModuleCommand,
  type ModuleId,
  type ModuleView,
} from "./types";
import { validateModule } from "./validate";

/**
 * The module registry.
 *
 * Closed, like the skill operations and the workflow conditions before it. A
 * module ships in the binary; there is no loading one from a project directory,
 * and that is a deliberate boundary rather than an unfinished feature. A module
 * contributes compiler rules — code that runs over every project on every build
 * — and code arriving from a downloaded file is a different product with a
 * different threat model (docs/GENRE_MODULES.md, docs/SECURITY_PRIVACY.md).
 */
export const MODULES: readonly GenreModule[] = [
  MYSTERY_MODULE,
  FANTASY_MODULE,
  ROMANCE_MODULE,
  THRILLER_MODULE,
  SCREENPLAY_MODULE,
];

// Every shipped module is checked as the registry is built, so a module that
// names a renamed skill fails at import rather than as a blank panel later.
{
  const seen = new Set<string>();
  for (const module of MODULES) {
    validateModule(module, seen);
    for (const kind of module.extensionKinds) seen.add(kind.id);
  }
}

const BY_ID = new Map(MODULES.map((module) => [module.id as string, module]));

export function moduleById(id: string): GenreModule {
  const found = BY_ID.get(id);
  if (found === undefined) {
    throw new GenreError("unknown_module", `No genre module called "${id}".`, {
      details: { module: id },
    });
  }
  return found;
}

export function hasModule(id: string): boolean {
  return BY_ID.has(id);
}

/** The modules that are on, in registry order, ignoring names we do not know. */
export function enabledModules(enabled: readonly string[]): readonly GenreModule[] {
  return MODULES.filter((module) => enabled.includes(module.id));
}

// ── The registration slots, resolved over what is enabled ───────────────────

export function extensionKindsFor(enabled: readonly string[]): readonly ExtensionKind[] {
  return enabledModules(enabled).flatMap((module) => module.extensionKinds);
}

export function extensionKindById(id: string): ExtensionKind {
  for (const module of MODULES) {
    const found = module.extensionKinds.find((kind) => kind.id === id);
    if (found !== undefined) return found;
  }
  throw new GenreError("unknown_kind", `No extension kind called "${id}".`, {
    details: { kind: id },
  });
}

export function rulesFor(enabled: readonly string[]): readonly StoryCompilerRule[] {
  return enabledModules(enabled).flatMap((module) => module.rules);
}

export function viewsFor(enabled: readonly string[]): readonly ModuleView[] {
  return enabledModules(enabled).flatMap((module) => module.views);
}

export function commandsFor(enabled: readonly string[]): readonly ModuleCommand[] {
  return enabledModules(enabled).flatMap((module) => module.commands);
}

/**
 * Which skills are offered.
 *
 * A skill that declares no module belongs to everybody — `/character-pass` is
 * as useful to a screenplay as to a mystery, and gating it would be a loss with
 * no gain. A skill that arrives *with* a module is offered only while that
 * module is on, which is what stops the palette becoming a list of every tool
 * Manu has ever shipped (docs/GENRE_MODULES.md).
 *
 * Ownership is read off the skill itself rather than off which module happens
 * to name it, so there is one answer and not two.
 */
export function skillIsAvailable(skillId: string, enabled: readonly string[]): boolean {
  const owner = BUILT_IN_SKILLS.find((skill) => skill.id === skillId)?.module;
  return owner === undefined || enabled.includes(owner);
}

/** Every skill a writer can reach right now, core ones included. */
export function skillsFor(enabled: readonly string[]): readonly string[] {
  return BUILT_IN_SKILLS.filter((skill) => skillIsAvailable(skill.id, enabled)).map(
    (skill) => skill.id,
  );
}

/** The module a panel belongs to, when one does. */
export function moduleOwningView(viewId: string): ModuleId | null {
  return MODULES.find((module) => module.views.some((view) => view.id === viewId))?.id ?? null;
}

// ── Switching one off ───────────────────────────────────────────────────────

/**
 * What switching a module off would cost, stated before it happens.
 *
 * `reversible` is `true` and not a computed field, because it is a promise
 * rather than an observation: nothing in this codebase deletes a record when a
 * module is disabled, and the test that proves it enables, writes, disables,
 * re-enables and finds everything where it was left. A writer who tries a
 * template and changes their mind has changed their workspace, not their book.
 */
export function disableImpact(
  moduleId: string,
  project: { records: readonly ExtensionRecord[]; adoptedTests?: number },
): DisableImpact {
  const module = moduleById(moduleId);
  return {
    moduleId,
    recordsHidden: project.records.filter((record) => record.moduleId === moduleId).length,
    viewsHidden: module.views.map((view) => view.label),
    rulesStopped: module.rules.map((rule) => rule.name),
    commandsWithdrawn: module.commands.map((command) => command.command),
    // An adopted test is the writer's own from the moment they adopt it, so it
    // keeps running. A module does not get to take back a promise somebody
    // else made about their book.
    testsKept: project.adoptedTests ?? 0,
    reversible: true,
  };
}
