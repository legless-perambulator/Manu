import { useCallback, useEffect, useState } from "react";
import type { Branch, BranchId } from "@jellytind/domain";
import {
  BranchStore,
  compareBranches,
  createBranch,
  deleteBranch,
  mergeBranch,
  type BranchComparison,
  type MergeResult,
} from "@jellytind/story-repository";
import type { ProjectSession } from "../repo/session";

interface Props {
  session: ProjectSession;
  onSwitch: (branchId: BranchId) => void;
  onChanged: () => void;
  /** A name handed in from outside — `/branch darker-ending` (Phase 39). */
  seedName?: string;
}

/**
 * Alternative versions of the story.
 *
 * Deliberately not called "branches" in the interface. A novelist exploring a
 * darker ending is doing something they already understand; they should not
 * have to learn version control to do it. The word Branch appears only in the
 * stable ID, where an advanced user will recognise it.
 */
export function VersionsPanel({ session, onSwitch, onChanged, seedName }: Props) {
  const [versions, setVersions] = useState<Branch[]>([]);
  const [name, setName] = useState("");

  // The terminal pre-fills the name; creating the version is still a click.
  useEffect(() => {
    if (seedName !== undefined && seedName !== "") setName(seedName);
  }, [seedName]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [comparison, setComparison] = useState<BranchComparison | null>(null);
  const [merge, setMerge] = useState<MergeResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BranchId | null>(null);

  const reload = useCallback(async () => {
    setVersions(await new BranchStore(session.store).list());
  }, [session.store]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(what: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await what();
      if (message !== null) setNotice(message);
      await reload();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const current = session.branch;
  const main = versions.find((v) => v.parentBranchId === undefined);

  return (
    <div className="state">
      <section className="state__section">
        <h3>Current version</h3>
        <div className="state__card">
          <div className="state__card-head">
            <strong>{current.name}</strong>
            <span className="ctx__id">{current.id}</span>
          </div>
          {current.description !== undefined && (
            <div className="ctx__why">{current.description}</div>
          )}
          <div className="ctx__why">
            Everything you write, build and test happens here. The other versions are untouched.
          </div>
        </div>
      </section>

      <section className="state__section">
        <h3>Create version</h3>
        <div className="field">
          <span>Name</span>
          <input
            value={name}
            placeholder="darker-ending"
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="field">
          <span>What is it for</span>
          <input
            value={description}
            placeholder="Marcus survives Chapter 28."
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
          />
        </div>
        <button
          className="btn btn--primary btn--small"
          disabled={busy || name.trim() === ""}
          onClick={() =>
            void run(async () => {
              const branch = await createBranch(session.store, {
                name,
                ...(description.trim() !== "" ? { description } : {}),
              });
              setName("");
              setDescription("");
              return `Created "${branch.name}" from ${current.name}. Nothing has changed yet — switch to it to work there.`;
            })
          }
        >
          Create from {current.name}
        </button>
        <p className="hint">
          A new version starts as an exact copy. Making it different is your next move, not this
          button&rsquo;s.
        </p>
      </section>

      <section className="state__section">
        <h3>Alternative versions</h3>
        {versions.length <= 1 ? (
          <p className="hint">
            Only {main?.name ?? "main"} so far. A version lets you try an ending without risking the
            one you have.
          </p>
        ) : (
          <ul className="state__transitions">
            {versions.map((version) => (
              <li key={version.id} className="state__card">
                <div className="state__card-head">
                  <strong>{version.name}</strong>
                  {version.id === current.id && (
                    <span className="badge badge--running">current</span>
                  )}
                  {version.parentBranchId === undefined && <span className="badge">main</span>}
                  <span className="ctx__id">{version.id}</span>
                </div>
                {version.description !== undefined && (
                  <div className="ctx__why">{version.description}</div>
                )}
                <div className="state__actions">
                  <button
                    className="btn btn--small"
                    disabled={busy || version.id === current.id}
                    onClick={() => onSwitch(version.id)}
                  >
                    Switch to
                  </button>
                  <button
                    className="btn btn--small"
                    disabled={busy || version.id === current.id}
                    onClick={() =>
                      void run(async () => {
                        setMerge(null);
                        setComparison(await compareBranches(session.store, version.id, current.id));
                        return null;
                      })
                    }
                  >
                    Compare
                  </button>
                  <button
                    className="btn btn--small"
                    disabled={busy || version.id === current.id}
                    onClick={() =>
                      void run(async () => {
                        setComparison(null);
                        const result = await mergeBranch(session.store, version.id, current.id);
                        setMerge(result);
                        return result.summary;
                      })
                    }
                  >
                    Merge into {current.name}
                  </button>
                  {version.parentBranchId !== undefined && version.id !== current.id && (
                    <button
                      className="btn btn--small btn--danger"
                      disabled={busy}
                      onClick={() => setConfirmDelete(version.id)}
                    >
                      Delete…
                    </button>
                  )}
                </div>

                {confirmDelete === version.id && (
                  <div className="inspector__danger">
                    Delete &ldquo;{version.name}&rdquo;? Everything written only on this version is
                    lost, and there is no undo.
                    <div className="state__actions">
                      <button
                        className="btn btn--small btn--danger"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const removed = await deleteBranch(session.store, version.id);
                            setConfirmDelete(null);
                            return `Deleted "${removed.name}".`;
                          })
                        }
                      >
                        Delete permanently
                      </button>
                      <button className="btn btn--small" onClick={() => setConfirmDelete(null)}>
                        Keep it
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {error !== null && (
        <p className="status status--error" role="alert">
          {error}
        </p>
      )}
      {notice !== null && <p className="status">{notice}</p>}

      {merge !== null && merge.conflicts.length > 0 && (
        <section className="state__section">
          <h3>Needs your decision</h3>
          <p className="hint">
            Fiction does not merge the way code does. These were changed in both versions, so only
            you can say which sentences survive. Nothing has been merged.
          </p>
          <ul className="state__knowledge">
            {merge.conflicts.map((conflict) => (
              <li key={conflict.path} className="ctx--warning">
                <span className="ctx__id">{conflict.path}</span>
                <span className="ctx__why"> {conflict.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {comparison !== null && (
        <section className="state__section">
          <h3>
            {comparison.from.name} → {comparison.to.name}
          </h3>
          <p className="ctx__why">{comparison.summary}</p>

          <h4 className="agent__label">Manuscript</h4>
          {comparison.manuscript.length === 0 ? (
            <p className="agent__empty">The prose is identical.</p>
          ) : (
            <ul className="state__knowledge">
              {comparison.manuscript.map((file) => (
                <li key={file.path}>
                  <span className="ctx__id">{file.path}</span>{" "}
                  <span className="badge badge--{file.change}">{file.change}</span>{" "}
                  <span className="diff__file-stat">
                    <span className="add">+{file.added}</span>{" "}
                    <span className="rem">−{file.removed}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h4 className="agent__label">Records</h4>
          {comparison.records.length === 0 ? (
            <p className="agent__empty">The structured story is identical.</p>
          ) : (
            <ul className="state__knowledge">
              {comparison.records.map((record) => (
                <li key={`${record.kind}-${record.id}`}>
                  <span className="badge">{record.change}</span> {record.kind} —{" "}
                  <strong>{record.label}</strong> <span className="ctx__id">{record.id}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="hint">
            Compared: {comparison.inspected.join(" · ")}. Anything not listed above is the same in
            both.
          </p>
        </section>
      )}
    </div>
  );
}
