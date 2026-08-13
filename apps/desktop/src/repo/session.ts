import { StoryRepository, BranchStore, openBranch } from "@jellytind/story-repository";
import type { ProjectStore } from "@jellytind/persistence";
import type { Branch, BranchId } from "@jellytind/domain";
import { GenreRuntime } from "@jellytind/genre";
import { TauriProjectStore } from "./tauri-project-store";
import { isTauri } from "../tauri";

/**
 * Thin renderer-side entry points to the Story Repository service, wiring it to
 * the Tauri-backed store. The repository operates file-first; the SQLite derived
 * index is a host-side concern attached separately (see docs/STORY_REPOSITORY.md).
 *
 * A session holds the **base** store as well as the repository, because branch
 * operations work across versions while a `StoryRepository` is scoped to
 * exactly one (docs/VERSIONING.md).
 */
export interface ProjectSession {
  readonly repo: StoryRepository;
  readonly store: ProjectStore;
  readonly root: string;
  readonly branch: Branch;
}

export async function createProjectAt(
  root: string,
  title: string,
  template = "novel",
): Promise<ProjectSession> {
  requireTauri();
  const store = new TauriProjectStore(root);
  const repo = await StoryRepository.createProject({ store, title, rootPath: root });
  // A template is a starting configuration, not a project type: it switches
  // modules on and confers nothing that cannot be changed later
  // (docs/GENRE_MODULES.md).
  await GenreRuntime.attach(repo).applyTemplate(template);
  return sessionFor(store, root);
}

export async function openProjectAt(root: string): Promise<ProjectSession> {
  requireTauri();
  return sessionFor(new TauriProjectStore(root), root);
}

/** Re-open the project on a different version. */
export async function openOnBranch(
  session: ProjectSession,
  branchId: BranchId,
): Promise<ProjectSession> {
  return sessionFor(session.store, session.root, branchId);
}

async function sessionFor(
  store: ProjectStore,
  root: string,
  branchId?: BranchId,
): Promise<ProjectSession> {
  const repo = await openBranch(store, branchId, { rootPath: root });
  const branches = new BranchStore(store);
  const branch = branchId === undefined ? await branches.active() : await branches.get(branchId);
  return { repo, store, root, branch };
}

export async function validateProjectAt(root: string) {
  requireTauri();
  const store = new TauriProjectStore(root);
  return StoryRepository.validateProject(store);
}

function requireTauri(): void {
  if (!isTauri()) {
    throw new Error("Project operations require the desktop app (Tauri bridge unavailable).");
  }
}
