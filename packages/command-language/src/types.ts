/**
 * The vocabulary of Manu's command language.
 *
 * A command here is a *description* — what it is called, what it takes, what
 * it is allowed to do — kept apart from what it does. The desktop binds each
 * spec to a handler that drives a real workflow; this package never executes
 * anything, which is precisely what makes the language safe to parse, complete
 * and document in one place (docs/COMMAND_LANGUAGE.md).
 */

/**
 * What a command may reach.
 *
 * - `read`     — answers a question from project data; changes nothing.
 * - `open`     — opens a view or navigates; changes only what is on screen.
 * - `workflow` — launches a workflow UI that may involve models, where any
 *                change still lands through that workflow's own review gates.
 * - `stage`    — the command's workflow can change significant project state.
 *                It must land in an analyse → preview → stage → approve flow;
 *                the terminal never applies such a change itself.
 */
export type CommandPermission = "read" | "open" | "workflow" | "stage";

/** What kind of value an argument is, which drives validation and completion. */
export type ArgumentKind =
  /** An entity reference: a human name or a stable ID, resolved before use. */
  | "entity"
  /** A chapter reference: a number ("17"), a title, or a CHAPTER_ id. */
  | "chapter"
  /** One of a fixed set of words. */
  | "choice"
  /** A single bare word. */
  | "word"
  /**
   * Everything to the end of the line, verbatim. This is the natural-language
   * bridge: `/refactor Make Mara the primary detective` hands the sentence to
   * the refactor workflow as its instruction. At most one, and always last.
   */
  | "rest";

export interface ArgumentSpec {
  readonly name: string;
  readonly summary: string;
  readonly required: boolean;
  readonly kind: ArgumentKind;
  /** For `entity`: which kinds may satisfy it (empty = any). */
  readonly entityKinds?: readonly string[];
  /** For `choice`: the allowed words. */
  readonly choices?: readonly string[];
}

export interface OptionSpec {
  readonly name: string;
  readonly summary: string;
  /** `--name=value` when true; a bare `--name` flag when false. */
  readonly takesValue: boolean;
  readonly choices?: readonly string[];
  /**
   * Never write this option's value into command history. Nothing in the
   * standard set is sensitive, but the flag exists so a future command cannot
   * leak a value into localStorage by omission (§10).
   */
  readonly sensitive?: boolean;
}

export interface CommandSpec {
  /** The primary name, typed as `/id`. Lowercase, hyphens allowed. */
  readonly id: string;
  readonly aliases: readonly string[];
  /** Where the command belongs in help output. */
  readonly group: string;
  readonly summary: string;
  /** One line of usage, e.g. `/trace thread <name>`. */
  readonly usage: string;
  readonly args: readonly ArgumentSpec[];
  readonly options: readonly OptionSpec[];
  readonly permission: CommandPermission;
  /** May appear as a step in a command chain (§11). */
  readonly chainable: boolean;
  /** Who registered it: "core", a module id, or a skill id. */
  readonly source: string;
}

/** One token of a parsed line, with its position for completion. */
export interface Token {
  readonly text: string;
  readonly quoted: boolean;
  /** Index of the token's first character in the original line. */
  readonly start: number;
}

/** A command line, parsed and validated against its spec. */
export interface Invocation {
  readonly spec: CommandSpec;
  /** Argument values by spec name. A `rest` argument is the joined tail. */
  readonly args: Readonly<Record<string, string>>;
  /** Option values by name; `true` for bare flags. */
  readonly options: Readonly<Record<string, string | true>>;
}

export type ParseResult =
  | { readonly ok: true; readonly invocation: Invocation }
  | { readonly ok: false; readonly error: string; readonly usage?: string };

/** An entity the resolver may match a typed name against. */
export interface CatalogEntry {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
}

export type Resolution =
  | { readonly kind: "resolved"; readonly entry: CatalogEntry }
  | { readonly kind: "ambiguous"; readonly candidates: readonly CatalogEntry[] }
  | { readonly kind: "unknown"; readonly query: string };

/** A chapter the `chapter` argument kind may refer to. */
export interface ChapterRef {
  readonly id: string;
  readonly title?: string;
  /** 0-based manuscript order; a writer types it 1-based. */
  readonly order: number;
}

/** One autocomplete suggestion. */
export interface Suggestion {
  /** The text to insert. */
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
  /** Replace the line from this character index to the caret. */
  readonly from: number;
}
