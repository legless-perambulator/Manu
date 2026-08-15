import { useCallback, useEffect, useState } from "react";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  applyMatch,
  buildBookDigest,
  detectCanonConflicts,
  promoteToCanon,
  reconcileEntities,
  renderPriorContext,
  resolveConflict,
  runUniverseTests,
  universeChecks,
  universeChronology,
  type CanonConflict,
  type CanonEntity,
  type CanonKind,
  type ChronologyRow,
  type ReconcileProposal,
  type Universe,
  type UniverseDiagnostic,
  type UniverseTestResult,
} from "@jellytind/universe";
import {
  createUniverseAround,
  joinUniverse,
  openLinkedUniverse,
  type UniverseLink,
} from "../lib/universe-session";
import { pickDirectory } from "../lib/dialog";
import type { ProjectSession } from "../repo/session";

interface Props {
  session: ProjectSession;
  refreshToken: number;
  onChanged: () => void;
}

const RECONCILABLE: ReadonlyArray<{ graphKind: string; canonKind: CanonKind }> = [
  { graphKind: "character", canonKind: "character" },
  { graphKind: "location", canonKind: "location" },
  { graphKind: "object", canonKind: "object" },
  { graphKind: "fact", canonKind: "fact" },
];

/**
 * The Universe workbench (Phase 41 §15–§16): semantic navigation over the
 * shared world — books, shared canon, the cross-book timeline, series
 * threads, conflicts, universe tests, and what this book inherits — with the
 * raw storage never exposed. A standalone book sees an invitation, not a
 * requirement.
 */
export function UniversePanel({ session, refreshToken, onChanged }: Props) {
  const repo: StoryRepository = session.repo;
  const [universe, setUniverse] = useState<Universe | null>(null);
  const [link, setLink] = useState<UniverseLink | null>(null);
  const [canon, setCanon] = useState<CanonEntity[]>([]);
  const [rows, setRows] = useState<ChronologyRow[]>([]);
  const [proposals, setProposals] = useState<ReconcileProposal[]>([]);
  const [conflicts, setConflicts] = useState<CanonConflict[]>([]);
  const [diagnostics, setDiagnostics] = useState<UniverseDiagnostic[]>([]);
  const [testResults, setTestResults] = useState<UniverseTestResult[]>([]);
  const [priorContext, setPriorContext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const opened = await openLinkedUniverse(repo);
      if (opened === null) {
        setUniverse(null);
        setLink(null);
        return;
      }
      setUniverse(opened.universe);
      setLink(opened.link);
      setCanon(await opened.universe.listCanon());
      setRows(await universeChronology(opened.universe));
      setPriorContext(await renderPriorContext(opened.universe, opened.link.bookId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  async function guarded(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    await guarded(async () => {
      const name = newName.trim();
      if (name === "") throw new Error("Name the universe first.");
      const parent = await pickDirectory("Choose where the universe folder goes");
      if (parent === null) return;
      await createUniverseAround(session, parent, name);
      setNotice(`Universe "${name}" created; this book is Book 1.`);
      await load();
      onChanged();
    });
  }

  async function join() {
    await guarded(async () => {
      const dir = await pickDirectory("Choose the universe folder");
      if (dir === null) return;
      await joinUniverse(session, dir);
      setNotice("This book has joined the universe.");
      await load();
      onChanged();
    });
  }

  async function refreshDigest() {
    if (universe === null || link === null) return;
    await guarded(async () => {
      await universe.saveDigest(await buildBookDigest(repo, universe, link.bookId));
      setNotice("This book's contribution to the universe memory is up to date.");
      await load();
    });
  }

  async function reconcile() {
    if (universe === null || link === null) return;
    await guarded(async () => {
      const summaries = await repo.listEntitySummaries();
      const candidates = summaries
        .map((held) => {
          const mapping = RECONCILABLE.find((entry) => entry.graphKind === held.kind);
          return mapping === undefined
            ? null
            : { localId: held.id, localName: held.name, kind: mapping.canonKind };
        })
        .filter((held): held is NonNullable<typeof held> => held !== null);
      setProposals(await reconcileEntities(universe, link.bookId, candidates));
    });
  }

  async function checkBook() {
    if (universe === null || link === null) return;
    await guarded(async () => {
      setDiagnostics(await universeChecks(universe, link.bookId, repo));
      const found = await detectCanonConflicts(universe, link.bookId, repo);
      const recorded = await universe.listConflicts();
      setConflicts(found.map((held) => recorded.find((saved) => saved.id === held.id) ?? held));
      setTestResults(await runUniverseTests(universe, await universe.listTests()));
    });
  }

  if (universe === null || link === null) {
    return (
      <div className="state universe">
        <section className="state__section">
          <h3>Universe</h3>
          <p className="hint">
            A universe lets several books share one world — characters, places, facts and history —
            while each book keeps its own chronology, state and spoiler boundaries. This book is
            currently standalone, which is a fine thing to be.
          </p>
          {error !== null && <p className="status status--error">{error}</p>}
          <label className="field">
            <span>Create a universe around this book</span>
            <input
              value={newName}
              placeholder="Universe name, e.g. Blackthorn"
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <div className="mapping__actions">
            <button className="btn btn--primary" disabled={busy} onClick={() => void create()}>
              Create universe…
            </button>
            <button className="btn" disabled={busy} onClick={() => void join()}>
              Join an existing universe…
            </button>
          </div>
        </section>
      </div>
    );
  }

  const bookNames = new Map(
    universe.getManifest().books.map((book) => [book.bookId, book.title] as const),
  );
  const thisBookBindings = new Set(
    canon
      .map((entity) => entity.bindings.find((held) => held.bookId === link.bookId)?.localId)
      .filter((held): held is string => held !== undefined),
  );
  void thisBookBindings;

  return (
    <div className="state universe">
      <section className="state__section">
        <h3>{universe.name}</h3>
        <p className="hint">
          This book is {bookNames.get(link.bookId) ?? link.bookId}. Shared canon and prior-book
          memory flow in; nothing from later books can reach this one.
        </p>
        {error !== null && <p className="status status--error">{error}</p>}
        {notice !== null && <p className="status status--ok">{notice}</p>}
        <div className="mapping__actions">
          <button className="btn btn--small" disabled={busy} onClick={() => void refreshDigest()}>
            Refresh this book’s digest
          </button>
          <button className="btn btn--small" disabled={busy} onClick={() => void reconcile()}>
            Reconcile entities with canon
          </button>
          <button className="btn btn--small" disabled={busy} onClick={() => void checkBook()}>
            Run cross-book checks
          </button>
        </div>
      </section>

      <section className="state__section">
        <h3>Books</h3>
        <ul className="universe__books">
          {universe.booksInReadingOrder().map((book) => (
            <li key={book.bookId} className={book.bookId === link.bookId ? "is-current" : ""}>
              <span className="universe__order">{book.readingOrder}</span>
              <span>{book.title}</span>
              {book.bookId === link.bookId && <em>this book</em>}
            </li>
          ))}
        </ul>
      </section>

      {rows.length > 0 && (
        <section className="state__section">
          <h3>Cross-book timeline</h3>
          <ul className="universe__timeline">
            {rows.map((row) => (
              <li key={`${row.kind}:${row.label}`} className={`is-${row.kind}`}>
                <span>{row.label}</span>
                <span className="hint">
                  {row.kind === "book" ? `book ${row.readingOrder}` : (row.year ?? "event")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="state__section">
        <h3>Shared canon</h3>
        <ul className="universe__canon">
          {canon.map((entity) => {
            const binding = entity.bindings.find((held) => held.bookId === link.bookId);
            return (
              <li key={entity.id}>
                <span className="universe__kind">{entity.kind.replace(/_/g, " ")}</span>
                <span>{entity.name}</span>
                <span className="hint">
                  {entity.scope.level}
                  {binding !== undefined ? " · in this book" : ""}
                  {` · ${entity.bindings.length} book(s)`}
                </span>
              </li>
            );
          })}
          {canon.length === 0 && (
            <p className="placeholder">
              Nothing shared yet. Reconcile entities to promote this book’s people and places into
              the universe.
            </p>
          )}
        </ul>
      </section>

      {proposals.length > 0 && (
        <section className="state__section">
          <h3>Reconciliation</h3>
          <ul className="mapping__list">
            {proposals.map((proposal) => (
              <li key={proposal.localId} className="mapping__item">
                {proposal.kind === "match" && (
                  <>
                    <div className="mapping__head">
                      <span className="mapping__summaryline">
                        {proposal.localName} looks like <strong>{proposal.canonName}</strong>
                      </span>
                      <span
                        className={`mapping__conf mapping__conf--${proposal.confidence === "high" ? "high" : "low"}`}
                      >
                        {proposal.confidence}
                      </span>
                    </div>
                    <div className="mapping__decide">
                      <button
                        className="btn btn--ghost btn--small"
                        disabled={busy}
                        onClick={() =>
                          void guarded(async () => {
                            await applyMatch(universe, link.bookId, proposal);
                            setProposals((held) =>
                              held.filter((p) => p.localId !== proposal.localId),
                            );
                            await load();
                          })
                        }
                      >
                        Same entity — bind it
                      </button>
                    </div>
                  </>
                )}
                {proposal.kind === "ambiguous" && (
                  <>
                    <div className="mapping__summaryline">
                      {proposal.localName} could be several canon entities:
                    </div>
                    <div className="mapping__decide">
                      {proposal.candidates.map((candidate) => (
                        <button
                          key={candidate.canonId}
                          className="btn btn--ghost btn--small"
                          disabled={busy}
                          onClick={() =>
                            void guarded(async () => {
                              await applyMatch(universe, link.bookId, {
                                localId: proposal.localId,
                                localName: proposal.localName,
                                canonId: candidate.canonId,
                              });
                              setProposals((held) =>
                                held.filter((p) => p.localId !== proposal.localId),
                              );
                              await load();
                            })
                          }
                        >
                          It’s {candidate.canonName}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {proposal.kind === "new" && (
                  <>
                    <div className="mapping__summaryline">
                      {proposal.localName} is new to the universe.
                    </div>
                    <div className="mapping__decide">
                      <button
                        className="btn btn--ghost btn--small"
                        disabled={busy}
                        onClick={() =>
                          void guarded(async () => {
                            await promoteToCanon(universe, link.bookId, {
                              localId: proposal.localId,
                              name: proposal.localName,
                              kind: proposal.entityKind,
                            });
                            setProposals((held) =>
                              held.filter((p) => p.localId !== proposal.localId),
                            );
                            await load();
                          })
                        }
                      >
                        Share into the universe
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(diagnostics.length > 0 || conflicts.length > 0 || testResults.length > 0) && (
        <section className="state__section">
          <h3>Cross-book checks</h3>
          {diagnostics.map((diagnostic) => (
            <p
              key={diagnostic.id}
              className={`status status--${diagnostic.severity === "error" ? "error" : "warn"}`}
            >
              {diagnostic.message}
            </p>
          ))}
          {conflicts.map((conflict) => (
            <div key={conflict.id} className="mapping__item">
              <div className="mapping__summaryline">{conflict.summary}</div>
              <div className="mapping__evidence">
                Canon: “{conflict.canonSays}” — this book: “{conflict.bookSays}”
              </div>
              {conflict.resolution !== undefined ? (
                <span className="mapping__state">{conflict.resolution.replace(/_/g, " ")}</span>
              ) : (
                <div className="mapping__decide">
                  {(
                    [
                      ["correct_book", "Correct the book"],
                      ["update_canon", "Update canon"],
                      ["explain_exception", "Explain the exception"],
                      ["ignore", "Ignore"],
                    ] as const
                  ).map(([resolution, label]) => (
                    <button
                      key={resolution}
                      className="btn btn--ghost btn--small"
                      disabled={busy}
                      onClick={() =>
                        void guarded(async () => {
                          await resolveConflict(universe, conflict, resolution);
                          await checkBook();
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {testResults.map((result) => (
            <p
              key={result.testId}
              className={`status status--${result.outcome === "fail" ? "error" : "ok"}`}
            >
              {result.testId}: {result.outcome} — {result.detail}
            </p>
          ))}
        </section>
      )}

      {priorContext !== null && priorContext.split("\n").length > 1 && (
        <section className="state__section">
          <h3>What this book inherits</h3>
          <pre className="universe__context">{priorContext}</pre>
          <p className="hint">
            This is the boundary-safe memory earlier books hand forward — structured facts and
            summaries, never whole novels, and never anything from later books.
          </p>
        </section>
      )}
    </div>
  );
}
