import type { StoryRepository } from "@jellytind/story-repository";

/**
 * Chapter files carry their structured record as YAML front matter; the prose
 * is the body beneath it. Everything mapping writes into a chapter must go
 * through here, so importing prose can never clobber the record — and
 * everything mapping *reads* is the body alone, so no internal ID ever leaks
 * into extraction.
 */

const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export function splitChapterFile(raw: string): { head: string; body: string } {
  const match = FRONTMATTER_BLOCK.exec(raw);
  const head = match?.[0] ?? "";
  return { head, body: raw.slice(head.length) };
}

/** The prose of a chapter file, with the front matter stripped. */
export function chapterBody(raw: string): string {
  return splitChapterFile(raw).body;
}

/** Replace a chapter's prose while keeping its front-matter record intact. */
export async function writeChapterBody(
  repo: StoryRepository,
  filePath: string,
  body: string,
): Promise<void> {
  const raw = (await repo.readProjectFile(filePath)) ?? "";
  const { head } = splitChapterFile(raw);
  await repo.writeProjectFile(filePath, `${head}${body.trimStart()}`);
}
