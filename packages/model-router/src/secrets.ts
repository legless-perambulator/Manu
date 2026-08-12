/**
 * Secure local storage for provider secrets (API keys).
 *
 * Secrets MUST NOT be stored in Story Repository content (AGENTS.md — local-first
 * privacy). The desktop app backs this with the OS keychain; tests use the
 * in-memory implementation. Core code depends only on this interface.
 */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Conventional secret keys. */
export const secretKeyForProvider = (provider: string): string => `provider:${provider}:apiKey`;

/** In-memory {@link SecretStore} for tests and non-persistent contexts. */
export class InMemorySecretStore implements SecretStore {
  private readonly secrets = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.secrets.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.secrets.delete(key);
    return Promise.resolve();
  }
}
