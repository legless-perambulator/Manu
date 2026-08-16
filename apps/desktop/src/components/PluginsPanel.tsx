import { useEffect, useState } from "react";
import {
  PROTOCOL_VERSION,
  WRITING_STATISTICS_PLUGIN,
  validateManifest,
  type InstalledPlugin,
  type SettingSpec,
  type ToolCallOutcome,
} from "@jellytind/plugin-protocol";
import { pickManuscriptFile, readExternalFile } from "../lib/external-files";
import { reportLines, type PluginRuntime } from "../lib/plugins";
import { isTauri } from "../tauri";

interface Props {
  runtime: PluginRuntime | null;
  refreshToken: number;
  /** Rebuild the command set after enable/disable, so /commands follow. */
  onChanged: () => void;
}

/**
 * Plugins (Phase 42 §16–§19, §22).
 *
 * Install from a file, see exactly what a plugin asked for — including every
 * network host — before enabling it, disable or remove it cleanly, and read
 * why a broken one failed without it taking Manu down. Developer Mode adds
 * reload, logs, manifest validation and a contributions inspector, kept away
 * from the ordinary writing surfaces.
 */
export function PluginsPanel({ runtime, refreshToken, onChanged }: Props) {
  const [plugins, setPlugins] = useState<readonly InstalledPlugin[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [developer, setDeveloper] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [reports, setReports] = useState<Record<string, readonly string[]>>({});

  const refresh = () => setPlugins(runtime?.host.plugins() ?? []);

  useEffect(() => {
    setPlugins(runtime?.host.plugins() ?? []);
  }, [runtime, refreshToken]);

  async function guarded(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      refresh();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (runtime === null) {
    return (
      <div className="state">
        <section className="state__section">
          <h3>Plugins</h3>
          <p className="placeholder">Loading the plugin runtime…</p>
        </section>
      </div>
    );
  }

  async function installFromFile() {
    await guarded(async () => {
      if (!isTauri()) throw new Error("Installing plugins needs the desktop application.");
      const path = await pickManuscriptFile();
      if (path === null) return;
      const raw = new TextDecoder().decode(await readExternalFile(path));
      const result = await runtime?.installFromText(raw);
      if (result !== undefined && !result.ok) {
        throw new Error(result.errors[0] ?? "The plugin could not be installed.");
      }
      setNotice("Plugin installed. Review its permissions, then enable it.");
    });
  }

  async function installReference() {
    await guarded(async () => {
      const result = await runtime?.installFromText(JSON.stringify(WRITING_STATISTICS_PLUGIN));
      if (result !== undefined && !result.ok) {
        throw new Error(result.errors[0] ?? "Could not install.");
      }
      setNotice("Writing Statistics installed. Enable it to get /writing-stats.");
    });
  }

  async function runPanelTool(plugin: InstalledPlugin, tool: string) {
    await guarded(async () => {
      const outcome: ToolCallOutcome = await runtime!.host.callTool(plugin.manifest.id, tool, {});
      setReports((held) => ({ ...held, [`${plugin.manifest.id}:${tool}`]: reportLines(outcome) }));
      if (!outcome.ok) throw new Error(outcome.error);
    });
  }

  return (
    <div className="state pluginspanel">
      <section className="state__section">
        <h3>Plugins</h3>
        <p className="hint">
          Extensions contribute tools, commands, rules and views through a versioned, permissioned
          protocol (protocol {PROTOCOL_VERSION}). A plugin only ever receives what its manifest
          asked for and you granted — and a broken one fails alone.
        </p>
        {error !== null && <p className="status status--error">{error}</p>}
        {notice !== null && <p className="status status--ok">{notice}</p>}
        <div className="mapping__actions">
          <button
            className="btn btn--primary"
            disabled={busy}
            onClick={() => void installFromFile()}
          >
            Install plugin from file…
          </button>
          {!plugins.some((held) => held.manifest.id === WRITING_STATISTICS_PLUGIN.id) && (
            <button className="btn" disabled={busy} onClick={() => void installReference()}>
              Add Writing Statistics
            </button>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={developer}
              onChange={(event) => setDeveloper(event.target.checked)}
            />
            Developer Mode
          </label>
        </div>
      </section>

      {plugins.map((plugin) => {
        const hosts = plugin.manifest.permissions
          .filter((held) => held.startsWith("network:"))
          .map((held) => held.slice("network:".length));
        const panels = plugin.manifest.contributes.panels ?? [];
        return (
          <section key={plugin.manifest.id} className="state__section plugin">
            <div className="plugin__head">
              <div>
                <strong>{plugin.manifest.name}</strong>{" "}
                <span className="hint">
                  {plugin.manifest.version} · {plugin.manifest.id}
                </span>
                {plugin.manifest.description !== undefined && (
                  <p className="hint">{plugin.manifest.description}</p>
                )}
              </div>
              <div className="mapping__actions">
                {plugin.enabled ? (
                  <button
                    className="btn btn--small"
                    disabled={busy}
                    onClick={() =>
                      void guarded(() => runtime.setEnabled(plugin.manifest.id, false))
                    }
                  >
                    Disable
                  </button>
                ) : (
                  <button
                    className="btn btn--primary btn--small"
                    disabled={busy}
                    onClick={() => void guarded(() => runtime.setEnabled(plugin.manifest.id, true))}
                  >
                    Enable
                  </button>
                )}
                <button
                  className="btn btn--ghost btn--small"
                  disabled={busy}
                  onClick={() => void guarded(() => runtime.removePlugin(plugin.manifest.id))}
                >
                  Remove
                </button>
              </div>
            </div>

            <p className="plugin__perms">
              Asks for:{" "}
              {plugin.manifest.permissions.length === 0
                ? "nothing"
                : plugin.manifest.permissions.map((held) => held.replace(/_/g, " ")).join(", ")}
            </p>
            {hosts.length > 0 && (
              <p className="plugin__perms">This plugin requests access to: {hosts.join(", ")}</p>
            )}
            {plugin.warnings.map((warning, index) => (
              <p key={index} className="status status--warn">
                {warning}
              </p>
            ))}
            {plugin.error !== undefined && (
              <div className="plugin__error">
                <p className="status status--error">{plugin.manifest.name} failed.</p>
                <div className="mapping__actions">
                  <button
                    className="btn btn--ghost btn--small"
                    onClick={() =>
                      setOpenError(openError === plugin.manifest.id ? null : plugin.manifest.id)
                    }
                  >
                    View error
                  </button>
                  <button
                    className="btn btn--small"
                    disabled={busy}
                    onClick={() =>
                      void guarded(() => runtime.setEnabled(plugin.manifest.id, false))
                    }
                  >
                    Disable
                  </button>
                </div>
                {openError === plugin.manifest.id && (
                  <pre className="universe__context">{plugin.error}</pre>
                )}
              </div>
            )}

            {plugin.enabled &&
              panels.map((panel) => (
                <div key={panel.id} className="plugin__panel">
                  <div className="plugin__head">
                    <span>{panel.title}</span>
                    <button
                      className="btn btn--small"
                      disabled={busy}
                      onClick={() => void runPanelTool(plugin, panel.rendering.tool)}
                    >
                      Run
                    </button>
                  </div>
                  {(reports[`${plugin.manifest.id}:${panel.rendering.tool}`] ?? []).map(
                    (line, index) => (
                      <div key={index} className="term__text">
                        {line}
                      </div>
                    ),
                  )}
                </div>
              ))}

            {plugin.enabled && (plugin.manifest.contributes.settings ?? []).length > 0 && (
              <div className="plugin__settings">
                <button
                  className="btn btn--ghost btn--small"
                  onClick={() =>
                    void guarded(async () => {
                      if (settingsFor === plugin.manifest.id) {
                        setSettingsFor(null);
                        return;
                      }
                      setSettings(await runtime.readSettings(plugin.manifest.id));
                      setSettingsFor(plugin.manifest.id);
                    })
                  }
                >
                  Settings
                </button>
                {settingsFor === plugin.manifest.id &&
                  (plugin.manifest.contributes.settings ?? []).map((spec: SettingSpec) => (
                    <label key={spec.key} className="field">
                      <span>{spec.label}</span>
                      {spec.kind === "boolean" ? (
                        <input
                          type="checkbox"
                          checked={Boolean(settings[spec.key] ?? spec.defaultValue ?? false)}
                          onChange={(event) =>
                            void guarded(async () => {
                              const next = { ...settings, [spec.key]: event.target.checked };
                              setSettings(next);
                              await runtime.writeSettings(plugin.manifest.id, next);
                            })
                          }
                        />
                      ) : spec.kind === "choice" ? (
                        <select
                          value={String(settings[spec.key] ?? spec.defaultValue ?? "")}
                          onChange={(event) =>
                            void guarded(async () => {
                              const next = { ...settings, [spec.key]: event.target.value };
                              setSettings(next);
                              await runtime.writeSettings(plugin.manifest.id, next);
                            })
                          }
                        >
                          {(spec.choices ?? []).map((choice) => (
                            <option key={choice} value={choice}>
                              {choice}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={String(settings[spec.key] ?? spec.defaultValue ?? "")}
                          onChange={(event) =>
                            void guarded(async () => {
                              const raw = event.target.value;
                              const next = {
                                ...settings,
                                [spec.key]: spec.kind === "number" ? Number(raw) : raw,
                              };
                              setSettings(next);
                              await runtime.writeSettings(plugin.manifest.id, next);
                            })
                          }
                        />
                      )}
                    </label>
                  ))}
              </div>
            )}

            {developer && (
              <div className="plugin__dev">
                <p className="hint">
                  Contributions: {(plugin.manifest.contributes.tools ?? []).length} tool(s),{" "}
                  {(plugin.manifest.contributes.commands ?? []).length} command(s),{" "}
                  {(plugin.manifest.contributes.compilerRules ?? []).length} rule(s),{" "}
                  {(plugin.manifest.contributes.panels ?? []).length} panel(s),{" "}
                  {(plugin.manifest.contributes.skills ?? []).length} skill(s).
                </p>
                <button
                  className="btn btn--ghost btn--small"
                  onClick={() => {
                    const result = validateManifest(plugin.manifest);
                    setNotice(
                      result.ok
                        ? `${plugin.manifest.name}: manifest valid${
                            result.warnings.length > 0
                              ? ` (${result.warnings.length} warning(s))`
                              : ""
                          }.`
                        : `${plugin.manifest.name}: ${result.errors[0] ?? "invalid"}`,
                    );
                  }}
                >
                  Validate manifest
                </button>
              </div>
            )}
          </section>
        );
      })}
      {plugins.length === 0 && (
        <section className="state__section">
          <p className="placeholder">No plugins installed. This is a perfectly good state.</p>
        </section>
      )}

      {developer && (
        <section className="state__section">
          <h3>Developer Mode</h3>
          <div className="mapping__actions">
            <button
              className="btn btn--small"
              disabled={busy}
              onClick={() => void guarded(() => runtime.reload())}
            >
              Reload plugins
            </button>
          </div>
          <pre className="universe__context">
            {runtime.host.logs().slice(-40).join("\n") || "No plugin activity yet."}
          </pre>
        </section>
      )}
    </div>
  );
}
