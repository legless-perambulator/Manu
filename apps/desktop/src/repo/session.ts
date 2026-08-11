import { StoryRepository } from "@jellytind/story-repository";
import { TauriProjectStore } from "./tauri-project-store";
import { isTauri } from "../tauri";

/**
 * Thin renderer-side entry points to the Story Repository service, wiring it to
 * the Tauri-backed store. The repository operates file-first; the SQLite derived
 * index is a host-side concern attached separately (see docs/STORY_REPOSITORY.md).
 */

export async function createProjectAt(root: string, title: string): Promise<StoryRepository> {
  requireTauri();
  const store = new TauriProjectStore(root);
  return StoryRepository.createProject({ store, title, rootPath: root });
}

export async function openProjectAt(root: string): Promise<StoryRepository> {
  requireTauri();
  const store = new TauriProjectStore(root);
  return StoryRepository.openProject({ store, rootPath: root });
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
