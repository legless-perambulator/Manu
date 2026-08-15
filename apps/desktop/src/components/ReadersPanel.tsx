import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReaderProfile, ReaderSimulation, ReaderSimulationSummary } from "@jellytind/domain";
import { SIMULATION_CAVEAT, currentState } from "@jellytind/domain";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  BUILT_IN_PROFILES,
  DIMENSIONS,
  ReaderSimulator,
  attitudeSeries,
  checkStale,
  feelingSeries,
  loadCustomProfiles,
  profileById,
  subjectsIn,
  type AttitudeDimension,
  type Staleness,
} from "@jellytind/reader-sim";
import { estimateOperationCost } from "@jellytind/model-router";
import { createReaderAnalyst } from "../lib/editing";
import { formatCostRange } from "../lib/costs";
import { routeFor } from "../lib/routing";
import { ReaderChart } from "./ReaderChart";

interface Props {
  repo: StoryRepository;
  secrets: SecretStore;
  refreshToken: number;
  onChanged: () => void;
  onSelectEntity: (id: string) => void;
}

/**
 * The honest scale line (Phase 36 §24): a simulation is many small calls, and
 * the writer sees roughly how many — and what that likely costs — before
 * starting one, phrased as the estimate it is.
 */
function simulationCostLine(
  until: string,
  chapters: readonly { id: string; title: string }[],
): string {
  const decision = routeFor("reader_simulation");
  if (decision.selected === undefined) return "";
  const count = Math.max(
    1,
    until === "" ? chapters.length : chapters.findIndex((chapter) => chapter.id === until) + 1,
  );
  const range = estimateOperationCost({
    profile: decision.selected,
    inputTokens: count * 6_000,
    outputTokensLow: count * 300,
    outputTokensHigh: count * 800,
  });
  return `Routed to ${decision.selected.displayName}. ${formatCostRange(range)}`;
}

/**
 * Simulated readers.
 *
 * The panel keeps one distinction visible throughout: a reader's answers are a
 * model's reading of the manuscript, and every chart says so. What is *not*
 * model judgement is the boundary — the chapters each reader had read when
 * they answered — and that is stated too, because it is the reason to believe
 * the answers at all (docs/SIMULATIONS.md).
 */
export function ReadersPanel({ repo, secrets, refreshToken, onChanged, onSelectEntity }: Props) {
  const [profiles, setProfiles] = useState<ReaderProfile[]>([...BUILT_IN_PROFILES]);
  const [problems, setProblems] = useState<Array<{ path: string; reason: string }>>([]);
  const [profileId, setProfileId] = useState(BUILT_IN_PROFILES[0]?.id ?? "");
  const [chapters, setChapters] = useState<Array<{ id: string; title: string }>>([]);
  const [until, setUntil] = useState("");
  const [simulation, setSimulation] = useState<ReaderSimulation | null>(null);
  const [history, setHistory] = useState<ReaderSimulationSummary[]>([]);
  const [stale, setStale] = useState<Staleness | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [dimension, setDimension] = useState<AttitudeDimension>("suspicion");
  const [openChapter, setOpenChapter] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<AbortController | null>(null);

  const profile = useMemo(
    () => profiles.find((entry) => entry.id === profileId) ?? profiles[0] ?? null,
    [profiles, profileId],
  );

  const load = useCallback(async () => {
    const [list, runs, custom, summaries] = await Promise.all([
      repo.listChapters(),
      repo.readerSims.list(12),
      loadCustomProfiles(repo),
      repo.listEntitySummaries(),
    ]);
    setChapters(list.map((chapter) => ({ id: chapter.id as string, title: chapter.title })));
    setHistory(runs);
    setProfiles([...BUILT_IN_PROFILES, ...custom.profiles]);
    setProblems([...custom.problems]);
    setNames(new Map(summaries.map((entry) => [entry.id, entry.name])));
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  useEffect(() => () => cancel.current?.abort(), []);

  const open = useCallback(
    async (id: string) => {
      const stored = await repo.readerSims.get(id);
      if (stored === null) return;
      setSimulation(stored);
      setProfileId(stored.profileId);
      setStale(await checkStale(repo, stored));
    },
    [repo],
  );

  async function execute(what: (simulator: ReaderSimulator) => Promise<ReaderSimulation>) {
    setBusy(true);
    setError(null);
    setLine(null);
    const controller = new AbortController();
    cancel.current = controller;
    try {
      const analyst = await createReaderAnalyst(repo, secrets);
      const simulator = new ReaderSimulator({ repo, sims: repo.readerSims, analyst });
      const finished = await what(simulator);
      setSimulation(finished);
      setStale(await checkStale(repo, finished));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      cancel.current = null;
      setBusy(false);
      setLine(null);
      await load();
      onChanged();
    }
  }

  const label = (id: string) => names.get(id) ?? id;
  const subjects = simulation === null ? [] : subjectsIn(simulation, dimension);
  const state = simulation === null ? null : currentState(simulation);

  return (
    <div className="agent">
      <div className="agent__ask">
        <div className="field">
          <span>Reader</span>
          <select
            value={profile?.id ?? ""}
            disabled={busy}
            onChange={(event) => {
              setProfileId(event.target.value);
              setSimulation(null);
              setStale(null);
            }}
          >
            {profiles.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
                {entry.custom === true ? " (yours)" : ""}
              </option>
            ))}
          </select>
        </div>
        {profile !== null && (
          <>
            <p className="hint">{profile.description}</p>
            <ul className="specialist__list">
              {profile.traits.map((trait) => (
                <li key={trait}>{trait}</li>
              ))}
            </ul>
          </>
        )}

        <div className="field">
          <span>Read up to</span>
          <select value={until} disabled={busy} onChange={(event) => setUntil(event.target.value)}>
            <option value="">The end of the book</option>
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.title}
              </option>
            ))}
          </select>
        </div>

        {chapters.length > 0 && (
          <p className="hint">
            A read makes about one model call per chapter —{" "}
            {until === ""
              ? String(chapters.length)
              : String(chapters.findIndex((chapter) => chapter.id === until) + 1)}{" "}
            here. {simulationCostLine(until, chapters)}
          </p>
        )}

        <div className="agent__actions">
          <button
            className="btn btn--primary btn--small"
            disabled={busy || profile === null}
            onClick={() =>
              void execute((simulator) =>
                simulator.run(profileById(profile?.id ?? "", profiles), {
                  ...(until === "" ? {} : { untilChapterId: until }),
                  onProgress: (event) => {
                    setLine(event.line);
                    setSimulation(event.simulation);
                  },
                }),
              )
            }
          >
            {busy ? "Reading…" : "Read the book"}
          </button>
          {busy && (
            <button className="btn btn--small" onClick={() => cancel.current?.abort()}>
              Stop
            </button>
          )}
          {simulation !== null && stale?.staleFrom != null && !busy && (
            <button
              className="btn btn--small"
              onClick={() =>
                void execute((simulator) =>
                  simulator.rerunFrom(
                    simulation.id,
                    profileById(simulation.profileId, profiles),
                    stale.staleFrom?.chapterId ?? "",
                    {
                      onProgress: (event) => {
                        setLine(event.line);
                        setSimulation(event.simulation);
                      },
                    },
                  ),
                )
              }
            >
              Re-read from chapter {stale.staleFrom.position}
            </button>
          )}
        </div>
        <p className="hint">
          This reader sees the manuscript one chapter at a time and is never shown a later chapter,
          your notes, or your records — only the pages, and what they made of the pages before.
        </p>
        {line !== null && <p className="status">{line}</p>}
      </div>

      {problems.length > 0 && (
        <section className="agent__section">
          <h3>Readers that could not be loaded</h3>
          <ul className="agent__uncertainties">
            {problems.map((problem) => (
              <li key={problem.path}>
                <span className="ctx__id">{problem.path}</span> {problem.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      {error !== null && <p className="status status--error">{error}</p>}

      {stale?.staleFrom != null && (
        <p className="status status--warn">
          {stale.reason} Chapters 1–{stale.goodThrough} still stand.
        </p>
      )}

      {simulation !== null && simulation.readings.length > 0 && (
        <>
          <section className="agent__section">
            <h3>
              {simulation.profileName}{" "}
              <span className="agent__count">
                {simulation.readings.length} of {simulation.chapterIds.length} chapters
                {simulation.rerunCount > 0 ? ` · re-read ${String(simulation.rerunCount)}×` : ""}
              </span>
            </h3>

            <div className="state__toggle">
              {DIMENSIONS.map((entry) => (
                <button
                  key={entry}
                  className={`btn btn--small ${dimension === entry ? "btn--primary" : "btn--ghost"}`}
                  onClick={() => setDimension(entry)}
                >
                  {entry}
                </button>
              ))}
            </div>

            <div className="chart__grid-wrap">
              {subjects.slice(0, 4).map((subject) => (
                <ReaderChart
                  key={subject}
                  series={attitudeSeries(simulation, dimension, subject, label(subject))}
                />
              ))}
              <ReaderChart series={feelingSeries(simulation, "interest")} />
              <ReaderChart series={feelingSeries(simulation, "confusion")} />
            </div>
            {subjects.length > 0 && (
              <p className="hint">
                {subjects.slice(0, 4).map((subject) => (
                  <button
                    key={subject}
                    className="btn btn--ghost btn--small"
                    onClick={() => onSelectEntity(subject)}
                  >
                    {label(subject)}
                  </button>
                ))}
              </p>
            )}
          </section>

          {state !== null && (
            <section className="agent__section">
              <h3>Where this reader stands now</h3>
              <p className="agent__summary">{simulation.readings.at(-1)?.understanding}</p>
              {state.questions.length > 0 && (
                <>
                  <h4 className="agent__label">Still asking</h4>
                  <ul className="agent__uncertainties">
                    {state.questions.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ul>
                </>
              )}
              {state.predictions.length > 0 && (
                <>
                  <h4 className="agent__label agent__label--inference">Expects to happen</h4>
                  <ul className="agent__uncertainties">
                    {state.predictions.map((prediction) => (
                      <li key={prediction}>{prediction}</li>
                    ))}
                  </ul>
                </>
              )}
              <p className="hint">{SIMULATION_CAVEAT}</p>
            </section>
          )}

          <section className="agent__section">
            <h3>Chapter by chapter</h3>
            <ul className="skill__steps">
              {simulation.readings.map((reading) => (
                <li key={reading.chapterId} className="skill__step skill__step--ok">
                  <span>
                    <button
                      className="btn btn--ghost btn--small"
                      onClick={() =>
                        setOpenChapter(openChapter === reading.chapterId ? null : reading.chapterId)
                      }
                    >
                      {reading.exposure.chapterTitle}
                    </button>
                    <span className="ctx__why">
                      interest {reading.state.interest} · confusion {reading.state.confusion}
                    </span>
                  </span>
                  {openChapter === reading.chapterId && (
                    <div className="reader__reading">
                      <p>{reading.understanding}</p>
                      {reading.confusedBy.length > 0 && (
                        <p>
                          <strong>Confused by:</strong> {reading.confusedBy.join("; ")}
                        </p>
                      )}
                      {reading.bored.length > 0 && (
                        <p>
                          <strong>Bored by:</strong> {reading.bored.join("; ")}
                        </p>
                      )}
                      {reading.interested.length > 0 && (
                        <p>
                          <strong>Kept reading for:</strong> {reading.interested.join("; ")}
                        </p>
                      )}
                      {reading.emotionalMoments.length > 0 && (
                        <p>
                          <strong>Landed:</strong> {reading.emotionalMoments.join("; ")}
                        </p>
                      )}
                      {reading.state.remembered.length > 0 && (
                        <p>
                          <strong>Remembers:</strong> {reading.state.remembered.join("; ")}
                        </p>
                      )}
                      <p className="ctx__why">
                        Read on {String(reading.exposure.words)} words,{" "}
                        {reading.exposure.sceneIds.length} scene(s), having met{" "}
                        {reading.exposure.charactersMet.length} character(s). Nothing after this
                        chapter was shown.
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {history.length > 0 && (
        <section className="agent__section">
          <h3>Readers who have read this book</h3>
          <ul className="agent__tasks">
            {history.map((entry) => (
              <li key={entry.id}>
                <span className={`badge badge--${entry.status}`}>{entry.status}</span>
                <span className="agent__goal">
                  {entry.profileName} — {String(entry.chaptersRead)}/{String(entry.chaptersTotal)}{" "}
                  chapters
                </span>
                <button
                  className="btn btn--ghost btn--small"
                  disabled={busy}
                  onClick={() => void open(entry.id)}
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
