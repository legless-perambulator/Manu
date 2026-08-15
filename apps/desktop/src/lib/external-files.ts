import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

/**
 * The renderer's side of external file access: exactly one user-chosen file
 * in (import), exactly one out (export, backup). Bytes travel as base64
 * through the two audited Rust commands; nothing here ever writes to an
 * import source (§2).
 */

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

export async function readExternalFile(path: string): Promise<Uint8Array> {
  return fromBase64(await invoke<string>("external_read", { path }));
}

export async function writeExternalFile(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("external_write", { path, contentsBase64: toBase64(bytes) });
}

/** Ask for a manuscript to import. Null when the writer cancels. */
export async function pickManuscriptFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Import a manuscript",
    filters: [{ name: "Manuscripts", extensions: ["docx", "md", "markdown", "txt", "epub"] }],
  });
  if (selected === null) return null;
  return Array.isArray(selected) ? (selected[0] ?? null) : selected;
}

/** Ask where an export should go. Null when the writer cancels. */
export async function pickSaveFile(
  title: string,
  defaultName: string,
  extension: string,
): Promise<string | null> {
  return save({
    title,
    defaultPath: defaultName,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });
}
