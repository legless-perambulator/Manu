import { invoke } from "@tauri-apps/api/core";
import type { ProjectStore } from "@jellytind/persistence";

/**
 * A {@link ProjectStore} backed by the Rust host's root-confined filesystem
 * commands. The renderer never touches the filesystem directly; every call is
 * mediated by the host, which enforces confinement and atomic writes. The
 * `StoryRepository` service runs on top of this exactly as it does over the
 * in-memory / Node stores in tests.
 */
export class TauriProjectStore implements ProjectStore {
  constructor(private readonly root: string) {}

  readFile(path: string): Promise<string | null> {
    return invoke<string | null>("project_read_text", { root: this.root, rel: path });
  }

  writeFile(path: string, content: string): Promise<void> {
    return invoke<void>("project_write_atomic", { root: this.root, rel: path, contents: content });
  }

  exists(path: string): Promise<boolean> {
    return invoke<boolean>("project_exists", { root: this.root, rel: path });
  }

  list(prefix?: string): Promise<string[]> {
    return invoke<string[]>("project_list", { root: this.root, rel: prefix ?? null });
  }

  delete(path: string): Promise<void> {
    return invoke<void>("project_remove", { root: this.root, rel: path });
  }

  createDirectory(path: string): Promise<void> {
    return invoke<void>("project_mkdir", { root: this.root, rel: path });
  }
}
