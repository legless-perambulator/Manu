/**
 * Where the writer was, per project.
 *
 * Reopening a novel should put somebody back in front of their words, not in
 * front of a project-management screen. Manu remembers the document that was
 * open and roughly where in it the writer had got to, keyed by project root so
 * two books never restore each other's place (§28).
 *
 * Kept small and kept out of the project folder: this is one machine's habit,
 * not part of the story. A project copied to another computer carries no
 * memory of where somebody else's cursor was.
 */

export interface WorkspaceState {
  /** The document that was open, as a project-relative path. */
  readonly path: string | null;
  /** Caret offset into the file, so reopening lands where writing stopped. */
  readonly caret: number;
  /** Scroll position as a fraction of the document, which survives a reflow. */
  readonly scroll: number;
}

export const EMPTY_STATE: WorkspaceState = { path: null, caret: 0, scroll: 0 };

const PREFIX = "manu.workspace.";
/** Enough projects to cover anybody's working set without unbounded growth. */
const MAX_PROJECTS = 20;

function keyFor(root: string): string {
  return `${PREFIX}${root}`;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Read the remembered place for a project.
 *
 * Repairs rather than trusts: a caret past the end of a file that shrank since,
 * or a scroll fraction outside 0–1, must not be able to throw on open. The
 * editor clamps the caret against the real length once the file is loaded, so
 * the only job here is to return numbers.
 */
export function loadWorkspaceState(root: string): WorkspaceState {
  try {
    const raw = window.localStorage.getItem(keyFor(root));
    if (raw === null) return EMPTY_STATE;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return EMPTY_STATE;
    const record = value as Record<string, unknown>;
    const path =
      typeof record["path"] === "string" && record["path"] !== "" ? record["path"] : null;
    const caret =
      typeof record["caret"] === "number" && Number.isFinite(record["caret"])
        ? Math.max(0, Math.floor(record["caret"]))
        : 0;
    const scroll =
      typeof record["scroll"] === "number" && Number.isFinite(record["scroll"])
        ? clamp01(record["scroll"])
        : 0;
    return { path, caret, scroll };
  } catch {
    return EMPTY_STATE;
  }
}

export function saveWorkspaceState(root: string, state: WorkspaceState): void {
  try {
    window.localStorage.setItem(keyFor(root), JSON.stringify(state));
    prune();
  } catch {
    // Losing the place is a small cost. Interrupting writing is not.
  }
}

export function forgetWorkspaceState(root: string): void {
  try {
    window.localStorage.removeItem(keyFor(root));
  } catch {
    // Nothing to do: the entry is either gone or unreachable.
  }
}

/**
 * Keep the number of remembered projects bounded.
 *
 * Without this, a machine that has opened a project a week for three years
 * carries a hundred and fifty dead entries. Removal is oldest-first by the
 * order the browser reports, which is insertion order — good enough for a
 * convenience cache and cheaper than storing a timestamp per project.
 */
function prune(): void {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key !== null && key.startsWith(PREFIX)) keys.push(key);
  }
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_PROJECTS))) {
    window.localStorage.removeItem(key);
  }
}
