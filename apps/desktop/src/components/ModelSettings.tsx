import { useCallback, useEffect, useMemo, useState } from "react";
import { secretKeyForProvider, type SecretStore } from "@jellytind/model-router";
import {
  MODEL_REGISTRY,
  PROVIDERS,
  describeSelected,
  loadModelSettings,
  saveModelSettings,
  testConnection,
  type ModelSettings as Settings,
} from "../lib/models";
import { describeSecretBackend } from "../lib/secrets";

interface Props {
  secrets: SecretStore;
  onClose: () => void;
}

/**
 * Provider and model configuration.
 *
 * Deliberately simple: choose a provider, choose one of its models, store the
 * API key in the host's secure storage, and prove the connection works. Per-task
 * model routing is a later phase — this screen only establishes that the
 * provider-independent layer can reach a real model.
 */
export function ModelSettings({ secrets, onClose }: Props) {
  const [settings, setSettings] = useState<Settings>(() => loadModelSettings());
  const [apiKey, setApiKey] = useState("");
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [storageNote, setStorageNote] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const providerNames = useMemo(() => [...PROVIDERS.keys()].sort(), []);
  const models = useMemo(() => MODEL_REGISTRY.list(settings.provider), [settings.provider]);
  const selected = describeSelected(settings);

  const refreshKeyState = useCallback(async () => {
    const stored = await secrets.get(secretKeyForProvider(settings.provider));
    setHasStoredKey(stored !== null && stored !== "");
  }, [secrets, settings.provider]);

  useEffect(() => {
    void refreshKeyState();
  }, [refreshKeyState]);

  useEffect(() => {
    void describeSecretBackend(secrets).then(setStorageNote);
  }, [secrets]);

  function update(next: Settings) {
    setSettings(next);
    saveModelSettings(next);
    setStatus(null);
  }

  function changeProvider(provider: string) {
    const first = MODEL_REGISTRY.list(provider)[0];
    update({ provider, modelId: first?.modelId ?? "" });
  }

  async function saveKey() {
    const value = apiKey.trim();
    if (value === "") return;
    setBusy(true);
    try {
      await secrets.set(secretKeyForProvider(settings.provider), value);
      setApiKey("");
      await refreshKeyState();
      setStatus({ ok: true, message: "API key saved to secure storage." });
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    setBusy(true);
    try {
      await secrets.delete(secretKeyForProvider(settings.provider));
      await refreshKeyState();
      setStatus({ ok: true, message: "API key removed." });
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    setStatus(null);
    try {
      setStatus(await testConnection(settings, secrets));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Model settings">
      <div className="modal">
        <header className="modal__header">
          <h2>Model settings</h2>
          <button className="btn btn--ghost btn--small" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="modal__body">
          <label className="field">
            <span>Provider</span>
            <select
              value={settings.provider}
              onChange={(e) => changeProvider(e.target.value)}
              disabled={busy}
            >
              {providerNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Model</span>
            <select
              value={settings.modelId}
              onChange={(e) => update({ ...settings, modelId: e.target.value })}
              disabled={busy}
            >
              {models.map((model) => (
                <option key={model.modelId} value={model.modelId}>
                  {model.displayName}
                </option>
              ))}
            </select>
          </label>

          {selected !== undefined && (
            <ul className="capabilities">
              <li>
                Context window:{" "}
                {selected.contextWindow === undefined
                  ? "unknown"
                  : `${selected.contextWindow.toLocaleString()} tokens`}
              </li>
              <li>Streaming: {selected.supportsStreaming ? "yes" : "no"}</li>
              <li>Structured output: {selected.supportsStructuredOutput ? "yes" : "no"}</li>
              <li>Tool calling: {selected.supportsTools ? "yes" : "no"}</li>
              {selected.costMetadata !== undefined && (
                <li>
                  Cost: {selected.costMetadata.inputPer1M ?? "?"} in /{" "}
                  {selected.costMetadata.outputPer1M ?? "?"} out per 1M tokens (
                  {selected.costMetadata.currency ?? "USD"})
                </li>
              )}
            </ul>
          )}

          <label className="field">
            <span>API key {hasStoredKey ? "(a key is stored)" : "(none stored)"}</span>
            <input
              type="password"
              value={apiKey}
              placeholder={hasStoredKey ? "Enter a new key to replace the stored one" : "Paste key"}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={busy}
            />
          </label>
          <p className="hint">
            Keys are held by the desktop application, never inside a project. {storageNote}
          </p>

          <div className="modal__actions">
            <button
              className="btn btn--primary"
              onClick={() => void saveKey()}
              disabled={busy || apiKey.trim() === ""}
            >
              Save key
            </button>
            <button
              className="btn btn--danger btn--small"
              onClick={() => void clearKey()}
              disabled={busy || !hasStoredKey}
            >
              Remove key
            </button>
            <button className="btn" onClick={() => void runTest()} disabled={busy}>
              Test connection
            </button>
          </div>

          {status !== null && (
            <p className={`status${status.ok ? " status--ok" : " status--error"}`}>
              {status.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
