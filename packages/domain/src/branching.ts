/**
 * Story branching: alternative versions of a whole project.
 *
 * A branch is an alternative state of the entire Story Repository — manuscript,
 * entities, state, knowledge, relationships, timeline, objects, threads, tests
 * and dependencies together — not an alternative text file. See
 * docs/VERSIONING.md.
 */

/** The branch every project has, and which cannot be deleted or renamed away. */
export const MAIN_BRANCH_NAME = "main";

export const BRANCH_STATUSES = ["active", "merged", "abandoned"] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];

export type BranchId = string & { readonly __brand: "BranchId" };

export interface Branch {
  readonly id: BranchId;
  readonly name: string;
  readonly description?: string;
  /** The branch this one was taken from; absent only for main. */
  readonly parentBranchId?: BranchId;
  /**
   * The change set the parent was at when this branch was taken — the point
   * the two versions stop sharing a history.
   */
  readonly createdFromRevisionId?: string;
  readonly createdAt: string;
  readonly status: BranchStatus;
}

export function isMainBranch(branch: Branch): boolean {
  return branch.parentBranchId === undefined && branch.name === MAIN_BRANCH_NAME;
}

/**
 * Branch names are shown to writers and used in prose ("switch to
 * darker-ending"), so they are kept to a predictable, file-safe shape.
 */
export function normaliseBranchName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function describeBranch(branch: Branch): string {
  const parts = [branch.name];
  if (branch.description !== undefined && branch.description !== "") {
    parts.push(`— ${branch.description}`);
  }
  return parts.join(" ");
}
