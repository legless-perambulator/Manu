import { useCallback, useEffect, useMemo, useState } from "react";
import {
  capabilityState,
  type ModelCapabilities,
  type ModelDescriptor,
  type ProviderDescriptor,
  type SecretStore,
} from "@jellytind/model-router";
import {
  MODEL_PURPOSES,
  PURPOSE_HINT,
  PURPOSE_LABEL,
  loadAiSettings,
  newConnectionId,
  saveAiSettings,
  secretKeyForConnection,
  type AiSettings,
  type ModelPurpose,
  type ProviderConnection,
} from "../lib/connections";
import {
  describeProvider,
  discoverModels,
  explainModelError,
  modelsFor,
  providerDescriptors,
  testConnection,
} from "../lib/models";
import { outOfScopeReason } from "../lib/network-scope";
import { describeSecretBackend } from "../lib/secrets";
import { ModelRoutingSettings } from "./ModelRoutingSettings";
import { APP_FORMAT_VERSION } from "@jellytind/domain";
import { buildDiagnosticsBundle, renderDiagnostics } from "../lib/diagnostics";
import { loadUpdateChannel, saveUpdateChannel, type UpdateChannel } from "../lib/updates";
import { pickSaveFile, writeExternalFile } from "../lib/external-files";
import { isTauri } from "../tauri";

interface Props {
  secrets: SecretStore;
  onClose: () => void;
}

interface Status {
  readonly ok: boolean;
  readonly message: string;
  readonly detail?: string;
}

/**
 * Settings → AI providers.
 *
 * A writer configures *connections*, not a global provider: two Ollama servers
 * are two connections, and a hosted key alongside a local model is the normal
 * case rather than an exotic one. Everything here is driven by
 * {@link ProviderDescriptor}s from the registry, so an adapter added to the
 * registry appears in this screen without a line changing here
 * (docs/MODEL_ROUTER.md).
 */
export function AiProviderSettings({ secrets, onClose }: Props) {
  const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [storageNote, setStorageNote] = useState("");

  const providers = useMemo(() => providerDescriptors(), []);
  // Nothing chosen yet means the first connection, so the screen opens on
  // something rather than on an explanation of why it is empty.
  const selected =
    settings.connections.find((c) => c.id === selectedId) ?? settings.connections[0] ?? null;

  useEffect(() => {
    void describeSecretBackend(secrets).then(setStorageNote);
  }, [secrets]);

  const commit = useCallback((next: AiSettings) => {
    setSettings(next);
    saveAiSettings(next);
  }, []);

  function addConnection(descriptor: ProviderDescriptor) {
    const id = newConnectionId(descriptor.id, settings.connections);
    const connection: ProviderConnection = {
      id,
      providerId: descriptor.id,
      label: descriptor.displayName,
      ...(descriptor.configurableBaseUrl && descriptor.defaultBaseUrl !== undefined
        ? { baseUrl: descriptor.defaultBaseUrl }
        : {}),
    };
    commit({ ...settings, connections: [...settings.connections, connection] });
    setSelectedId(id);
    setAdding(false);
  }

  function updateConnection(next: ProviderConnection) {
    commit({
      ...settings,
      connections: settings.connections.map((c) => (c.id === next.id ? next : c)),
    });
  }

  async function removeConnection(connection: ProviderConnection) {
    // The key goes with it. Leaving an orphaned credential in the OS store
    // because a connection was deleted would be a quiet little secret leak.
    await secrets.delete(secretKeyForConnection(connection.id));
    const purposes: AiSettings["purposes"] = {};
    for (const purpose of MODEL_PURPOSES) {
      const choice = settings.purposes[purpose];
      if (choice !== undefined && choice.connectionId !== connection.id) {
        purposes[purpose] = choice;
      }
    }
    const connections = settings.connections.filter((c) => c.id !== connection.id);
    commit({ connections, purposes });
    setSelectedId(connections[0]?.id ?? null);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="AI providers">
      <div className="modal modal--wide">
        <header className="modal__header">
          <h2>AI providers</h2>
          <button className="btn btn--ghost btn--small" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="modal__body providers">
          <aside className="providers__list">
            <ul className="providers__connections">
              {settings.connections.map((connection) => {
                const descriptor = describeProvider(connection.providerId);
                return (
                  <li key={connection.id}>
                    <button
                      className={`providers__connection${
                        connection.id === selected?.id ? " is-selected" : ""
                      }`}
                      onClick={() => {
                        setSelectedId(connection.id);
                        setAdding(false);
                      }}
                    >
                      <span className="providers__connection-name">{connection.label}</span>
                      <span className="providers__connection-meta">
                        {descriptor === undefined
                          ? "Unknown provider"
                          : descriptor.local
                            ? "Your machine or network"
                            : "Hosted API"}
                      </span>
                    </button>
                  </li>
                );
              })}
              {settings.connections.length === 0 && (
                <li className="providers__empty">No providers connected yet.</li>
              )}
            </ul>
            <button className="btn btn--small" onClick={() => setAdding(true)}>
              Add a provider
            </button>
          </aside>

          <section className="providers__detail">
            {/*
              With nothing configured the picker *is* the screen. Making somebody
              press "Add a provider" to see what there is to add would be a step
              that exists only to be got past.
            */}
            {adding || selected === null ? (
              <ProviderPicker
                providers={providers}
                onPick={addConnection}
                {...(settings.connections.length > 0 ? { onCancel: () => setAdding(false) } : {})}
              />
            ) : (
              <ConnectionDetail
                key={selected.id}
                connection={selected}
                secrets={secrets}
                storageNote={storageNote}
                onChange={updateConnection}
                onRemove={() => void removeConnection(selected)}
              />
            )}

            <PurposeAssignments settings={settings} onChange={commit} />

            <ModelRoutingSettings key={settings.connections.map((c) => c.id).join("|")} />

            <DiagnosticsSection settings={settings} />
          </section>
        </div>
      </div>
    </div>
  );
}

// ── Adding a provider ───────────────────────────────────────────────────────

function ProviderPicker({
  providers,
  onPick,
  onCancel,
}: {
  providers: readonly ProviderDescriptor[];
  onPick: (descriptor: ProviderDescriptor) => void;
  /** Absent when there is nothing to go back to. */
  onCancel?: () => void;
}) {
  return (
    <div className="providers__picker">
      <h3>Add a provider</h3>
      {onCancel === undefined && (
        <p className="hint">
          Manu works without a model — every deterministic check, the Story Build and the debugger
          all run with nothing configured. A provider enables the parts that need one.
        </p>
      )}
      <ul>
        {providers.map((descriptor) => (
          <li key={descriptor.id}>
            <button className="providers__option" onClick={() => onPick(descriptor)}>
              <span className="providers__option-name">
                {descriptor.displayName}
                {descriptor.local && <span className="badge badge--local">Local</span>}
              </span>
              <span className="providers__option-summary">{descriptor.summary}</span>
              <span className="providers__option-meta">
                {descriptor.auth === "none" ? "No credentials needed" : "Needs an API key"}
                {descriptor.supportsDiscovery ? " · Lists its own models" : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {/*
        Said once, plainly, where somebody would otherwise assume otherwise.
        A consumer subscription is not API access at any provider Manu supports,
        and pretending otherwise would waste an evening of somebody's time.
      */}
      <p className="hint">
        These are API connections, billed per use by the provider. A ChatGPT Plus or Claude Pro
        subscription is separate and does not include API access. Local providers cost nothing and
        need no account.
      </p>
      {onCancel !== undefined && (
        <button className="btn btn--ghost btn--small" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}

// ── One connection ──────────────────────────────────────────────────────────

function ConnectionDetail({
  connection,
  secrets,
  storageNote,
  onChange,
  onRemove,
}: {
  connection: ProviderConnection;
  secrets: SecretStore;
  storageNote: string;
  onChange: (next: ProviderConnection) => void;
  onRemove: () => void;
}) {
  const descriptor = describeProvider(connection.providerId);
  const [apiKey, setApiKey] = useState("");
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshKeyState = useCallback(async () => {
    const stored = await secrets.get(secretKeyForConnection(connection.id));
    setHasStoredKey(stored !== null && stored !== "");
  }, [secrets, connection.id]);

  useEffect(() => {
    void refreshKeyState();
  }, [refreshKeyState]);

  if (descriptor === undefined) {
    return (
      <div>
        <p className="status status--error">
          This build has no adapter for &ldquo;{connection.providerId}&rdquo;. The connection is
          kept so nothing is lost, but it cannot be used.
        </p>
        <button className="btn btn--danger btn--small" onClick={onRemove}>
          Remove connection
        </button>
      </div>
    );
  }

  const scopeWarning =
    connection.baseUrl === undefined ? null : outOfScopeReason(connection.baseUrl);
  const models = modelsFor(connection);

  async function saveKey() {
    const value = apiKey.trim();
    if (value === "") return;
    setBusy(true);
    try {
      await secrets.set(secretKeyForConnection(connection.id), value);
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
      await secrets.delete(secretKeyForConnection(connection.id));
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
      const result = await testConnection(connection, secrets);
      setStatus({
        ok: result.ok,
        message: result.message,
        ...(result.detail === undefined ? {} : { detail: result.detail }),
      });
    } finally {
      setBusy(false);
    }
  }

  async function refreshModels() {
    setBusy(true);
    setStatus(null);
    try {
      const discovered = await discoverModels(connection, secrets);
      onChange({
        ...connection,
        models: discovered,
        modelsRefreshedAt: new Date().toISOString(),
      });
      setStatus({
        ok: true,
        message:
          discovered.length === 0
            ? "The provider reported no models."
            : `Found ${String(discovered.length)} model(s).`,
      });
    } catch (error) {
      setStatus({
        ok: false,
        message: explainModelError(error),
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="providers__form">
      <h3>
        {descriptor.displayName}
        {descriptor.local && <span className="badge badge--local">Local</span>}
      </h3>
      <p className="hint">{descriptor.summary}</p>

      <label className="field">
        <span>Name</span>
        <input
          value={connection.label}
          onChange={(e) => onChange({ ...connection, label: e.target.value })}
          placeholder={descriptor.displayName}
          disabled={busy}
        />
      </label>

      {descriptor.configurableBaseUrl && (
        <>
          <label className="field">
            <span>Address</span>
            <input
              value={connection.baseUrl ?? ""}
              onChange={(e) => onChange({ ...connection, baseUrl: e.target.value })}
              placeholder={descriptor.defaultBaseUrl ?? "http://localhost:11434"}
              disabled={busy}
            />
          </label>
          <p className="hint">
            A model server on another machine is fine — put its address here, not just
            <code> localhost</code>.
          </p>
          {scopeWarning !== null && <p className="status status--warn">{scopeWarning}</p>}
        </>
      )}

      {descriptor.auth === "api_key" ? (
        <>
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
            {descriptor.credentialsUrl !== undefined && (
              <>
                {" "}
                Keys come from <code>{descriptor.credentialsUrl}</code>.
              </>
            )}
          </p>
        </>
      ) : (
        <p className="hint">
          This provider needs no credentials, and Manu does not ask for a placeholder one.
        </p>
      )}

      <div className="modal__actions">
        {descriptor.auth === "api_key" && (
          <>
            <button
              className="btn btn--primary"
              onClick={() => void saveKey()}
              disabled={busy || apiKey.trim() === ""}
            >
              Save key
            </button>
            <button
              className="btn btn--small"
              onClick={() => void clearKey()}
              disabled={busy || !hasStoredKey}
            >
              Remove key
            </button>
          </>
        )}
        <button className="btn" onClick={() => void runTest()} disabled={busy}>
          Test connection
        </button>
        {descriptor.supportsDiscovery && (
          <button className="btn" onClick={() => void refreshModels()} disabled={busy}>
            Refresh models
          </button>
        )}
        <button className="btn btn--danger btn--small" onClick={onRemove} disabled={busy}>
          Remove connection
        </button>
      </div>

      {status !== null && (
        <>
          <p className={`status${status.ok ? " status--ok" : " status--error"}`}>
            {status.message}
          </p>
          {status.detail !== undefined && status.detail !== status.message && (
            <p className="hint">
              <button
                className="btn btn--ghost btn--small"
                onClick={() => setShowDetail(!showDetail)}
              >
                {showDetail ? "Hide technical detail" : "Show technical detail"}
              </button>
              {showDetail && <code className="providers__detail-text">{status.detail}</code>}
            </p>
          )}
        </>
      )}

      <ModelList models={models} refreshedAt={connection.modelsRefreshedAt} />
    </div>
  );
}

const CAPABILITY_LABEL: Readonly<Record<keyof ModelCapabilities, string>> = {
  streaming: "streaming",
  structuredOutput: "structured output",
  tools: "tools",
};

function ModelList({
  models,
  refreshedAt,
}: {
  models: readonly ModelDescriptor[];
  refreshedAt?: string;
}) {
  if (models.length === 0) {
    return <p className="hint">No models known yet — test the connection or refresh the list.</p>;
  }
  return (
    <div className="providers__models">
      <h4>
        Models{" "}
        {refreshedAt !== undefined && (
          <span className="hint">(listed {new Date(refreshedAt).toLocaleString()})</span>
        )}
      </h4>
      <ul>
        {models.map((model) => (
          <li key={model.modelId}>
            <span className="providers__model-name">{model.displayName}</span>
            <span className="providers__model-caps">
              {(["tools", "structuredOutput", "streaming"] as const).map((capability) => {
                const state = capabilityState(model, capability);
                return (
                  <span key={capability} className={`badge badge--${state}`}>
                    {CAPABILITY_LABEL[capability]}
                    {state === "unknown" ? "?" : state === "no" ? " ✕" : ""}
                  </span>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
      {models.some((model) => (model.unknownCapabilities?.length ?? 0) > 0) && (
        <p className="hint">
          A <code>?</code> means nobody has said. Local servers report a model&rsquo;s name and not
          much else, so Manu will try rather than refuse — and tell you if it does not work.
        </p>
      )}
    </div>
  );
}

// ── Which model does what ───────────────────────────────────────────────────

function PurposeAssignments({
  settings,
  onChange,
}: {
  settings: AiSettings;
  onChange: (next: AiSettings) => void;
}) {
  const options = useMemo(
    () =>
      settings.connections.flatMap((connection) =>
        modelsFor(connection).map((model) => ({
          value: `${connection.id}|${model.modelId}`,
          label: `${connection.label} — ${model.displayName}`,
        })),
      ),
    [settings.connections],
  );

  if (options.length === 0) return null;

  function set(purpose: ModelPurpose, value: string) {
    const purposes = { ...settings.purposes };
    if (value === "") delete purposes[purpose];
    else {
      // Split on the first separator only: a model id may contain almost
      // anything, but a connection id is minted here and never contains "|".
      const cut = value.indexOf("|");
      purposes[purpose] = { connectionId: value.slice(0, cut), modelId: value.slice(cut + 1) };
    }
    onChange({ ...settings, purposes });
  }

  return (
    <section className="providers__purposes">
      <h3>Which model does what</h3>
      <p className="hint">
        Different work wants different models. Anything left unset uses the default, so setting one
        model is enough to get started.
      </p>
      {MODEL_PURPOSES.map((purpose) => {
        const choice = settings.purposes[purpose];
        return (
          <div className="providers__purpose" key={purpose}>
            <label className="field">
              <span>{PURPOSE_LABEL[purpose]}</span>
              <select
                value={choice === undefined ? "" : `${choice.connectionId}|${choice.modelId}`}
                onChange={(e) => set(purpose, e.target.value)}
              >
                <option value="">{purpose === "default" ? "Not set" : "Use the default"}</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">{PURPOSE_HINT[purpose]}</p>
          </div>
        );
      })}
    </section>
  );
}

// ── Diagnostics (Phase 46 §8, §32) ──────────────────────────────────────────

/**
 * "Export diagnostics": everything a bug report needs — app version, OS,
 * redacted logs, provider metadata without keys, the update channel — and a
 * place to say what happened and what was expected. Nothing leaves the
 * machine unless the writer sends the file themselves; manuscript text is
 * excluded by construction.
 */
function DiagnosticsSection({ settings }: { settings: AiSettings }) {
  const [whatHappened, setWhatHappened] = useState("");
  const [whatWasExpected, setWhatWasExpected] = useState("");
  const [channel, setChannel] = useState<UpdateChannel>(loadUpdateChannel);
  const [note, setNote] = useState<string | null>(null);

  async function exportBundle() {
    try {
      if (!isTauri()) {
        setNote("Exporting diagnostics needs the desktop application.");
        return;
      }
      const bundle = buildDiagnosticsBundle({
        appVersion: APP_FORMAT_VERSION,
        providers: settings.connections.map((connection) => ({
          providerId: connection.providerId,
          models: (connection.models ?? []).map((model) => model.modelId),
        })),
        whatHappened,
        whatWasExpected,
      });
      const path = await pickSaveFile(
        "Export diagnostics",
        `manu-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
        "json",
      );
      if (path === null) return;
      await writeExternalFile(path, new TextEncoder().encode(renderDiagnostics(bundle)));
      setNote("Diagnostics exported. The file contains no manuscript text and no keys.");
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section className="providers__purposes">
      <h3>Diagnostics &amp; updates</h3>
      <p className="hint">
        Manu keeps a local, redacted activity log — no manuscript text, no keys, and nothing is ever
        sent anywhere by itself. To report a problem, describe it here and export the bundle.
      </p>
      <label className="field">
        <span>What happened</span>
        <textarea rows={2} value={whatHappened} onChange={(e) => setWhatHappened(e.target.value)} />
      </label>
      <label className="field">
        <span>What you expected</span>
        <textarea
          rows={2}
          value={whatWasExpected}
          onChange={(e) => setWhatWasExpected(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Update channel</span>
        <select
          value={channel}
          onChange={(e) => {
            const next = e.target.value as UpdateChannel;
            saveUpdateChannel(next);
            setChannel(next);
          }}
        >
          <option value="stable">Stable — releases only (default)</option>
          <option value="beta">Beta — release candidates</option>
          <option value="alpha">Alpha — development builds</option>
        </select>
      </label>
      <div className="mapping__actions">
        <button className="btn" onClick={() => void exportBundle()}>
          Export diagnostics…
        </button>
      </div>
      {note !== null && <p className="status">{note}</p>}
    </section>
  );
}
