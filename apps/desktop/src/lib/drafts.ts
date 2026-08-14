/**
 * Unsaved editor text, kept where a crash cannot reach it.
 *
 * Autosave is the real protection; this is the belt to its braces. Every
 * keystroke updates a draft synchronously in local storage — no promise, no
 * disk, nothing that can be half-finished when the process dies. If Manu is
 * killed between one autosave and the next, the draft survives and is offered
 * back on reopen (MANU-021).
 *
 * Deliberately small: drafts are cleared the moment a save succeeds, so this
 * never becomes a second source of truth competing with the manuscript.
 */

export interface Draft {
  readonly root: string;
  readonly path: string;
  readonly content: string;
  readonly at: string;
}

const KEY = "manu.drafts";
/** Enough for a long session across a few files; drafts are transient. */
const LIMIT = 12;

function read(): Draft[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Draft[]) : [];
  } catch {
    return [];
  }
}

function write(drafts: readonly Draft[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(drafts.slice(0, LIMIT)));
  } catch {
    // Storage full or unavailable. Autosave still protects the writer; this
    // layer going quiet must never interrupt typing.
  }
}

/** Record unsaved text. Synchronous by design — a crash gets no warning. */
export function keepDraft(draft: Draft): void {
  const rest = read().filter((d) => !(d.root === draft.root && d.path === draft.path));
  write([draft, ...rest]);
}

/** Forget a draft, because its content reached the disk. */
export function clearDraft(root: string, path: string): void {
  write(read().filter((d) => !(d.root === root && d.path === path)));
}

/** A draft for this file, if one outlived its session. */
export function findDraft(root: string, path: string): Draft | null {
  return read().find((d) => d.root === root && d.path === path) ?? null;
}

/** Every draft belonging to a project, newest first. */
export function draftsFor(root: string): Draft[] {
  return read().filter((d) => d.root === root);
}
