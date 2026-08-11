import { open } from "@tauri-apps/plugin-dialog";

/** Prompt the user to choose a directory. Returns the absolute path, or null if cancelled. */
export async function pickDirectory(title: string): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, title });
  if (selected === null) return null;
  return Array.isArray(selected) ? (selected[0] ?? null) : selected;
}
