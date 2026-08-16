import { useCallback, useEffect, useState } from "react";
import type { CatalogueEntry, ExtensionDetails, InstalledExtension } from "@jellytind/extensions";
import type { ExtensionsRuntime } from "../lib/extensions-runtime";
import { pickManuscriptFile, readExternalFile } from "../lib/external-files";
import { isTauri } from "../tauri";

interface Props {
  runtime: ExtensionsRuntime | null;
  refreshToken: number;
  onChanged: () => void;
}

/**
 * Extensions (Phase 45 §15): installed, available, updates — kept well away
 * from the writing experience. Every install shows what the package is, who
 * made it, whether its authorship is verified, and exactly what it may
 * touch, before anything is approved.
 */
export function ExtensionsPanel({ runtime, refreshToken, onChanged }: Props) {
  const [installed, setInstalled] = useState<readonly InstalledExtension[]>([]);
  const [available, setAvailable] = useState<readonly CatalogueEntry[]>([]);
  const [updates, setUpdates] = useState<readonly CatalogueEntry[]>([]);
  const [missing, setMissing] = useState<{
    required: readonly string[];
    recommended: readonly string[];
  }>({
    required: [],
    recommended: [],
  });
  const [details, setDetails] = useState<{ raw: string; details: ExtensionDetails } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (runtime === null) return;
    setInstalled(await runtime.manager.installed());
    setAvailable(await runtime.manager.available(runtime.catalogue));
    setUpdates(await runtime.manager.updates(runtime.catalogue));
    setMissing(await runtime.manager.missing());
  }, [runtime]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  async function guarded(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      if (runtime !== null) {
        const notes = await runtime.syncContributions();
        if (notes.length > 0) setNotice(notes.join(" "));
      }
      await reload();
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
          <h3>Extensions</h3>
          <p className="placeholder">Loading…</p>
        </section>
      </div>
    );
  }

  async function inspectRaw(raw: string) {
    setError(null);
    try {
      setDetails({ raw, details: runtime!.manager.inspect(raw) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function inspectFromCatalogue(id: string) {
    setBusy(true);
    try {
      await inspectRaw(await runtime!.catalogue.fetch(id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function inspectFromFile() {
    if (!isTauri()) {
      setError("Installing from a file needs the desktop application.");
      return;
    }
    const path = await pickManuscriptFile();
    if (path === null) return;
    await inspectRaw(new TextDecoder().decode(await readExternalFile(path)));
  }

  const trustLine = (trust: string) =>
    trust === "trusted"
      ? "Verified first-party package."
      : trust === "unsigned"
        ? "Community package — content intact, authorship unverified."
        : "Fails integrity verification.";

  return (
    <div className="state extensions">
      <section className="state__section">
        <h3>Extensions</h3>
        <p className="hint">
          Agents, skills, genre packs and tools — inspected before they install, approved before
          they touch anything, versioned so an update can roll back, removable without losing a word
          of your project.
        </p>
        {error !== null && <p className="status status--error">{error}</p>}
        {notice !== null && <p className="status status--ok">{notice}</p>}
        {missing.required.length > 0 && (
          <p className="status status--warn">
            This project requires extensions that are not installed: {missing.required.join(", ")}.
          </p>
        )}
        {missing.recommended.length > 0 && (
          <p className="hint">Recommended by this project: {missing.recommended.join(", ")}.</p>
        )}
        <div className="mapping__actions">
          <button className="btn" disabled={busy} onClick={() => void inspectFromFile()}>
            Install from file…
          </button>
        </div>
      </section>

      {details !== null && (
        <section className="state__section plugin">
          <h3>{details.details.manifest.name}</h3>
          <p className="hint">
            {details.details.manifest.description} — {details.details.manifest.author}, version{" "}
            {details.details.manifest.version} ·{" "}
            {details.details.manifest.category.replace(/_/g, " ")}
          </p>
          <p className={details.details.trust === "invalid" ? "status status--error" : "hint"}>
            {trustLine(details.details.trust)}
          </p>
          <p className="plugin__perms">
            Asks for:{" "}
            {details.details.manifest.permissions.length === 0
              ? "nothing"
              : details.details.manifest.permissions.join(", ")}
          </p>
          {details.details.manifest.dependencies.length > 0 && (
            <p className="plugin__perms">
              Depends on: {details.details.manifest.dependencies.map((held) => held.id).join(", ")}
            </p>
          )}
          <p className="hint">It adds:</p>
          <ul>
            {details.details.adds.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {details.details.problems.map((problem) => (
            <p key={problem} className="status status--error">
              {problem}
            </p>
          ))}
          {details.details.warnings.map((warning) => (
            <p key={warning} className="status status--warn">
              {warning}
            </p>
          ))}
          <div className="mapping__actions">
            {details.details.problems.length === 0 && (
              <button
                className="btn btn--primary"
                disabled={busy}
                onClick={() =>
                  void guarded(async () => {
                    const isUpdate = installed.some(
                      (held) => held.manifest.id === details.details.manifest.id,
                    );
                    if (isUpdate) await runtime.manager.update(details.raw, { approve: true });
                    else await runtime.manager.install(details.raw, { approve: true });
                    setDetails(null);
                  })
                }
              >
                Approve permissions &{" "}
                {installed.some((held) => held.manifest.id === details.details.manifest.id)
                  ? "update"
                  : "install"}
              </button>
            )}
            <button className="btn btn--ghost" onClick={() => setDetails(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {updates.length > 0 && (
        <section className="state__section">
          <h3>Updates</h3>
          {updates.map((entry) => (
            <div key={entry.id} className="studio__row">
              <div>
                <strong>{entry.name}</strong>{" "}
                <span className="hint">
                  {installed.find((held) => held.manifest.id === entry.id)?.manifest.version} →{" "}
                  {entry.version}
                </span>
              </div>
              <button
                className="btn btn--small"
                disabled={busy}
                onClick={() => void inspectFromCatalogue(entry.id)}
              >
                Review update…
              </button>
            </div>
          ))}
        </section>
      )}

      {installed.length > 0 && (
        <section className="state__section">
          <h3>Installed</h3>
          {installed.map((extension) => (
            <div key={extension.manifest.id} className="studio__row">
              <div>
                <strong>{extension.manifest.name}</strong>{" "}
                <span className="hint">
                  {extension.manifest.version} · {extension.manifest.author} ·{" "}
                  {extension.trust === "trusted" ? "verified" : extension.trust}
                  {!extension.enabled ? " · disabled" : ""}
                </span>
                <p className="hint">{extension.manifest.description}</p>
              </div>
              <div className="mapping__actions">
                <button
                  className="btn btn--small"
                  disabled={busy}
                  onClick={() =>
                    void guarded(() =>
                      runtime.manager.setEnabled(extension.manifest.id, !extension.enabled),
                    )
                  }
                >
                  {extension.enabled ? "Disable" : "Enable"}
                </button>
                {extension.previousVersion !== undefined && (
                  <button
                    className="btn btn--ghost btn--small"
                    disabled={busy}
                    onClick={() =>
                      void guarded(async () => {
                        await runtime.manager.rollback(extension.manifest.id);
                        setNotice(`${extension.manifest.name} rolled back.`);
                      })
                    }
                  >
                    Roll back to {extension.previousVersion}
                  </button>
                )}
                <button
                  className="btn btn--ghost btn--small"
                  disabled={busy}
                  onClick={() => void guarded(() => runtime.manager.remove(extension.manifest.id))}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {available.length > 0 && (
        <section className="state__section">
          <h3>Available</h3>
          {available.map((entry) => (
            <div key={entry.id} className="studio__row">
              <div>
                <strong>{entry.name}</strong>{" "}
                <span className="hint">
                  {entry.version} · {entry.category.replace(/_/g, " ")}
                  {entry.featured === true ? " · featured" : ""}
                </span>
                <p className="hint">{entry.description}</p>
              </div>
              <button
                className="btn btn--small"
                disabled={busy}
                onClick={() => void inspectFromCatalogue(entry.id)}
              >
                Details…
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
