import type { CommandSpec } from "./types";

/**
 * The one place a command exists.
 *
 * The terminal parses against it, autocomplete reads it, `/help` renders it,
 * and the command palette lists it — so a command can never be typeable but
 * undocumented, or documented but unparseable. Skills and genre modules
 * register into the same registry (§12): a custom command is a command.
 */
export class CommandRegistry {
  private readonly byName = new Map<string, CommandSpec>();
  private readonly order: CommandSpec[] = [];

  register(spec: CommandSpec): void {
    validateSpec(spec);
    const names = [spec.id, ...spec.aliases].map((name) => name.toLowerCase());
    for (const name of names) {
      if (this.byName.has(name)) {
        throw new Error(`Command name "/${name}" is already registered.`);
      }
    }
    for (const name of names) this.byName.set(name, spec);
    this.order.push(spec);
  }

  /** Look a command up by id or alias, with or without the leading slash. */
  find(name: string): CommandSpec | null {
    return this.byName.get(name.replace(/^\//, "").toLowerCase()) ?? null;
  }

  /** Every command, in registration order. */
  list(): readonly CommandSpec[] {
    return this.order;
  }
}

/**
 * A spec that cannot be parsed unambiguously is rejected at registration,
 * where the developer is, rather than at the keyboard, where the writer is.
 */
function validateSpec(spec: CommandSpec): void {
  if (!/^[a-z][a-z0-9-]*$/.test(spec.id)) {
    throw new Error(`Command id "${spec.id}" must be lowercase words and hyphens.`);
  }
  for (const alias of spec.aliases) {
    if (!/^[a-z][a-z0-9-]*$/.test(alias)) {
      throw new Error(`Alias "${alias}" of /${spec.id} must be lowercase words and hyphens.`);
    }
  }
  let optionalSeen = false;
  spec.args.forEach((arg, index) => {
    if (arg.kind === "rest" && index !== spec.args.length - 1) {
      throw new Error(`/${spec.id}: a "rest" argument must be last.`);
    }
    if (arg.required && optionalSeen) {
      throw new Error(`/${spec.id}: required argument "${arg.name}" follows an optional one.`);
    }
    if (!arg.required) optionalSeen = true;
    if (arg.kind === "choice" && (arg.choices === undefined || arg.choices.length === 0)) {
      throw new Error(`/${spec.id}: choice argument "${arg.name}" needs choices.`);
    }
  });
}
