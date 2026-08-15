import type { CommandRegistry } from "./registry";
import { tokenize } from "./parser";
import type { ArgumentSpec, CatalogEntry, ChapterRef, Suggestion, Token } from "./types";

/**
 * Contextual autocomplete (§4).
 *
 * The suggestions come from the same registry the parser validates against and
 * from the project's own entities, so completing is never a guess about what
 * might parse: `/trace th` offers `thread` because that is the spec's choice
 * list, and `/trace thread miss` offers the project's actual threads.
 */

const MAX_SUGGESTIONS = 8;

export function complete(
  line: string,
  registry: CommandRegistry,
  catalog: readonly CatalogEntry[],
  chapters: readonly ChapterRef[] = [],
): Suggestion[] {
  const endsOpen = line === "" || !/\s$/.test(line);
  const tokens = tokenize(line);
  const head = tokens[0];

  // Still typing the command word itself.
  if (head === undefined || (tokens.length === 1 && endsOpen)) {
    const prefix = (head?.text ?? "/").replace(/^\//, "").toLowerCase();
    const out: Suggestion[] = [];
    for (const spec of registry.list()) {
      for (const name of [spec.id, ...spec.aliases]) {
        if (name.startsWith(prefix)) {
          out.push({
            value: `/${name} `,
            label: `/${name}`,
            detail: spec.summary,
            from: head?.start ?? 0,
          });
          break; // One suggestion per command, under its first matching name.
        }
      }
    }
    return out.slice(0, MAX_SUGGESTIONS);
  }

  const spec = registry.find(head.text);
  if (spec === null) return [];

  // Which positional argument is the caret on? Options don't consume slots.
  const positional = tokens.slice(1).filter((token) => !token.text.startsWith("--"));
  const partial: Token | null = endsOpen ? (positional[positional.length - 1] ?? null) : null;
  const settled = endsOpen ? positional.length - 1 : positional.length;
  const arg = argAt(spec.args, settled);
  if (arg === null) return [];

  const prefix = (partial?.text ?? "").toLowerCase();
  const from = partial?.start ?? line.length;

  if (arg.kind === "choice") {
    return (arg.choices ?? [])
      .filter((choice) => choice.startsWith(prefix))
      .slice(0, MAX_SUGGESTIONS)
      .map((choice) => ({ value: choice, label: choice, from }));
  }

  if (arg.kind === "entity" || arg.kind === "rest") {
    // A plain rest argument is free text — nothing to suggest. A rest argument
    // that names entity kinds is an entity reference that may contain spaces.
    if (arg.kind === "rest" && arg.entityKinds === undefined) return [];
    const kinds = arg.entityKinds ?? [];
    const pool =
      kinds.length === 0 ? catalog : catalog.filter((entry) => kinds.includes(entry.kind));
    return pool
      .filter((entry) => {
        const name = entry.name.toLowerCase().replace(/[_-]+/g, " ");
        const needle = prefix.replace(/[_-]+/g, " ");
        return (
          needle === "" ||
          name.startsWith(needle) ||
          name.split(" ").some((word) => word.startsWith(needle))
        );
      })
      .slice(0, MAX_SUGGESTIONS)
      .map((entry) => ({
        value: entry.name.includes(" ") ? `"${entry.name}"` : entry.name,
        label: entry.name,
        detail: entry.kind.replace(/_/g, " "),
        from,
      }));
  }

  if (arg.kind === "chapter") {
    return chapters
      .filter((chapter) => {
        const label = `${chapter.order + 1} ${(chapter.title ?? "").toLowerCase()}`;
        return prefix === "" || label.includes(prefix);
      })
      .slice(0, MAX_SUGGESTIONS)
      .map((chapter) => ({
        value: String(chapter.order + 1),
        label: chapter.title ?? `Chapter ${chapter.order + 1}`,
        detail: `chapter ${chapter.order + 1}`,
        from,
      }));
  }

  return [];
}

/** The argument a 0-based positional slot lands on; `rest` absorbs the tail. */
function argAt(args: readonly ArgumentSpec[], slot: number): ArgumentSpec | null {
  if (slot < 0) return null;
  if (slot < args.length) return args[slot] as ArgumentSpec;
  const last = args[args.length - 1];
  return last !== undefined && last.kind === "rest" ? last : null;
}
