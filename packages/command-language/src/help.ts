import type { CommandRegistry } from "./registry";
import type { CommandSpec } from "./types";

/**
 * `/help`, kept concise (§5).
 *
 * The overview is one line per command, grouped; the per-command page is the
 * usage, the summary, the arguments and the options — everything the parser
 * will hold the writer to, and nothing else.
 */

export function helpOverview(registry: CommandRegistry): string[] {
  const lines: string[] = [];
  const groups = new Map<string, CommandSpec[]>();
  for (const spec of registry.list()) {
    const list = groups.get(spec.group) ?? [];
    list.push(spec);
    groups.set(spec.group, list);
  }
  for (const [group, specs] of groups) {
    lines.push(`${group}:`);
    for (const spec of specs) {
      lines.push(`  ${spec.usage} — ${spec.summary}`);
    }
  }
  lines.push("");
  lines.push("/help <command> for details. Quotes group words; --option=value sets options.");
  return lines;
}

export function helpFor(registry: CommandRegistry, topic: string): string[] | null {
  const spec = registry.find(topic);
  if (spec === null) return null;
  const lines: string[] = [`${spec.usage}`, spec.summary];
  if (spec.aliases.length > 0) {
    lines.push(`Also: ${spec.aliases.map((alias) => `/${alias}`).join(", ")}`);
  }
  for (const arg of spec.args) {
    lines.push(`  ${arg.name}${arg.required ? "" : " (optional)"} — ${arg.summary}`);
  }
  for (const option of spec.options) {
    lines.push(`  --${option.name}${option.takesValue ? "=…" : ""} — ${option.summary}`);
  }
  if (spec.permission === "stage") {
    lines.push("Changes go through analyse → preview → stage → approve. Nothing applies here.");
  }
  return lines;
}
