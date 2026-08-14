import { ENTITY_KINDS, KIND_BY_PREFIX } from "@jellytind/domain";
import type { EntityKind, ExtensionValue } from "@jellytind/domain";
import { isSpecialistId } from "@jellytind/agent-runtime";
import { RECIPE_NAMES } from "@jellytind/context-compiler";
import { BUILT_IN_SKILLS } from "@jellytind/skills";
import { GenreError, MODULE_MATURITIES, type ExtensionKind, type GenreModule } from "./types";

/**
 * What a module may register, checked before it can register anything.
 *
 * Every module in this codebase is written by us and shipped in the binary, so
 * none of this guards against a hostile author. It guards against the ordinary
 * way an extension mechanism rots: a module names a skill that was renamed, or
 * declares a `choice` field with no choices, or claims an entity kind that does
 * not exist — and the failure surfaces as a blank panel in someone's project
 * three releases later. Validating at registration turns all of that into a
 * sentence at startup, and the registry's own test runs it over every shipped
 * module (docs/GENRE_MODULES.md).
 */
export function validateModule(module: GenreModule, seen: ReadonlySet<string> = new Set()): void {
  const fail = (message: string, details: Record<string, unknown> = {}): never => {
    throw new GenreError("invalid_module", `${module.id}: ${message}`, {
      details: { module: module.id, ...details },
    });
  };

  // ── What it claims about itself ──────────────────────────────────────────
  //
  // `engine` is a claim a module has to be able to back: a dedicated engine
  // means work beyond extension records and rules, and the only way that work
  // reaches a build is a `collect` hook. A module claiming an engine without
  // one is claiming more than it does (MANU-036).
  if (!(MODULE_MATURITIES as readonly string[]).includes(module.maturity)) {
    fail(`declares an unknown maturity "${module.maturity}".`);
  }
  if (module.maturity === "engine" && module.collect === undefined) {
    fail("claims a dedicated engine but contributes no build input of its own.");
  }

  // ── Things it names, checked against the registries that own them ─────────
  for (const agent of module.agents) {
    // An agent is a permission grant. A module that could mint one could grant
    // itself tools the writer never approved, so it may only name existing
    // specialists (docs/SPECIALIST_AGENTS.md).
    if (!isSpecialistId(agent)) fail(`names the agent "${agent}", which is not a specialist.`);
  }
  for (const skill of module.skills) {
    const found = BUILT_IN_SKILLS.find((entry) => entry.id === skill);
    if (found === undefined) fail(`names the skill "${skill}", which is not registered.`);
    // Both directions, so a module cannot claim a skill everybody has and
    // quietly gate it away from writers who never enabled that genre.
    else if (found.module !== module.id) {
      fail(
        found.module === undefined
          ? `names the skill "${skill}", which belongs to everybody. Only a skill that declares this module may be gated behind it.`
          : `names the skill "${skill}", which declares the module "${found.module}".`,
      );
    }
  }
  for (const skill of BUILT_IN_SKILLS) {
    if (skill.module === module.id && !module.skills.includes(skill.id)) {
      fail(`does not register "${skill.id}", which declares this module.`);
    }
  }
  for (const recipe of module.recipes) {
    if (!(RECIPE_NAMES as readonly string[]).includes(recipe)) {
      fail(`names the context recipe "${recipe}", which is not registered.`);
    }
  }

  // ── Things it provides ───────────────────────────────────────────────────
  const kindIds = new Set<string>();
  for (const kind of module.extensionKinds) {
    if (kind.moduleId !== module.id) {
      fail(`declares the extension kind "${kind.id}" as belonging to ${kind.moduleId}.`);
    }
    // Kind ids are unique across every module, because a record names its kind
    // and two modules claiming "faction" would make that name ambiguous.
    if (kindIds.has(kind.id) || seen.has(kind.id)) {
      fail(`declares the extension kind "${kind.id}" more than once.`, { kind: kind.id });
    }
    kindIds.add(kind.id);

    for (const target of kind.attachesTo) {
      if (!(ENTITY_KINDS as readonly string[]).includes(target)) {
        fail(`attaches "${kind.id}" to "${target}", which is not an entity kind.`);
      }
    }

    const fieldKeys = new Set<string>();
    for (const field of kind.fields) {
      if (fieldKeys.has(field.key)) {
        fail(`declares the field "${field.key}" twice on "${kind.id}".`);
      }
      fieldKeys.add(field.key);
      if (field.type === "choice" && (field.choices ?? []).length === 0) {
        fail(`gives "${kind.id}.${field.key}" a choice type and no choices.`);
      }
      if (field.type === "entity" && field.entityKind === undefined) {
        fail(`gives "${kind.id}.${field.key}" an entity type and no entity kind.`);
      }
    }
  }

  for (const command of module.commands) {
    const targets = [command.runsSkill, command.opensView].filter((value) => value !== undefined);
    if (targets.length !== 1) {
      fail(`command ${command.command} must run exactly one skill or open exactly one view.`);
    }
    if (command.runsSkill !== undefined && !module.skills.includes(command.runsSkill)) {
      fail(`command ${command.command} runs "${command.runsSkill}", which it does not register.`);
    }
    if (
      command.opensView !== undefined &&
      !module.views.some((view) => view.id === command.opensView)
    ) {
      fail(`command ${command.command} opens "${command.opensView}", which it does not register.`);
    }
  }

  for (const template of module.testTemplates) {
    // A module contributes a *rule* for anything it can decide, and a test
    // template only for what it cannot. A deterministic template would be the
    // compiler's job done twice, and the two would drift.
    if (template.draft.type !== "semantic") {
      fail(
        `test template "${template.id}" is deterministic. Anything the project can decide belongs in a rule, not a template.`,
      );
    }
  }

  for (const rule of module.rules) {
    // Rules must declare that they read extensions or the module's own data,
    // or an incremental build would skip them after the only change that
    // could possibly affect them.
    if (!rule.inputs.includes("extensions")) {
      fail(`rule "${rule.id}" does not declare that it reads extensions.`);
    }
  }
}

// ── Records ─────────────────────────────────────────────────────────────────

export interface RecordDraft {
  readonly name: string;
  readonly fields?: Readonly<Record<string, ExtensionValue>>;
  readonly attachedTo?: readonly string[];
}

/**
 * A record checked against the schema its kind declared.
 *
 * This is where "extends the domain, does not replace it" stops being a slogan.
 * A module may add records; it may not add arbitrary shapes. A field the kind
 * never declared is refused by name, and so is an attachment to the wrong kind
 * of thing — a culture attached to a scene is a mistake, not a feature.
 */
export function validateRecord(kind: ExtensionKind, draft: RecordDraft): void {
  const fail = (message: string): never => {
    throw new GenreError("invalid_record", message, { details: { kind: kind.id } });
  };

  if (draft.name.trim() === "") fail(`A ${kind.label.toLowerCase()} needs a name.`);

  const declared = new Map(kind.fields.map((field) => [field.key, field]));
  for (const key of Object.keys(draft.fields ?? {})) {
    if (!declared.has(key)) {
      fail(`"${kind.label}" has no field "${key}". Declared: ${[...declared.keys()].join(", ")}.`);
    }
  }

  for (const field of kind.fields) {
    const value = draft.fields?.[field.key];
    const empty =
      value === undefined || (typeof value === "string" ? value.trim() === "" : value.length === 0);

    if (field.required === true && empty) {
      fail(`"${kind.label}" needs ${field.label}.`);
    }
    if (empty) continue;

    if (field.type === "list") {
      if (typeof value === "string") fail(`${field.label} takes a list of values, not one value.`);
      continue;
    }
    if (typeof value !== "string") {
      fail(`${field.label} takes a single value, not a list.`);
      continue;
    }
    if (field.type === "choice" && !(field.choices ?? []).includes(value)) {
      fail(`${field.label} must be one of: ${(field.choices ?? []).join(", ")}. Got "${value}".`);
    }
    if (field.type === "entity" && kindOf(value) !== field.entityKind) {
      fail(`${field.label} must name a ${String(field.entityKind)}. Got "${value}".`);
    }
  }

  for (const id of draft.attachedTo ?? []) {
    const attachedKind = kindOf(id);
    if (attachedKind === undefined) fail(`"${id}" is not an entity ID.`);
    else if (!kind.attachesTo.includes(attachedKind)) {
      fail(
        kind.attachesTo.length === 0
          ? `A ${kind.label.toLowerCase()} does not attach to anything, and this one names ${id}.`
          : `A ${kind.label.toLowerCase()} attaches to ${kind.attachesTo.join(" or ")}, not to a ${attachedKind}.`,
      );
    }
  }
}

function kindOf(id: string): EntityKind | undefined {
  return KIND_BY_PREFIX[id.split("_")[0] ?? ""];
}
