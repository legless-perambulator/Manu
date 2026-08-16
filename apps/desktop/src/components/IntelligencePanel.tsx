import { useCallback, useEffect, useState } from "react";
import type {
  AutopilotSettings,
  AutopilotStatus,
  ConflictResolution,
  IntelProposal,
  IntelStatus,
  SyncEstimate,
} from "@jellytind/autopilot";
import type { IntelligenceRuntime } from "../lib/intelligence";

interface Props {
  runtime: IntelligenceRuntime | null;
  refreshToken: number;
  onChanged: () => void;
}

/**
 * Story Intelligence (Phase 44): the review inbox.
 *
 * The writer writes; this panel is where the map's maintenance surfaces.
 * Proposals arrive grouped — Needs Review, Conflicts, Auto-Applied,
 * Ignored — each one answering what changed, why Manu thinks so, and where
 * the evidence is. Nothing here ever edits prose.
 */

const GROUPS: ReadonlyArray<{ status: IntelStatus; label: string }> = [
  { status: "conflict", label: "Conflicts" },
  { status: "needs_review", label: "Needs review" },
  { status: "auto_applied", label: "Auto-applied" },
  { status: "ignored", label: "Ignored" },
];

export function IntelligencePanel({ runtime, refreshToken, onChanged }: Props) {
  const [status, setStatus] = useState<AutopilotStatus | null>(null);
  const [proposals, setProposals] = useState<readonly IntelProposal[]>([]);
  const [settings, setSettings] = useState<AutopilotSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<SyncEstimate | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (runtime === null) return;
    setStatus(runtime.pilot.status());
    setProposals(runtime.pilot.list());
    setSettings(runtime.pilot.getSettings());
  }, [runtime]);

  useEffect(() => {
    reload();
  }, [reload, refreshToken]);

  async function guarded(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      reload();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (runtime === null || settings === null) {
    return (
      <div className="state">
        <section className="state__section">
          <h3>Story Intelligence</h3>
          <p className="placeholder">Loading…</p>
        </section>
      </div>
    );
  }

  const decided = (proposal: IntelProposal) =>
    proposal.status === "accepted" || proposal.status === "rejected";

  return (
    <div className="state intel">
      <section className="state__section">
        <h3>Story Intelligence</h3>
        <p className="hint">
          You write the story; Manu maintains the map. Changes to the manuscript are analysed
          quietly in the background, and everything inferred lands here as a proposal with its
          evidence — never as silent canon, and never as a change to your prose.
        </p>
        {status !== null && (
          <p className="status">
            {status.label}
            {status.waiting !== undefined ? ` — ${status.waiting}` : ""}
          </p>
        )}
        {error !== null && <p className="status status--error">{error}</p>}

        <div className="mapping__actions">
          <button
            className="btn btn--small"
            disabled={busy}
            onClick={() => void guarded(() => runtime.drainNow())}
          >
            Sync now
          </button>
          <button
            className="btn btn--ghost btn--small"
            disabled={busy}
            onClick={() =>
              void guarded(async () => {
                setEstimate(await runtime.pilot.estimateSync({ all: true }));
              })
            }
          >
            Sync entire manuscript…
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.paused}
              onChange={(e) =>
                void guarded(() => runtime.pilot.configure({ paused: e.target.checked }))
              }
            />
            Pause background intelligence
          </label>
        </div>

        {estimate !== null && (
          <div className="intel__estimate">
            <p className="hint">
              A full sync analyses {estimate.scenes} scene(s) with about {estimate.semanticCalls}{" "}
              model calls
              {estimate.estimatedUsd !== undefined
                ? ` (~$${estimate.estimatedUsd.toFixed(2)})`
                : " (cost unknown — no pricing configured)"}
              .
            </p>
            <div className="mapping__actions">
              <button
                className="btn btn--small"
                disabled={busy}
                onClick={() =>
                  void guarded(async () => {
                    setEstimate(null);
                    await runtime.pilot.sync({ all: true });
                    await runtime.drainNow();
                  })
                }
              >
                Run full sync
              </button>
              <button className="btn btn--ghost btn--small" onClick={() => setEstimate(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <label className="field">
          <span>Confidence policy</span>
          <select
            value={settings.policy}
            onChange={(e) =>
              void guarded(() =>
                runtime.pilot.configure({
                  policy: e.target.value as AutopilotSettings["policy"],
                }),
              )
            }
          >
            <option value="conservative">Conservative — confirm most changes with me</option>
            <option value="balanced">
              Balanced — auto-apply high-confidence, low-risk changes
            </option>
            <option value="automatic">Automatic — apply more in the background, reversibly</option>
          </select>
        </label>
        <label className="field">
          <span>Monthly background budget (USD)</span>
          <input
            type="number"
            min={0}
            value={settings.monthlyBudgetUsd ?? ""}
            placeholder="No cap set"
            onChange={(e) =>
              void guarded(() =>
                runtime.pilot.configure(
                  e.target.value === ""
                    ? ({ monthlyBudgetUsd: undefined } as never)
                    : { monthlyBudgetUsd: Number(e.target.value) },
                ),
              )
            }
          />
        </label>
      </section>

      {GROUPS.map((group) => {
        const held = proposals.filter((proposal) => proposal.status === group.status);
        if (held.length === 0) return null;
        return (
          <section key={group.status} className="state__section">
            <h3>
              {group.label} <span className="hint">({held.length})</span>
            </h3>
            {held.map((proposal) => (
              <div key={proposal.id} className="intel__row">
                <div>
                  <strong>{proposal.summary}</strong>{" "}
                  <span className="hint">
                    {proposal.kind.replace(/_/g, " ")} · {proposal.confidence} confidence ·{" "}
                    {proposal.origin === "model" ? "model reading" : "deterministic"}
                  </span>
                  {proposal.conflictsWith !== undefined && (
                    <p className="status status--warn">Contradicts: {proposal.conflictsWith}</p>
                  )}
                  {open === proposal.id && (
                    <div className="intel__evidence">
                      <p className="hint">Why: {proposal.because}</p>
                      {proposal.evidence.map((evidence, index) => (
                        <p key={index} className="term__text">
                          {evidence.sceneTitle}
                          {evidence.quote !== undefined ? ` — “${evidence.quote}”` : ""}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mapping__actions">
                  <button
                    className="btn btn--ghost btn--small"
                    onClick={() => setOpen(open === proposal.id ? null : proposal.id)}
                  >
                    Evidence
                  </button>
                  {proposal.status === "needs_review" && (
                    <>
                      <button
                        className="btn btn--primary btn--small"
                        disabled={busy}
                        onClick={() =>
                          void guarded(async () => void (await runtime.pilot.accept(proposal.id)))
                        }
                      >
                        {proposal.kind === "new_entity" ? "Add" : "Accept"}
                      </button>
                      <button
                        className="btn btn--small"
                        disabled={busy}
                        onClick={() =>
                          void guarded(async () => void (await runtime.pilot.reject(proposal.id)))
                        }
                      >
                        {proposal.kind === "new_entity" ? "Not an entity" : "Reject"}
                      </button>
                      <button
                        className="btn btn--ghost btn--small"
                        disabled={busy}
                        onClick={() =>
                          void guarded(async () => void (await runtime.pilot.ignore(proposal.id)))
                        }
                      >
                        Ignore
                      </button>
                    </>
                  )}
                  {proposal.status === "conflict" &&
                    (
                      [
                        ["update_canon", "Update canon"],
                        ["explain_exception", "Explain exception"],
                        ["ignore", "Ignore"],
                      ] as ReadonlyArray<[ConflictResolution, string]>
                    ).map(([resolution, label]) => (
                      <button
                        key={resolution}
                        className="btn btn--small"
                        disabled={busy}
                        onClick={() =>
                          void guarded(
                            async () =>
                              void (await runtime.pilot.resolveConflict(proposal.id, resolution)),
                          )
                        }
                      >
                        {label}
                      </button>
                    ))}
                  {proposal.status === "auto_applied" && (
                    <button
                      className="btn btn--ghost btn--small"
                      disabled={busy}
                      onClick={() =>
                        void guarded(async () => void (await runtime.pilot.revert(proposal.id)))
                      }
                    >
                      Revert
                    </button>
                  )}
                </div>
              </div>
            ))}
          </section>
        );
      })}

      {proposals.some(decided) && (
        <section className="state__section">
          <h3>Decided</h3>
          {proposals.filter(decided).map((proposal) => (
            <p key={proposal.id} className="hint">
              {proposal.status === "accepted" ? "✓" : "✕"} {proposal.summary}
              {proposal.exception !== undefined ? ` — exception: ${proposal.exception}` : ""}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
