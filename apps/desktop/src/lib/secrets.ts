import { invoke } from "@tauri-apps/api/core";
import type { SecretStore } from "@jellytind/model-router";
import { InMemorySecretStore } from "@jellytind/model-router";
import { isTauri } from "../tauri";

/** Which store actually holds secrets — mirrors the Rust `SecretBackend` enum. */
export type SecretBackend = "keychain" | "file";

/**
 * {@link SecretStore} backed by the desktop host's credential storage.
 *
 * Keys never touch a Story Repository: the Rust side writes them to the OS
 * credential store (Keychain / Credential Manager / Secret Service), falling
 * back to an owner-only file in the application-config directory on machines
 * with no such service. Nothing here writes into a project directory, so an API
 * key can never end up in project content or revision history (AGENTS.md —
 * "Secrets").
 */
export class TauriSecretStore implements SecretStore {
  async get(key: string): Promise<string | null> {
    return (await invoke<string | null>("secret_get", { key })) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await invoke<SecretBackend>("secret_set", { key, value });
  }

  async delete(key: string): Promise<void> {
    await invoke("secret_delete", { key });
  }

  /** Report where secrets are being stored, so the UI can say so plainly. */
  async backend(): Promise<SecretBackend> {
    return invoke<SecretBackend>("secret_backend");
  }
}

/**
 * The secret store for this process. Outside Tauri (a plain `vite dev` browser
 * session) there is no OS credential store, so an in-memory store is used: keys
 * live only for the lifetime of the tab and are never persisted anywhere.
 */
export function createSecretStore(): SecretStore {
  return isTauri() ? new TauriSecretStore() : new InMemorySecretStore();
}

/** Human-readable description of where a key is kept, for the settings UI. */
export async function describeSecretBackend(store: SecretStore): Promise<string> {
  if (!(store instanceof TauriSecretStore)) {
    return "In-memory only (browser preview) — the key is not saved.";
  }
  const backend = await store.backend();
  return backend === "keychain"
    ? "Operating-system credential store."
    : "Owner-only file in the application config directory (no OS keychain available).";
}
