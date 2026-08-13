import { useCallback, useEffect, useState } from "react";
import type {
  AlibiFinding,
  Clue,
  Deduction,
  FairnessReport,
  Mystery,
  ObviousnessFinding,
  Solvability,
  Suspect,
} from "@jellytind/domain";
import { describeFairness } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  auditFairness,
  checkAlibis,
  detectObviousness,
  earliestSolvable,
  loadArchitecture,
  renderChain,
  resolveChain,
  type ChainStep,
} from "@jellytind/mystery";

interface Props {
  repo: StoryRepository;
  refreshToken: number;
  onChanged: () => void;
  onSelectEntity: (id: string) => void;
  onOpenScene: (sceneId: string) => void;
}

interface Loaded {
  readonly mystery: Mystery;
  readonly clues: readonly Clue[];
  readonly deductions: readonly Deduction[];
  readonly suspects: readonly Suspect[];
  readonly steps: readonly ChainStep[];
  readonly names: ReadonlyMap<string, string>;
  readonly positions: ReadonlyMap<string, number>;
}

/**
 * The Mystery Engine.
 *
 * A clue board that is not a metaphor: every card on it is a record, and the
 * question underneath — could a careful reader have got here first? — is
 * answered from those records rather than from the prose. The author-only
 * fields are marked as such, because this panel is the one place they are meant
 * to be looked at (docs/MYSTERY_ENGINE.md).
 */
export function MysteryPanel({
  repo,
  refreshToken,
  onChanged,
  onSelectEntity,
  onOpenScene,
}: Props) {
  const [mysteries, setMysteries] = useState<Mystery[]>([]);
  const [mysteryId, setMysteryId] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [fairness, setFairness] = useState<FairnessReport | null>(null);
  const [solvability, setSolvability] = useState<Solvability | null>(null);
  const [alibis, setAlibis] = useState<readonly AlibiFinding[] | null>(null);
  const [obviousness, setObviousness] = useState<readonly ObviousnessFinding[] | null>(null);
  const [showTrue, setShowTrue] = useState(false);
  const [name, setName] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listMysteries = useCallback(async () => {
    const all = await repo.mysteries.listMysteries();
    setMysteries(all);
    if (mysteryId === "" && all[0] !== undefined) setMysteryId(all[0].id as string);
  }, [repo, mysteryId]);

  useEffect(() => {
    void listMysteries();
  }, [listMysteries, refreshToken]);

  const load = useCallback(async () => {
    if (mysteryId === "") {
      setLoaded(null);
      return;
    }
    try {
      const architecture = await loadArchitecture(repo, mysteryId);
      const { steps } = resolveChain(architecture, await repo.listFacts());
      const names = new Map<string, string>();
      const positions = new Map<string, number>();
      for (const id of [
        ...architecture.clues.map((clue) => clue.id as string),
        ...architecture.suspects.map((suspect) => suspect.characterId as string),
        ...architecture.sceneOrder,
      ]) {
        names.set(id, architecture.label(id));
      }
      for (const sceneId of architecture.sceneOrder) {
        positions.set(sceneId, architecture.positionOf(sceneId));
      }
      setLoaded({
        mystery: architecture.mystery,
        clues: architecture.clues,
        deductions: architecture.deductions,
        suspects: architecture.suspects,
        steps,
        names,
        positions,
      });
      setError(null);
    } catch (cause) {
      setLoaded(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [repo, mysteryId]);

  useEffect(() => {
    setFairness(null);
    setSolvability(null);
    setAlibis(null);
    setObviousness(null);
    void load();
  }, [load, refreshToken]);

  async function run(what: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await what();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const label = (id: string) => loaded?.names.get(id) ?? id;
  const sceneLabel = (sceneId: string | undefined) =>
    sceneId === undefined
      ? "unplaced"
      : `${label(sceneId)} (${String(loaded?.positions.get(sceneId) ?? 0)})`;

  return (
    <div className="agent">
      <div className="agent__ask">
        <div className="state__toggle">
          <select
            value={mysteryId}
            disabled={busy || mysteries.length === 0}
            aria-label="Mystery"
            onChange={(event) => setMysteryId(event.target.value)}
          >
            {mysteries.length === 0 && <option value="">No mysteries yet</option>}
            {mysteries.map((entry) => (
              <option key={entry.id as string} value={entry.id as string}>
                {entry.name}
              </option>
            ))}
          </select>
          <label className="checklist__item">
            <input
              type="checkbox"
              checked={showTrue}
              onChange={(event) => setShowTrue(event.target.checked)}
            />
            Show what things really mean
          </label>
        </div>
        <p className="hint">
          Everything here is what you recorded, not what the prose says. Once the clue system is
          populated, Manu can answer when the reader had what — without reading a word of the book.
        </p>
      </div>

      {error !== null && <p className="status status--error">{error}</p>}

      {mysteries.length === 0 && (
        <section className="agent__section">
          <h3>Start a mystery</h3>
          <div className="state__toggle">
            <input
              value={name}
              placeholder="The sealed vault"
              aria-label="Mystery name"
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              value={question}
              placeholder="Who sealed the vault, and why?"
              aria-label="Question"
              disabled={busy}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <button
              className="btn btn--primary btn--small"
              disabled={busy || name.trim() === "" || question.trim() === ""}
              onClick={() =>
                void run(async () => {
                  const created = await repo.mysteries.addMystery({
                    name: name.trim(),
                    question: question.trim(),
                  });
                  setName("");
                  setQuestion("");
                  setMysteryId(created.id as string);
                  await listMysteries();
                  onChanged();
                })
              }
            >
              Create
            </button>
          </div>
        </section>
      )}

      {loaded !== null && (
        <>
          <section className="agent__section">
            <h3>{loaded.mystery.question}</h3>
            <dl className="specialist__facts">
              <dt>Status</dt>
              <dd>{loaded.mystery.status}</dd>
              <dt>Reveal</dt>
              <dd>{sceneLabel(loaded.mystery.revealSceneId as string | undefined)}</dd>
              <dt>Solvable from</dt>
              <dd>
                {sceneLabel(loaded.mystery.intendedSolvableFromSceneId as string | undefined)}
                <span className="ctx__why">where you intend it to be reachable</span>
              </dd>
              <dt>Culprit</dt>
              <dd>
                {loaded.mystery.culpritIds.length === 0
                  ? "not recorded"
                  : showTrue
                    ? loaded.mystery.culpritIds.map((id) => label(id as string)).join(", ")
                    : "hidden — tick the box above"}
              </dd>
            </dl>
          </section>

          <section className="agent__section">
            <h3>
              The clue board <span className="agent__count">{loaded.clues.length}</span>
            </h3>
            {loaded.clues.length === 0 ? (
              <p className="agent__empty">
                No clues recorded. Nothing here can be answered until there are.
              </p>
            ) : (
              <ul className="agent__findings">
                {loaded.clues.map((clue) => (
                  <li key={clue.id as string}>
                    <span>
                      <span className={`badge badge--${clue.kind}`}>
                        {clue.kind.replace(/_/g, " ")}
                      </span>{" "}
                      {clue.description}
                    </span>
                    <span className="ctx__why">
                      {clue.visibility} · {clue.status.replace(/_/g, " ")} ·{" "}
                      {clue.readerExposure.length === 0
                        ? "the reader is never shown it"
                        : `reader sees it at ${sceneLabel(clue.readerExposure[0] as unknown as string)}`}
                    </span>
                    {clue.apparentMeaning !== undefined && (
                      <span className="ctx__why">Reads as: {clue.apparentMeaning}</span>
                    )}
                    {showTrue && clue.trueMeaning !== undefined && (
                      <span className="agent__sources">Really: {clue.trueMeaning}</span>
                    )}
                    {clue.resolution !== undefined && (
                      <span className="agent__sources">Explained: {clue.resolution}</span>
                    )}
                    {clue.firstAppearance !== undefined && (
                      <span className="agent__sources">
                        <button
                          className="btn btn--ghost btn--small"
                          onClick={() => onOpenScene(clue.firstAppearance as unknown as string)}
                        >
                          {label(clue.firstAppearance as unknown as string)}
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="agent__section">
            <h3>
              The chain of reasoning <span className="agent__count">{loaded.steps.length}</span>
            </h3>
            {loaded.steps.length === 0 ? (
              <p className="agent__empty">
                No deductions recorded. Fairness cannot be checked without knowing what the reader
                is expected to work out.
              </p>
            ) : (
              loaded.steps.map((step) => (
                <div key={step.deductionId}>
                  <h4 className="agent__label">
                    {step.isSolution ? "The solution" : "Step"} · {step.difficulty}
                  </h4>
                  <pre className="mystery__chain">{renderChain(step)}</pre>
                </div>
              ))
            )}
          </section>

          <section className="agent__section">
            <h3>
              Suspects <span className="agent__count">{loaded.suspects.length}</span>
            </h3>
            {loaded.suspects.length === 0 ? (
              <p className="agent__empty">No suspects recorded.</p>
            ) : (
              <ul className="agent__findings">
                {loaded.suspects.map((suspect) => (
                  <li key={suspect.characterId as string}>
                    <span>
                      <button
                        className="btn btn--ghost btn--small"
                        onClick={() => onSelectEntity(suspect.characterId as string)}
                      >
                        {label(suspect.characterId as string)}
                      </button>
                    </span>
                    <span className="ctx__why">
                      {[
                        suspect.motive === undefined ? null : `Motive: ${suspect.motive}`,
                        suspect.means === undefined ? null : `Means: ${suspect.means}`,
                        suspect.opportunity === undefined
                          ? null
                          : `Opportunity: ${suspect.opportunity}`,
                      ]
                        .filter((entry) => entry !== null)
                        .join(" · ") || "nothing recorded"}
                    </span>
                    {suspect.alibi !== undefined && (
                      <span className="agent__sources">Alibi: {suspect.alibi.claim}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="hint">
              Motive, means and opportunity are recorded because a reader weighs them — not so
              anything here can add them up. Who did it is what you wrote down, and nothing else.
            </p>
          </section>

          <section className="agent__section">
            <h3>Is it fair?</h3>
            <div className="agent__actions">
              <button
                className="btn btn--primary btn--small"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setFairness(await auditFairness(repo, mysteryId));
                    setSolvability(await earliestSolvable(repo, mysteryId));
                  })
                }
              >
                {busy ? "Working…" : "Run the fairness audit"}
              </button>
              <button
                className="btn btn--small"
                disabled={busy}
                onClick={() => void run(async () => setAlibis(await checkAlibis(repo, mysteryId)))}
              >
                Check alibis
              </button>
              <button
                className="btn btn--small"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const summaries = await repo.readerSims.list();
                    const sims = [];
                    for (const summary of summaries.filter((s) => s.status === "completed")) {
                      const simulation = await repo.readerSims.get(summary.id);
                      if (simulation !== null) sims.push(simulation);
                    }
                    setObviousness(await detectObviousness(repo, mysteryId, sims));
                  })
                }
              >
                Compare simulated readers
              </button>
            </div>

            {fairness !== null && (
              <>
                <p className="agent__summary">
                  <span className={`badge badge--${fairness.verdict}`}>
                    {describeFairness(fairness.verdict)}
                  </span>
                </p>
                {fairness.findings.length === 0 ? (
                  <p className="status status--ok">
                    Nothing the reader needs arrives late or not at all.
                  </p>
                ) : (
                  <ul className="agent__findings">
                    {fairness.findings.map((finding, index) => (
                      <li
                        key={`${finding.problem}-${String(index)}`}
                        className={
                          finding.problem === "hidden_essential" ||
                          finding.problem === "missing_premise" ||
                          finding.problem === "late_premise"
                            ? "ctx--warning"
                            : undefined
                        }
                      >
                        <span>
                          <span className="badge">{finding.problem.replace(/_/g, " ")}</span>{" "}
                          {finding.statement}
                        </span>
                        {finding.detail !== undefined && (
                          <span className="ctx__why">{finding.detail}</span>
                        )}
                        {finding.sceneIds !== undefined && finding.sceneIds.length > 0 && (
                          <span className="agent__sources">
                            {finding.sceneIds.map((sceneId) => (
                              <button
                                key={sceneId}
                                className="btn btn--ghost btn--small"
                                onClick={() => onOpenScene(sceneId)}
                              >
                                {label(sceneId)}
                              </button>
                            ))}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="hint">
                  {fairness.basis} The reader holds {fairness.readerHasByReveal.length} clue(s) by
                  the reveal.
                  {fairness.notChecked.length > 0 && (
                    <>
                      {" "}
                      <strong>Not checked:</strong> {fairness.notChecked.join("; ")}.
                    </>
                  )}
                </p>
              </>
            )}

            {solvability !== null && (
              <>
                <h4 className="agent__label agent__label--inference">Earliest solvable point</h4>
                <p className="agent__interpretation">
                  {solvability.earliestPosition === null
                    ? "Never — the solution rests on something the reader is not shown."
                    : `Scene ${String(solvability.earliestPosition)}${
                        solvability.scenesFromIntended === undefined
                          ? ""
                          : solvability.scenesFromIntended === 0
                            ? ", exactly where you intended"
                            : solvability.scenesFromIntended > 0
                              ? `, ${String(solvability.scenesFromIntended)} scene(s) later than you intended`
                              : `, ${String(Math.abs(solvability.scenesFromIntended))} scene(s) earlier than you intended`
                      }`}
                </p>
                {solvability.gatingPremise !== undefined && (
                  <p className="ctx__why">
                    Waiting on: {solvability.gatingPremise.label} (
                    {sceneLabel(solvability.gatingPremise.sceneId)})
                  </p>
                )}
                <p className="hint">{solvability.caveat}</p>
              </>
            )}

            {alibis !== null && (
              <>
                <h4 className="agent__label">Alibis against the timeline</h4>
                {alibis.length === 0 ? (
                  <p className="status status--ok">Every recorded alibi holds up.</p>
                ) : (
                  <ul className="agent__findings">
                    {alibis.map((finding) => (
                      <li
                        key={`${finding.characterId}-${finding.kind}`}
                        className={finding.kind === "contradicted" ? "ctx--warning" : undefined}
                      >
                        <span>
                          <span className="badge">{finding.kind}</span> {finding.statement}
                        </span>
                        {finding.detail !== undefined && (
                          <span className="ctx__why">{finding.detail}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {obviousness !== null && (
              <>
                <h4 className="agent__label agent__label--inference">Accidental obviousness</h4>
                {obviousness.length === 0 ? (
                  <p className="status status--ok">
                    No simulated reader reached the culprit earlier than you intended.
                  </p>
                ) : (
                  <>
                    <ul className="agent__findings">
                      {obviousness.map((finding) => (
                        <li key={`${finding.readerProfileId}-${finding.culpritId}`}>
                          <span>
                            {finding.readerProfileName} suspected them from chapter{" "}
                            {finding.suspectedAtPosition}
                            {finding.scenesEarly === undefined
                              ? ""
                              : ` — ${String(finding.scenesEarly)} chapter(s) early`}
                          </span>
                          <span className="ctx__why">{finding.caveat}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="hint">Simulation results, not measurements of real readers.</p>
                  </>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
