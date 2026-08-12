import { useCallback, useEffect, useState } from "react";
import type {
  Chapter,
  PlotThread,
  PlotThreadStatus,
  Scene,
  Setup,
  Subtlety,
  ThreadInteraction,
} from "@jellytind/domain";
import { PLOT_THREAD_STATUSES, SUBTLETIES, THREAD_INTERACTIONS } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  describeDormancy,
  INTERACTION_VERBS,
  type NarrativeFinding,
  type ThreadDormancy,
  type ThreadState,
  type ThreadStep,
} from "@jellytind/story-state";
import { explainEditError } from "../lib/editing";

interface Props {
  repo: StoryRepository;
  refreshToken: number;
  onChanged: () => void;
  onSelectEntity: (id: string) => void;
}

/**
 * Plot threads, setups and payoffs.
 *
 * The shape of a thread — introduced in chapter four, advanced twice, quiet
 * through the middle, resolved at the end — is invisible in the manuscript and
 * obvious here. Dormancy is shown as a measurement and never as a verdict: a
 * long silence may be exactly what the book needs, and the system has no
 * business deciding otherwise (docs/NARRATIVE_THREADS.md).
 */
export function ThreadPanel({ repo, refreshToken, onChanged, onSelectEntity }: Props) {
  const [threads, setThreads] = useState<PlotThread[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [setups, setSetups] = useState<Setup[]>([]);
  const [findings, setFindings] = useState<NarrativeFinding[]>([]);

  const [threadId, setThreadId] = useState("");
  const [history, setHistory] = useState<ThreadStep[]>([]);
  const [state, setState] = useState<ThreadState | null>(null);
  const [dormancy, setDormancy] = useState<ThreadDormancy | null>(null);
  const [dormantAfter, setDormantAfter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<{
    sceneId: string;
    kind: "appearance" | "status";
    interaction: ThreadInteraction;
    status: PlotThreadStatus;
    note: string;
  }>({ sceneId: "", kind: "appearance", interaction: "advances", status: "active", note: "" });

  const [promise, setPromise] = useState<{
    description: string;
    setupSceneId: string;
    payoffSceneId: string;
    subtlety: Subtlety;
    trueMeaning: string;
  }>({ description: "", setupSceneId: "", payoffSceneId: "", subtlety: "subtle", trueMeaning: "" });

  const load = useCallback(async () => {
    const threshold = Number.parseInt(dormantAfter, 10);
    const [allThreads, allScenes, allChapters, allSetups, found] = await Promise.all([
      repo.listPlotThreads(),
      repo.listScenes(),
      repo.listChapters(),
      repo.listSetups(),
      repo.checkNarrative(
        Number.isFinite(threshold) && threshold > 0 ? { dormantAfterScenes: threshold } : {},
      ),
    ]);
    setThreads(allThreads);
    setScenes(allScenes);
    setChapters(allChapters);
    setSetups(allSetups);
    setFindings(found);
    if (allThreads.length > 0 && !allThreads.some((t) => t.id === threadId)) {
      setThreadId(allThreads[0]?.id ?? "");
    }
    if (allScenes.length > 0 && step.sceneId === "") {
      setStep((d) => ({ ...d, sceneId: allScenes[0]?.id ?? "" }));
    }
  }, [repo, threadId, step.sceneId, dormantAfter]);

  const reload = useCallback(async () => {
    await load();
    if (threadId === "") {
      setHistory([]);
      setState(null);
      setDormancy(null);
      return;
    }
    const allScenes = await repo.listScenes();
    const last = allScenes.at(-1);
    const [steps, current, gap] = await Promise.all([
      repo.getThreadHistory(threadId),
      last === undefined
        ? Promise.resolve(null)
        : repo.getThreadState(threadId, { sceneId: last.id, position: "after" }),
      last === undefined
        ? Promise.resolve(null)
        : repo.getThreadDormancy(threadId, { sceneId: last.id, position: "after" }),
    ]);
    setHistory(steps);
    setState(current);
    setDormancy(gap);
  }, [repo, threadId, load]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  /** Group the trail by chapter, the way a writer reads their own book. */
  const chapterOf = useCallback(
    (sceneId: string) => {
      const scene = scenes.find((s) => s.id === sceneId);
      const chapter = chapters.find((c) => c.id === scene?.chapterId);
      return chapter === undefined ? "Unassigned" : chapter.title;
    },
    [scenes, chapters],
  );

  const grouped = history.reduce<Map<string, ThreadStep[]>>((acc, entry) => {
    const key = chapterOf(entry.sceneId);
    acc.set(key, [...(acc.get(key) ?? []), entry]);
    return acc;
  }, new Map());

  const mine = findings.filter((f) => f.threadId === threadId);
  const threadSetups = setups.filter((s) => s.targetThreadId === threadId);

  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await work();
      await reload();
      onChanged();
    } catch (cause) {
      setError(explainEditError(cause));
    } finally {
      setBusy(false);
    }
  }

  const recordStep = (): void =>
    void run(async () => {
      await repo.addStateTransitions([
        {
          sceneId: step.sceneId,
          kind: step.kind === "appearance" ? "thread_appearance" : "thread_status",
          subjectId: threadId,
          value: step.kind === "appearance" ? step.interaction : step.status,
          ...(step.note.trim() === "" ? {} : { note: step.note.trim() }),
        },
      ]);
      setStep({ ...step, note: "" });
    });

  const recordPromise = (): void =>
    void run(async () => {
      await repo.addSetup({
        description: promise.description.trim(),
        ...(promise.setupSceneId === "" ? {} : { setupSceneIds: [promise.setupSceneId as never] }),
        ...(promise.payoffSceneId === ""
          ? {}
          : { payoffSceneIds: [promise.payoffSceneId as never] }),
        subtlety: promise.subtlety,
        ...(promise.trueMeaning.trim() === "" ? {} : { trueMeaning: promise.trueMeaning.trim() }),
        ...(threadId === "" ? {} : { targetThreadId: threadId as never }),
      });
      setPromise({ ...promise, description: "", trueMeaning: "" });
    });

  return (
    <div className="state">
      <div className="state__controls">
        <label className="field">
          <span>Thread</span>
          <select value={threadId} onChange={(e) => setThreadId(e.target.value)}>
            {threads.length === 0 && <option value="">no plot threads</option>}
            {threads.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {threadId !== "" && (
          <button className="btn btn--small" onClick={() => onSelectEntity(threadId)}>
            Inspect entity
          </button>
        )}
      </div>

      {error !== null && <p className="status status--error">{error}</p>}

      {state !== null && (
        <section className="state__section">
          <h3>Where it stands</h3>
          <div className="state__card">
            <ul className="state__knowledge">
              <li>status: {state.status}</li>
              <li>introduced: {state.introducedSceneId ?? "not yet"}</li>
              <li>resolved: {state.resolvedSceneId ?? "not yet"}</li>
              <li>appearances: {state.appearanceSceneIds.length}</li>
              {dormancy !== null && <li>{describeDormancy(dormancy)}</li>}
            </ul>
          </div>
        </section>
      )}

      <section className="state__section">
        <h3>Lifecycle</h3>
        {history.length === 0 ? (
          <p className="hint">Nothing recorded for this thread yet.</p>
        ) : (
          <ul className="rel__timeline">
            {[...grouped.entries()].map(([chapterTitle, steps]) => (
              <li key={chapterTitle}>
                <div className="rel__chapter">{chapterTitle}</div>
                <ul className="rel__changes">
                  {steps.map((entry, i) => (
                    <li key={`${entry.sceneId}-${String(i)}`}>
                      <span className="rel__to">
                        {entry.interaction === undefined
                          ? entry.status
                          : INTERACTION_VERBS[entry.interaction]}
                      </span>
                      {entry.previousStatus !== undefined && (
                        <>
                          <span className="rel__arrow">→</span>
                          <span className="rel__label">{entry.status}</span>
                        </>
                      )}
                      <span className="ctx__id"> {entry.sceneId}</span>
                      {entry.reason !== undefined && <div className="ctx__why">{entry.reason}</div>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      {threadId !== "" && scenes.length > 0 && (
        <section className="state__section">
          <h3>Record a step</h3>
          <label className="field">
            <span>At scene</span>
            <select
              value={step.sceneId}
              onChange={(e) => setStep({ ...step, sceneId: e.target.value })}
              disabled={busy}
            >
              {scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} — {s.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Kind</span>
            <select
              value={step.kind}
              onChange={(e) =>
                setStep({ ...step, kind: e.target.value as "appearance" | "status" })
              }
              disabled={busy}
            >
              <option value="appearance">the scene touches the thread</option>
              <option value="status">the lifecycle changes</option>
            </select>
          </label>
          {step.kind === "appearance" ? (
            <label className="field">
              <span>How</span>
              <select
                value={step.interaction}
                onChange={(e) =>
                  setStep({ ...step, interaction: e.target.value as ThreadInteraction })
                }
                disabled={busy}
              >
                {THREAD_INTERACTIONS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field">
              <span>Becomes</span>
              <select
                value={step.status}
                onChange={(e) => setStep({ ...step, status: e.target.value as PlotThreadStatus })}
                disabled={busy}
              >
                {PLOT_THREAD_STATUSES.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Why (optional)</span>
            <input
              value={step.note}
              onChange={(e) => setStep({ ...step, note: e.target.value })}
              disabled={busy}
            />
          </label>
          <button
            className="btn btn--primary btn--small"
            disabled={busy || step.sceneId === ""}
            onClick={recordStep}
          >
            Record
          </button>
          <p className="hint">
            A passing reference is not progress: it leaves the lifecycle where it was.
          </p>
        </section>
      )}

      <section className="state__section">
        <h3>Setups &amp; payoffs</h3>
        {threadSetups.length === 0 ? (
          <p className="hint">No promises registered against this thread.</p>
        ) : (
          <ul className="state__knowledge">
            {threadSetups.map((setup) => (
              <li key={setup.id}>
                <strong>{setup.description}</strong>{" "}
                <span className="ctx__id">
                  {setup.setupSceneIds.join(", ")}
                  {setup.payoffSceneIds.length > 0 ? ` → ${setup.payoffSceneIds.join(", ")}` : ""}
                </span>
                <span className="badge"> {setup.subtlety}</span>
                {setup.payoffSceneIds.length === 0 && <div className="ctx__why">unpaid</div>}
              </li>
            ))}
          </ul>
        )}

        {scenes.length > 0 && (
          <>
            <label className="field">
              <span>What is planted</span>
              <input
                value={promise.description}
                placeholder="Brass key visible in father's drawer."
                onChange={(e) => setPromise({ ...promise, description: e.target.value })}
                disabled={busy}
              />
            </label>
            <label className="field">
              <span>Planted in</span>
              <select
                value={promise.setupSceneId}
                onChange={(e) => setPromise({ ...promise, setupSceneId: e.target.value })}
                disabled={busy}
              >
                <option value="">choose…</option>
                {scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id} — {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Paid off in (optional)</span>
              <select
                value={promise.payoffSceneId}
                onChange={(e) => setPromise({ ...promise, payoffSceneId: e.target.value })}
                disabled={busy}
              >
                <option value="">not yet</option>
                {scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id} — {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Subtlety</span>
              <select
                value={promise.subtlety}
                onChange={(e) => setPromise({ ...promise, subtlety: e.target.value as Subtlety })}
                disabled={busy}
              >
                {SUBTLETIES.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>What it actually means (author-only)</span>
              <input
                value={promise.trueMeaning}
                onChange={(e) => setPromise({ ...promise, trueMeaning: e.target.value })}
                disabled={busy}
              />
            </label>
            <button
              className="btn btn--primary btn--small"
              disabled={busy || promise.description.trim() === "" || promise.setupSceneId === ""}
              onClick={recordPromise}
            >
              Register promise
            </button>
            <p className="hint">
              What a setup actually means never reaches a reader-facing context.
            </p>
          </>
        )}
      </section>

      <section className="state__section">
        <h3>Findings</h3>
        <label className="field">
          <span>Report threads quiet for at least (scenes)</span>
          <input
            value={dormantAfter}
            placeholder="off — you choose what counts as long"
            onChange={(e) => setDormantAfter(e.target.value.replace(/\D/g, ""))}
            disabled={busy}
          />
        </label>
        {findings.length === 0 ? (
          <p className="status status--ok">No narrative findings.</p>
        ) : (
          <>
            {mine.length > 0 && (
              <ul className="state__knowledge">
                {mine.map((finding, i) => (
                  <li key={i} className={`ctx--${finding.severity}`}>
                    {finding.message}
                  </li>
                ))}
              </ul>
            )}
            <details>
              <summary className="hint">{findings.length} finding(s) across the project</summary>
              <ul className="state__knowledge">
                {findings.map((finding, i) => (
                  <li key={i} className={`ctx--${finding.severity}`}>
                    {finding.message}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </section>
    </div>
  );
}
