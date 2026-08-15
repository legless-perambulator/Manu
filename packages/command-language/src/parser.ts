import type { CommandRegistry } from "./registry";
import type { ParseResult, Token } from "./types";

/**
 * A purpose-built parser, and nothing but (§16).
 *
 * There is no shell underneath this. `;`, `|`, `$`, backticks and every other
 * character a shell would interpret are ordinary text here: `/find $(rm -rf)`
 * searches the manuscript for the string `$(rm -rf)`. The only syntax is the
 * command word, whitespace, double quotes for phrases, and `--option[=value]`.
 */

/** Split a line into tokens: whitespace-separated, double quotes group. */
export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < line.length) {
    while (index < line.length && /\s/.test(line[index] as string)) index += 1;
    if (index >= line.length) break;
    const start = index;
    if (line[index] === '"') {
      index += 1;
      let text = "";
      while (index < line.length && line[index] !== '"') {
        text += line[index];
        index += 1;
      }
      index += 1; // Past the closing quote, or the end of an unclosed one.
      tokens.push({ text, quoted: true, start });
    } else {
      let text = "";
      while (index < line.length && !/\s/.test(line[index] as string)) {
        text += line[index];
        index += 1;
      }
      tokens.push({ text, quoted: false, start });
    }
  }
  return tokens;
}

/**
 * Parse one command line against the registry.
 *
 * Validation is part of parsing: an unknown command, a missing required
 * argument, a value outside a choice list or an unknown option all fail here
 * with the command's usage line, before any handler runs.
 */
export function parseCommandLine(line: string, registry: CommandRegistry): ParseResult {
  const tokens = tokenize(line);
  const head = tokens[0];
  if (head === undefined || head.text === "" || head.text === "/") {
    return { ok: false, error: "Type a command, e.g. /help." };
  }
  if (!head.text.startsWith("/") || head.quoted) {
    return { ok: false, error: `Commands start with a slash — try /${head.text}.` };
  }
  const spec = registry.find(head.text);
  if (spec === null) {
    return { ok: false, error: `"${head.text}" is not a command Manu has. /help lists them.` };
  }

  // Separate options from positional tokens. Options may appear anywhere
  // before a `rest` argument begins consuming the line.
  const options: Record<string, string | true> = {};
  const positional: Token[] = [];
  const restIndex = spec.args.findIndex((arg) => arg.kind === "rest");
  const positionalBeforeRest = restIndex === -1 ? spec.args.length : restIndex;
  for (const token of tokens.slice(1)) {
    const isOption =
      !token.quoted && token.text.startsWith("--") && positional.length <= positionalBeforeRest;
    if (isOption) {
      const body = token.text.slice(2);
      const eq = body.indexOf("=");
      const name = (eq === -1 ? body : body.slice(0, eq)).toLowerCase();
      const optionSpec = spec.options.find((held) => held.name === name);
      if (optionSpec === undefined) {
        return { ok: false, error: `/${spec.id} has no --${name} option.`, usage: spec.usage };
      }
      if (optionSpec.takesValue) {
        if (eq === -1) {
          return { ok: false, error: `--${name} needs a value: --${name}=…`, usage: spec.usage };
        }
        const value = body.slice(eq + 1);
        if (optionSpec.choices !== undefined && !optionSpec.choices.includes(value)) {
          return {
            ok: false,
            error: `--${name} must be one of: ${optionSpec.choices.join(", ")}.`,
            usage: spec.usage,
          };
        }
        options[name] = value;
      } else {
        options[name] = true;
      }
    } else {
      positional.push(token);
    }
  }

  const args: Record<string, string> = {};
  let cursor = 0;
  for (const arg of spec.args) {
    if (arg.kind === "rest") {
      const rest = positional
        .slice(cursor)
        .map((token) => token.text)
        .join(" ")
        .trim();
      cursor = positional.length;
      if (rest === "") {
        if (arg.required) {
          return { ok: false, error: `/${spec.id} needs ${arg.summary}.`, usage: spec.usage };
        }
        continue;
      }
      args[arg.name] = rest;
      continue;
    }
    const token = positional[cursor];
    if (token === undefined) {
      if (arg.required) {
        return { ok: false, error: `/${spec.id} needs ${arg.summary}.`, usage: spec.usage };
      }
      continue;
    }
    if (arg.kind === "choice") {
      const value = token.text.toLowerCase();
      if (!(arg.choices ?? []).includes(value)) {
        return {
          ok: false,
          error: `"${token.text}" is not one of: ${(arg.choices ?? []).join(", ")}.`,
          usage: spec.usage,
        };
      }
      args[arg.name] = value;
    } else {
      args[arg.name] = token.text;
    }
    cursor += 1;
  }
  if (cursor < positional.length) {
    const extra = positional[cursor] as Token;
    return {
      ok: false,
      error: `/${spec.id} did not expect "${extra.text}".`,
      usage: spec.usage,
    };
  }

  return { ok: true, invocation: { spec, args, options } };
}
