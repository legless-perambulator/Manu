import { invoke } from "@tauri-apps/api/core";

/** Mirror of the Rust `AppInfo` struct returned by the `app_info` command. */
export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly tagline: string;
}

/** True when running inside the Tauri webview (vs. a plain browser dev server). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Invoke the Rust `app_info` command. Rejects when the Tauri bridge is not
 * present (e.g. `vite dev` in a browser), letting the UI fall back gracefully.
 */
export async function getAppInfo(): Promise<AppInfo> {
  if (!isTauri()) {
    throw new Error("Tauri bridge unavailable.");
  }
  return invoke<AppInfo>("app_info");
}
