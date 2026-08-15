import { invoke } from "@tauri-apps/api/core";
import {
  StoryRepository,
  BranchStore,
  openBranch,
  availableFolderName,
} from "@jellytind/story-repository";
import type { ProjectStore } from "@jellytind/persistence";
import type { Branch, BranchId } from "@jellytind/domain";
import { GenreRuntime } from "@jellytind/genre";
import { TauriProjectStore } from "./tauri-project-store";
import { rememberProject } from "./recents";
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

/** A snapshot is taken on open, at most this often. */
const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Prefix for a project being built. `project_discard` removes only these. */
const TEMP_PREFIX = ".manu-new-";

/**
 * Create a project **inside** the chosen folder.
 *
 * The folder the writer picks is where the project goes, not what the project
 * becomes. Choosing `~/Documents/Novels` and typing "The Black Thorn" produces
 * `~/Documents/Novels/The Black Thorn/` — the audit found Manu instead
 * scattering forty-four entries directly into `Novels/`, alongside whatever
 * else lived there (MANU-002).
 *
 * Creation is transactional from the writer's point of view: the repository is
 * built inside a temporary directory, validated, and only then renamed into
 * place. A failure at any point removes the temporary directory and leaves the
 * chosen folder exactly as it was (MANU-003).
 */
export async function createProjectAt(
  parent: string,
  title: string,
  template = "novel",
): Promise<ProjectSession> {
  requireTauri();

  const folder = await availableFolderName(title, (name) =>
    invoke<boolean>("project_child_exists", { parent, name }),
  );
  const temp = `${TEMP_PREFIX}${Date.now().toString(36)}`;

  const tempRoot = await invoke<string>("project_prepare", { parent, name: temp });
  try {
    const store = new TauriProjectStore(tempRoot);
    const repo = await StoryRepository.createProject({ store, title, rootPath: tempRoot });
    await GenreRuntime.attach(repo).applyTemplate(template);

    // Validate what was built before promoting it. A project that cannot be
    // opened must never reach the writer's folder under a real name.
    const check = await StoryRepository.validateProject(store);
    if (!check.ok) {
      throw new Error(check.errors[0] ?? "The new project did not validate.");
    }

    const root = await invoke<string>("project_promote", { parent, from: temp, to: folder });
    await rememberProject({ root, title, at: new Date().toISOString() });
    return sessionFor(new TauriProjectStore(root), root);
  } catch (cause) {
    // Leave nothing behind. `project_discard` refuses any name without the
    // temporary prefix, so this cannot become a general recursive delete.
    await invoke<void>("project_discard", { parent, name: temp }).catch(() => undefined);
    throw cause;
  }
}

export async function openProjectAt(root: string): Promise<ProjectSession> {
  requireTauri();
  return sessionFor(new TauriProjectStore(root), root);
}

/**
 * Restore a project archive's files into a fresh folder (Phase 40 §40).
 *
 * The same transactional shape as creation: everything lands in a temporary
 * directory, is validated as a real project, and only then is promoted into
 * place under a free name.
 */
export async function restoreProjectFiles(
  parent: string,
  name: string,
  files: ReadonlyArray<{ path: string; content: string }>,
): Promise<ProjectSession> {
  requireTauri();
  const folder = await availableFolderName(name, (candidate) =>
    invoke<boolean>("project_child_exists", { parent, name: candidate }),
  );
  const temp = `${TEMP_PREFIX}${Date.now().toString(36)}`;
  const tempRoot = await invoke<string>("project_prepare", { parent, name: temp });
  try {
    const store = new TauriProjectStore(tempRoot);
    for (const file of files) {
      await store.writeFile(file.path, file.content);
    }
    const check = await StoryRepository.validateProject(store);
    if (!check.ok) {
      throw new Error(check.errors[0] ?? "The archive did not restore to a valid project.");
    }
    const root = await invoke<string>("project_promote", { parent, from: temp, to: folder });
    return sessionFor(new TauriProjectStore(root), root);
  } catch (cause) {
    await invoke<void>("project_discard", { parent, name: temp }).catch(() => undefined);
    throw cause;
  }
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

  // Opening is the natural moment for a snapshot, and the interval keeps it
  // from happening forty times in an afternoon. Never fatal: a project that
  // opens but cannot be backed up should still open.
  try {
    await repo.backups.capture({ reason: "project opened", minIntervalMs: BACKUP_INTERVAL_MS });
  } catch {
    // Reported through the Backups surface rather than blocking the writer.
  }

  const manifest = repo.getManifest();
  await rememberProject({ root, title: manifest.title, at: new Date().toISOString() }).catch(
    () => undefined,
  );

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
