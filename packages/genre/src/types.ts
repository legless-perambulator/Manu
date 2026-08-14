import { AppError } from "@jellytind/shared";
import type { EntityKind, ExtensionRecord, ExtensionValue, StoryTest } from "@jellytind/domain";
import type { StoryCompilerRule } from "@jellytind/story-compiler";

export type GenreErrorCode =
  "unknown_module" | "unknown_kind" | "invalid_module" | "invalid_record" | "unknown_template";

export class GenreError extends AppError {
  constructor(
    code: GenreErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(code, message, options);
  }
}

/**
 * The Genre Module Framework.
 *
 * Manu is one fiction development environment, not six applications sharing a
 * logo. A genre module **extends** the story domain — it never replaces it, and
 * it never gets its own copy. A mystery's scenes are scenes; a screenplay's
 * characters are characters; the timeline, the knowledge model, the causality
 * graph and the version history are the same ones underneath every genre
 * (docs/GENRE_MODULES.md).
 *
 * What a module may register is fixed and small, and splits into two halves
 * that matter:
 *
 * **Things a module provides** — extension kinds, compiler rules, story-test
 * templates, commands, project metadata, views. These are data and pure
 * functions. A module contributes them outright.
 *
 * **Things a module names** — agents, skills, context recipes. These already
 * exist under registries of their own, and a module makes them *available*
 * rather than inventing them. The reason is not tidiness: an agent is a
 * permission grant, and a module able to mint one could hand itself tools the
 * writer never approved (docs/SPECIALIST_AGENTS.md). A module names what it
 * needs and validation refuses a name that does not exist.
 */

export const MODULE_IDS = ["mystery", "fantasy", "romance", "thriller", "screenplay"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export function isModuleId(value: string): value is ModuleId {
  return (MODULE_IDS as readonly string[]).includes(value);
}

// ── Entity extensions ───────────────────────────────────────────────────────

/**
 * The value types a module field may take.
 *
 * Closed, and closed for a reason: every consumer that has never heard of the
 * module — search, the entity inspector, a context package, a build diagnostic
 * — must still be able to read the record.
 */
export const FIELD_TYPES = ["text", "long_text", "list", "choice", "entity"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface ExtensionField {
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  /** Required for `choice`: the only values the field accepts. */
  readonly choices?: readonly string[];
  /** Required for `entity`: which kind of thing the value must name. */
  readonly entityKind?: EntityKind;
  readonly required?: boolean;
  readonly description?: string;
}

/**
 * One kind of record a module adds — a culture, a threat, a scene heading.
 *
 * The schema is declared here and enforced on write, which is what stops a
 * module from becoming a bucket of arbitrary JSON that nothing downstream can
 * read.
 */
export interface ExtensionKind {
  readonly id: string;
  readonly moduleId: ModuleId;
  readonly label: string;
  readonly plural: string;
  readonly description: string;
  readonly fields: readonly ExtensionField[];
  /**
   * Core entity kinds a record may be attached to. Empty means it stands on
   * its own — a language belongs to the world, not to one location.
   */
  readonly attachesTo: readonly EntityKind[];
}

// ── The other registration slots ────────────────────────────────────────────

/** A panel the module contributes. Hidden entirely when the module is off. */
export interface ModuleView {
  readonly id: string;
  readonly label: string;
  /** What it answers, for the command palette. */
  readonly purpose: string;
  /** Where it belongs in the workspace's existing grouping. */
  readonly group: "project" | "story" | "verify" | "change";
}

/**
 * A story test a writer can adopt with one click.
 *
 * A **template**, not a test: it is added to the project as an ordinary
 * `StoryTest` the writer then owns and may edit or delete. A module does not
 * get to hold assertions over someone's book that they did not agree to.
 */
export interface TestTemplate {
  readonly id: string;
  readonly name: string;
  readonly rationale: string;
  readonly draft: Omit<StoryTest, "id" | "createdAt" | "updatedAt">;
}

/** A command the module puts on the palette, resolving to a skill or a view. */
export interface ModuleCommand {
  readonly command: string;
  readonly label: string;
  readonly description: string;
  /** The skill it runs, or the view it opens. Exactly one. */
  readonly runsSkill?: string;
  readonly opensView?: string;
}

/** A project-level field the module adds, e.g. a screenplay's format. */
export interface MetadataField {
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly choices?: readonly string[];
  readonly description?: string;
}

/**
 * How far a module actually goes.
 *
 * The audit's question, asked of every subsystem, applied to modules: is this a
 * working thing or a shape? A writer switching a module on is entitled to know
 * which, before they build a book on it — so it is a field the interface reads,
 * not a paragraph in a changelog (MANU-036).
 *
 * - `engine` — a dedicated engine behind it, not only records and rules. The
 *   Mystery module's fairness audit and deduction chains.
 * - `structured` — real extension records, deterministic compiler rules and
 *   views. Everything Manu already does, applied to this genre's material.
 *   Complete on its own terms, with no genre-specific engine.
 */
export const MODULE_MATURITIES = ["engine", "structured"] as const;
export type ModuleMaturity = (typeof MODULE_MATURITIES)[number];

export interface GenreModule {
  readonly id: ModuleId;
  readonly name: string;
  /** One line, in the writer's terms, about what switching this on gets them. */
  readonly summary: string;
  readonly description: string;
  /** How far it goes. Shown to the writer before they switch it on. */
  readonly maturity: ModuleMaturity;

  // Provided outright.
  readonly extensionKinds: readonly ExtensionKind[];
  readonly views: readonly ModuleView[];
  readonly rules: readonly StoryCompilerRule[];
  readonly testTemplates: readonly TestTemplate[];
  readonly commands: readonly ModuleCommand[];
  readonly metadata: readonly MetadataField[];

  // Named, and checked against the registries that own them.
  readonly agents: readonly string[];
  readonly skills: readonly string[];
  readonly recipes: readonly string[];

  /**
   * The module's own build input, gathered before the rules run.
   *
   * Optional, and only the Mystery module uses it: a module whose material is
   * ordinary extension records needs nothing here, because those are already
   * in `context.modules.extensions`.
   */
  collect?(reader: unknown): Promise<unknown>;
}

/** What switching a module off would cost, stated before it happens. */
export interface DisableImpact {
  readonly moduleId: string;
  /** Records that stop being shown. **None of them are deleted.** */
  readonly recordsHidden: number;
  readonly viewsHidden: readonly string[];
  readonly rulesStopped: readonly string[];
  readonly commandsWithdrawn: readonly string[];
  /**
   * Story tests the writer adopted from this module. They **keep running** —
   * an adopted test is the writer's, not the module's — and this says so.
   */
  readonly testsKept: number;
  readonly reversible: true;
}

export type { ExtensionRecord, ExtensionValue };
