/**
 * Separating a chapter's record from its prose.
 *
 * A chapter file carries a YAML block that keeps the record and the words in
 * one portable document — the thing that makes "plain files you own" true. A
 * writer should still not have to look at it: the audit's screenshot opened on
 * `---`, `id:`, `title:`, which is a manuscript that looks like source code.
 *
 * Kept here rather than inside the editor because the panels count words too,
 * and a word count that includes `schemaVersion: 1` is wrong in a way somebody
 * would eventually have to debug.
 */

/**
 * Split a file into its front matter and its prose.
 *
 * The head is preserved byte for byte so it can be re-attached on every save:
 * what is hidden is only hidden from the eye. If the block is malformed or
 * absent, the whole file is prose and nothing is hidden — guessing would be
 * worse than showing.
 */
export function splitFrontMatter(text: string): { head: string; body: string } {
  if (!text.startsWith("---")) return { head: "", body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { head: "", body: text };
  // Include the closing fence and the blank line that conventionally follows.
  const after = text.indexOf("\n", end + 1);
  if (after === -1) return { head: "", body: text };
  let cut = after + 1;
  if (text[cut] === "\n") cut += 1;
  return { head: text.slice(0, cut), body: text.slice(cut) };
}

/**
 * The chapter's own title, from its front matter.
 *
 * `CHAPTER_0001` is the file. "The Cellar Door" is what the writer called it,
 * and it is what the bar should say.
 */
export function titleOf(head: string): string | null {
  const match = /^title:[ \t]*(.+)$/m.exec(head);
  const title = match?.[1]?.trim() ?? "";
  return title === "" ? null : title.replace(/^["']|["']$/g, "");
}
