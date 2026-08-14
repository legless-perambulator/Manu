/**
 * Recently opened projects.
 *
 * The audit found that every launch required navigating a native directory
 * picker back to a folder Manu had never created and did not remember
 * (MANU-012). This is the smallest honest fix: a list of paths, newest first.
 *
 * Stored per machine, never inside a project — a project is portable and must
 * not carry one computer's history around with it.
 */

export interface RecentProject {
  readonly root: string;
  readonly title: string;
  /** ISO timestamp of the last open. */
  readonly at: string;
}

const KEY = "manu.recent-projects";
const LIMIT = 8;

export function listRecentProjects(): RecentProject[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is RecentProject =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as RecentProject).root === "string" &&
        typeof (entry as RecentProject).title === "string",
    );
  } catch {
    return [];
  }
}

export async function rememberProject(entry: RecentProject): Promise<void> {
  try {
    const rest = listRecentProjects().filter((item) => item.root !== entry.root);
    window.localStorage.setItem(KEY, JSON.stringify([entry, ...rest].slice(0, LIMIT)));
  } catch {
    // Not remembering is a small loss; failing to open a project is not.
  }
  return Promise.resolve();
}

export function forgetProject(root: string): void {
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify(listRecentProjects().filter((item) => item.root !== root)),
    );
  } catch {
    // As above.
  }
}
