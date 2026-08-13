import { BranchedProjectStore, type ProjectStore } from "@jellytind/persistence";
import { MAIN_BRANCH_NAME, type Branch, type BranchId } from "@jellytind/domain";
import { StoryRepository } from "./story-repository";
import { BranchStore } from "./branch-store";
import { computeLineDiff, diffStat } from "./diff";
import { RepositoryError } from "./errors";

/**
 * Branch operations.
 *
 * Everything here works on the **base** store — the project as it sits on disk
 * — and opens branched views of it as needed. A `StoryRepository` is always
 * scoped to exactly one branch and has no idea the others exist; that is what
 * makes isolation total rather than a rule every subsystem has to remember.
 */

/** A file that differs between two versions. */
export interface FileDifference {
  readonly path: string;
  readonly change: "added" | "removed" | "modified";
  readonly added: number;
  readonly removed: number;
}

/** A structured record that differs between two versions. */
export interface RecordDifference {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
  readonly change: "added" | "removed" | "modified";
}

export interface BranchComparison {
  readonly from: Branch;
  readonly to: Branch;
  readonly manuscript: readonly FileDifference[];
  readonly records: readonly RecordDifference[];
  /** Areas compared, so silence can be read as "no difference", not "not looked at". */
  readonly inspected: readonly string[];
  readonly summary: string;
}

/** Open a repository scoped to one branch. */
export async function openBranch(
  base: ProjectStore,
  branchId?: BranchId,
  options?: { rootPath?: string },
): Promise<StoryRepository> {
  const branches = new BranchStore(base);
  const branch = branchId === undefined ? await branches.active() : await branches.get(branchId);
  const main = await branches.main();
  const store = new BranchedProjectStore(base, branch.id === main.id ? null : branch.id);
  return StoryRepository.openProject({
    store,
    ...(options?.rootPath !== undefined ? { rootPath: options.rootPath } : {}),
  });
}

/**
 * Create an alternative version from the current state of `parent`.
 *
 * Creating a version copies nothing and changes nothing: the new branch starts
 * as an empty overlay that reads through to its parent. The creative work — the
 * darker ending, the character who survives — is a separate act the writer or
 * an agent performs *after* switching to it.
 */
export async function createBranch(
  base: ProjectStore,
  input: { name: string; description?: string; parentBranchId?: BranchId },
): Promise<Branch> {
  const branches = new BranchStore(base);
  const parent = input.parentBranchId ?? (await branches.active()).id;
  const parentRepo = await openBranch(base, parent);
  const history = await parentRepo.listChangeSets();

  return branches.create({
    name: input.name,
    ...(input.description !== undefined ? { description: input.description } : {}),
    parentBranchId: parent,
    ...(history[0] !== undefined ? { createdFromRevisionId: history[0].id } : {}),
  });
}

/**
 * Switch the active version.
 *
 * The caller must have dealt with unsaved work first: this changes which files
 * the next repository reads, and nothing here can see an editor's buffer. The
 * desktop app checks for a dirty editor and a staged proposal before calling
 * (docs/VERSIONING.md).
 */
export async function switchBranch(base: ProjectStore, branchId: BranchId): Promise<Branch> {
  return new BranchStore(base).setActive(branchId);
}

/** Compare two versions: what the prose says, and what the records hold. */
export async function compareBranches(
  base: ProjectStore,
  fromId: BranchId,
  toId: BranchId,
): Promise<BranchComparison> {
  const branches = new BranchStore(base);
  const from = await branches.get(fromId);
  const to = await branches.get(toId);
  const [fromRepo, toRepo] = await Promise.all([openBranch(base, fromId), openBranch(base, toId)]);

  const manuscript = await compareFiles(fromRepo, toRepo);
  const records = await compareRecords(fromRepo, toRepo);

  const changed = manuscript.length;
  const summary =
    changed === 0 && records.length === 0
      ? `${from.name} and ${to.name} are identical.`
      : `${String(changed)} file(s) and ${String(records.length)} record(s) differ.`;

  return {
    from,
    to,
    manuscript,
    records,
    inspected: INSPECTED,
    summary,
  };
}

const INSPECTED = [
  "manuscript files",
  "chapters",
  "scenes",
  "characters",
  "locations",
  "objects",
  "plot threads",
  "facts",
  "relationships",
  "story tests",
  "dependencies",
] as const;

async function compareFiles(a: StoryRepository, b: StoryRepository): Promise<FileDifference[]> {
  const [aPaths, bPaths] = await Promise.all([a.listProjectFiles(), b.listProjectFiles()]);
  const prose = (p: string) => p.startsWith("manuscript/");
  const all = [...new Set([...aPaths, ...bPaths])].filter(prose).sort();

  const out: FileDifference[] = [];
  for (const path of all) {
    const [before, after] = await Promise.all([a.readProjectFile(path), b.readProjectFile(path)]);
    if (before === after) continue;
    const stat = diffStat(computeLineDiff(before ?? "", after ?? ""));
    out.push({
      path,
      change: before === null ? "added" : after === null ? "removed" : "modified",
      added: stat.added,
      removed: stat.removed,
    });
  }
  return out;
}

/**
 * Compare the structured half. Records are matched by **stable ID**, so a
 * renamed character is a modification rather than a deletion plus an addition.
 */
async function compareRecords(a: StoryRepository, b: StoryRepository): Promise<RecordDifference[]> {
  const readers: readonly {
    kind: string;
    read: (r: StoryRepository) => Promise<readonly { id: string }[]>;
    label: (item: never) => string;
  }[] = [
    { kind: "chapter", read: (r) => r.listChapters(), label: (i: { title: string }) => i.title },
    { kind: "scene", read: (r) => r.listScenes(), label: (i: { title: string }) => i.title },
    { kind: "character", read: (r) => r.listCharacters(), label: (i: { name: string }) => i.name },
    { kind: "location", read: (r) => r.listLocations(), label: (i: { name: string }) => i.name },
    { kind: "object", read: (r) => r.listObjects(), label: (i: { name: string }) => i.name },
    { kind: "thread", read: (r) => r.listPlotThreads(), label: (i: { name: string }) => i.name },
    { kind: "fact", read: (r) => r.listFacts(), label: (i: { statement: string }) => i.statement },
    {
      kind: "relationship",
      read: (r) => r.listRelationships(),
      label: (i: { id: string }) => i.id,
    },
    { kind: "test", read: (r) => r.listStoryTests(), label: (i: { name: string }) => i.name },
    {
      kind: "dependency",
      read: (r) => r.listDependencies(),
      label: (i: { id: string }) => i.id,
    },
  ];

  const out: RecordDifference[] = [];
  for (const reader of readers) {
    const [before, after] = await Promise.all([reader.read(a), reader.read(b)]);
    const beforeById = new Map(before.map((i) => [i.id, i]));
    const afterById = new Map(after.map((i) => [i.id, i]));
    const describe = reader.label as (item: unknown) => string;

    for (const [id, item] of beforeById) {
      const other = afterById.get(id);
      if (other === undefined) {
        out.push({ kind: reader.kind, id, label: describe(item), change: "removed" });
      } else if (JSON.stringify(item) !== JSON.stringify(other)) {
        out.push({ kind: reader.kind, id, label: describe(other), change: "modified" });
      }
    }
    for (const [id, item] of afterById) {
      if (!beforeById.has(id)) {
        out.push({ kind: reader.kind, id, label: describe(item), change: "added" });
      }
    }
  }
  return out;
}

export interface MergeConflict {
  readonly path: string;
  readonly reason: string;
}

export interface MergeResult {
  readonly applied: readonly string[];
  readonly conflicts: readonly MergeConflict[];
  readonly changeSetId?: string;
  readonly summary: string;
}

/**
 * Merge one version into another, conservatively.
 *
 * **Fiction does not merge like code.** Two versions of a chapter that both
 * changed are not a three-way text merge problem; they are two different books
 * and only the author knows which sentence should survive. So this takes only
 * what is unambiguous:
 *
 * - a file the source changed and the target did not — applied
 * - a file both changed — a conflict, reported, never guessed at
 * - a file the source deleted and the target changed — a conflict
 *
 * Nothing is applied until the whole merge has been planned, and the result is
 * one revertible change set.
 */
export async function mergeBranch(
  base: ProjectStore,
  sourceId: BranchId,
  targetId: BranchId,
): Promise<MergeResult> {
  const branches = new BranchStore(base);
  const source = await branches.get(sourceId);
  const target = await branches.get(targetId);
  if (source.id === target.id) {
    throw new RepositoryError(
      "invalid_branch_operation",
      "A version cannot be merged into itself.",
    );
  }

  const [sourceChanged, targetChanged] = await Promise.all([
    changedSince(base, source),
    changedSince(base, target),
  ]);
  const [sourceRepo, targetRepo] = await Promise.all([
    openBranch(base, sourceId),
    openBranch(base, targetId),
  ]);

  const plan: { path: string; content: string | null }[] = [];
  const conflicts: MergeConflict[] = [];

  for (const path of [...sourceChanged].sort()) {
    if (path.startsWith(".writer/")) continue;
    const [inSource, inTarget] = await Promise.all([
      sourceRepo.readProjectFile(path),
      targetRepo.readProjectFile(path),
    ]);
    if (inSource === inTarget) continue;

    if (targetChanged.has(path)) {
      conflicts.push({
        path,
        reason: `Both ${source.name} and ${target.name} changed this since they diverged.`,
      });
    } else {
      plan.push({ path, content: inSource });
    }
  }

  if (conflicts.length > 0) {
    return {
      applied: [],
      conflicts,
      summary:
        `${String(conflicts.length)} file(s) changed in both versions. ` +
        "Nothing has been merged — resolve these first.",
    };
  }
  if (plan.length === 0) {
    return {
      applied: [],
      conflicts: [],
      summary: `${target.name} already has everything from ${source.name}.`,
    };
  }

  const tx = targetRepo.beginTransaction(`Merged ${source.name} into ${target.name}`, {
    actor: "human",
    operation: "merge_branch",
  });
  for (const step of plan) {
    if (step.content === null) tx.deleteFile(step.path);
    else tx.writeFile(step.path, step.content);
  }
  const changeSet = await tx.commit();

  return {
    applied: plan.map((s) => s.path),
    conflicts: [],
    changeSetId: changeSet.id,
    summary: `Merged ${String(plan.length)} file(s) from ${source.name} into ${target.name}.`,
  };
}

/**
 * What a version has changed since it diverged.
 *
 * Each side is asked about its **own** record rather than inferred by comparing
 * the two: a branch knows exactly which files it has written or deleted,
 * because that is what its overlay is. The parent side is read from its change
 * history after the point the branch was taken. Comparing content instead would
 * make "they both edited this" indistinguishable from "only one of them did",
 * which is precisely the distinction a merge turns on.
 */
async function changedSince(base: ProjectStore, branch: Branch): Promise<Set<string>> {
  const branches = new BranchStore(base);
  const main = await branches.main();
  if (branch.id !== main.id) {
    const store = new BranchedProjectStore(base, branch.id);
    return new Set(await store.ownPaths());
  }

  // Main owns the project files directly, so its divergence is its history.
  const repo = await openBranch(base, branch.id);
  const summaries = await repo.listChangeSets();
  const changed = new Set<string>();
  for (const summary of summaries) {
    const full = await repo.getChangeSet(summary.id);
    if (full === null) continue;
    for (const file of full.filesChanged) changed.add(file.path);
  }
  return changed;
}

/** Delete a version. Main and the active version are protected. */
export async function deleteBranch(base: ProjectStore, branchId: BranchId): Promise<Branch> {
  return new BranchStore(base).remove(branchId);
}

export { MAIN_BRANCH_NAME };
