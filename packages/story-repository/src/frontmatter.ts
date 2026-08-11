import yaml from "js-yaml";

/**
 * YAML front-matter codec for human-readable entity files.
 *
 * A file looks like:
 *
 * ```md
 * ---
 * id: CHAR_0001
 * name: Elias Vale
 * aliases: [E, The Heir]
 * ---
 * <markdown body>
 * ```
 *
 * The front-matter block is the authoritative structured record; the body is a
 * generated, human-readable rendering. Editing the raw body does not change
 * structured fields (the inspector is the structured editor) — see
 * docs/STORY_REPOSITORY.md.
 */

export interface ParsedDocument {
  readonly data: Record<string, unknown>;
  readonly body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(text: string): ParsedDocument {
  const match = FRONTMATTER.exec(text);
  if (match === null) {
    return { data: {}, body: text };
  }
  let data: Record<string, unknown> = {};
  try {
    const loaded = yaml.load(match[1] ?? "");
    if (typeof loaded === "object" && loaded !== null) {
      data = loaded as Record<string, unknown>;
    }
  } catch {
    data = {};
  }
  return { data, body: match[2] ?? "" };
}

export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
  // Skip undefined values so optional fields don't serialise as `null`.
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) clean[key] = value;
  }
  const front = yaml.dump(clean, { lineWidth: 100, sortKeys: false }).trimEnd();
  const trimmedBody = body.replace(/^\n+/, "");
  return `---\n${front}\n---\n\n${trimmedBody}`.replace(/\s*$/, "\n");
}
