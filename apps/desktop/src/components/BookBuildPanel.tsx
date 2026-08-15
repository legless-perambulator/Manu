import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PermissionGrant } from "@jellytind/agent-runtime";
import type {
  ActBuild,
  BookActRecord,
  BookBuild,
  BookBuildSummary,
  BookPlan,
  BookPlanFinding,
  Chapter,
  Character,
  ModelRouteNote,
  PlotThread,
  Relationship,
} from "@jellytind/domain";
import { describeBookProgress } from "@jellytind/domain";
import { BookBuilder } from "@jellytind/editing";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import { createRoutedModel, routeNote, routingProfiles } from "../lib/routing";
import { describeClassUsage } from "../lib/costs";
import type { RoutingClass } from "@jellytind/domain";

interface Props {
  repo: StoryRepository;
  secrets: SecretStore;
  branchId: string;
  refreshToken: number;
  onChanged: () => void;
}

const BOOK_GRANT: PermissionGrant = {
  permissions: [
    "read_manuscript",
    "read_canon",
    "edit_manuscript",
    "edit_story_state",
    "edit_plans",
  ],
  allowedTools: [
    "build_book",
    "build_act",
    "build_chapter",
    "analyse_state_changes",
    "create_chapter_plan",
  ],
};

const POLICY_COPY = {
  every_scene: {
    label: "Show me every scene",
    hint: "Each drafted scene is held for you before it lands. The slowest, surest walk.",
  },
  every_chapter: {
    label: "Show me every chapter",
    hint: "Pauses after each chapter is built.",
  },
  every_act: {
    label: "Show me every act",
    hint: "Pauses after each act, and once at the end.",
  },
  auto_until_error: {
    label: "Build until something is wrong",
    hint: "Commits as it goes — checkpointed — and stops on errors, failures and stale plans.",
  },
  autonomous: {
    label: "Autonomous",
    hint: "As above, and Manu arrives with proposals where plans are missing or stale. Still stops for every plan approval and every error.",
  },
} as const;

const ACT_GLYPH: Readonly<Record<BookActRecord["status"], string>> = {
  pending: "○",
  building: "→",
  completed: "✓",
  failed: "!",
};

type PlanDraft = Parameters<StoryRepository["saveBookPlan"]>[0];

function toDraft(plan: BookPlan): PlanDraft {
  const { version: _v, revisions: _r, updatedAt: _u, ...rest } = plan;
  return rest;
}

/**
 * Build Book — the writer-facing face of "/write-book" (§3, §20).
 *
 * A calm dashboard: the acts, their chapters, the current task in one line,
 * the manuscript's real word count, and real positions ("Act 2 / 3 ·
 * Chapter 11 / 24") — never an invented percentage (§22). The machinery's
 * detail is one disclosure away (§21), not the default view.
 */
export function BookBuildPanel({ repo, secrets, branchId, refreshToken, onChanged }: Props) {
  const [plan, setPlan] = useState<BookPlan | null>(null);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [findings, setFindings] = useState<readonly BookPlanFinding[] | null>(null);
  const [actIds, setActIds] = useState<readonly string[]>([]);
  const [actTitles, setActTitles] = useState<ReadonlyMap<string, string>>(new Map());
  const [threads, setThreads] = useState<readonly PlotThread[]>([]);
  const [characters, setCharacters] = useState<readonly Character[]>([]);
  const [relationships, setRelationships] = useState<readonly Relationship[]>([]);
  const [chapters, setChapters] = useState<readonly Chapter[]>([]);
  const [policy, setPolicy] = useState<BookBuild["approvalPolicy"]>("every_act");
  const [active, setActive] = useState<BookBuild | null>(null);
  const [activeActs, setActiveActs] = useState<ReadonlyMap<string, ActBuild>>(new Map());
  const [liveAct, setLiveAct] = useState<ActBuild | null>(null);
  const [history, setHistory] = useState<readonly BookBuildSummary[]>([]);
  const [words, setWords] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const builder = useRef<BookBuilder | null>(null);
  /** Why each model was chosen — recorded on the build it starts (§19). */
  const routingNotes = useRef<ModelRouteNote[]>([]);

  const reload = useCallback(async () => {
    const [held, ids, threadList, characterList, relationshipList, chapterList, builds] =
      await Promise.all([
        repo.bookPlan.get(),
        repo.actPlans.list(),
        repo.listPlotThreads(),
        repo.listCharacters(),
        repo.listRelationships(),
        repo.listChapters(),
        repo.bookBuilds.list(),
      ]);
    setPlan(held);
    setDraft(held === null ? null : toDraft(held));
    setActIds(ids);
    const titles = new Map<string, string>();
    for (const id of ids) titles.set(id, (await repo.actPlans.get(id))?.title ?? id);
    setActTitles(titles);
    setThreads(threadList);
    setCharacters(characterList);
    setRelationships(relationshipList);
    setChapters([...chapterList].sort((a, b) => a.order - b.order));
    setHistory(builds);

    let total = 0;
    for (const chapter of chapterList) {
      const file = (await repo.readProjectFile(chapter.filePath)) ?? "";
      const text = file.replace(/<!--[^>]*-->/g, " ").trim();
      total += text === "" ? 0 : text.split(/\s+/).length;
    }
    setWords(total);

    const openId = builds.find(
      (entry) => entry.status !== "completed" && entry.status !== "cancelled",
    )?.id;
    if (openId !== undefined) {
      const build = await repo.bookBuilds.get(openId);
      setActive(build);
      if (build !== null) {
        const children = new Map<string, ActBuild>();
        for (const act of build.acts) {
          if (act.actBuildId === undefined) continue;
          const child = await repo.actBuilds.get(act.actBuildId);
          if (child !== null) children.set(act.actId, child);
        }
        setActiveActs(children);
      }
    }
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  const name = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of characters) map.set(c.id as string, c.name);
    for (const t of threads) map.set(t.id as string, t.name);
    for (const r of relationships) {
      map.set(
        r.id as string,
        `${map.get(r.characterAId as string) ?? "?"} · ${map.get(r.characterBId as string) ?? "?"}`,
      );
    }
    return (id: string) => map.get(id) ?? id;
  }, [characters, threads, relationships]);

  const ensureBuilder = useCallback(async (): Promise<BookBuilder> => {
    if (builder.current !== null) return builder.current;
    // Every slot resolves through the Model Router (Phase 36 §21): the policy,
    // privacy rules and pins in Settings decide which configured model does
    // which work, and every call the whole book build makes — through every
    // act and chapter — lands in the usage ledger (§10).
    const drafting = await createRoutedModel(repo, secrets, "scene_drafting");
    const analysis = await createRoutedModel(repo, secrets, "state_extraction").catch(
      () => undefined,
    );
    const planning = await createRoutedModel(repo, secrets, "chapter_planning").catch(
      () => undefined,
    );
    routingNotes.current = [drafting, analysis, planning]
      .map((routed) => (routed === undefined ? null : routeNote(routed.decision)))
      .filter((note): note is ModelRouteNote => note !== null);
    builder.current = new BookBuilder({
      repo,
      models: {
        drafting: drafting.model,
        ...(analysis === undefined ? {} : { analysis: analysis.model }),
        ...(planning === undefined ? {} : { planning: planning.model }),
      },
      grant: BOOK_GRANT,
      onProgress: (build) => setActive(build),
      onActProgress: (act) => setLiveAct(act),
    });
    return builder.current;
  }, [repo, secrets]);

  const run = useCallback(
    async (work: (b: BookBuilder) => Promise<BookBuild>) => {
      setBusy(true);
      setError(null);
      try {
        setActive(await work(await ensureBuilder()));
        onChanged();
        await reload();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [ensureBuilder, onChanged, reload],
  );

  const patch = (changes: Partial<PlanDraft>) => {
    setDraft((held) => (held === null ? null : { ...held, ...changes }));
  };

  const savePlan = async () => {
    if (draft === null) return;
    setBusy(true);
    setError(null);
    try {
      const source = plan?.source === "model" || plan?.source === "mixed" ? "mixed" : "author";
      const saved = await repo.saveBookPlan({ ...draft, status: "draft", source });
      setPlan(saved);
      setDraft(toDraft(saved));
      setFindings(await repo.validateBookPlan(saved));
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const newPlan = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await repo.saveBookPlan({
        id: "BOOKPLAN",
        projectId: repo.getManifest().id as string,
        status: "draft",
        acts: [],
        majorPlotThreads: [],
        characterArcGoals: [],
        relationshipArcGoals: [],
        mysteryIds: [],
        themes: [],
        promises: [],
        constraints: [],
        notes: [],
        storyTestIds: [],
        source: "author",
      });
      setPlan(saved);
      setDraft(toDraft(saved));
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const finished = active?.status === "completed" || active?.status === "cancelled";
  const running =
    active !== null &&
    !finished &&
    (active.status === "building" ||
      active.status === "planning" ||
      active.status === "validating");

  const progress = useMemo(() => {
    if (active === null) return "";
    const actIndex = active.acts.findIndex((act) => act.actId === active.currentActId);
    const child =
      active.currentActId === undefined ? undefined : activeActs.get(active.currentActId);
    const chapterIndex =
      child === undefined
        ? -1
        : child.chapters.findIndex((chapter) => chapter.chapterId === child.currentChapterId);
    return describeBookProgress({
      ...(actIndex >= 0 ? { act: { at: actIndex + 1, of: active.acts.length } } : {}),
      ...(child !== undefined && chapterIndex >= 0
        ? { chapter: { at: chapterIndex + 1, of: child.chapters.length } }
        : {}),
    });
  }, [active, activeActs]);

  const profiles = useMemo(() => routingProfiles(), []);

  const currentTask = useMemo(() => {
    if (liveAct === null || active === null || finished) return null;
    if (liveAct.currentChapterId !== undefined) {
      const chapter = liveAct.chapters.find((c) => c.chapterId === liveAct.currentChapterId);
      return chapter === undefined ? null : `Building “${chapter.title}”…`;
    }
    return null;
  }, [liveAct, active, finished]);

  return (
    <div className="abuild bbuild">
      {(active === null || finished) && draft !== null && plan !== null && (
        <section className="abuild__plan">
          <p className="abuild__meta">
            Book plan · {plan.status === "approved" ? "Approved" : "Draft"} · version {plan.version}
          </p>
          <label className="field">
            <span>Premise</span>
            <input
              value={draft.premise ?? ""}
              placeholder="The book in a breath"
              onChange={(e) =>
                patch(e.target.value === "" ? { premise: undefined } : { premise: e.target.value })
              }
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>Story goal</span>
            <input
              value={draft.storyGoal ?? ""}
              placeholder="What the whole book must accomplish"
              onChange={(e) =>
                patch(
                  e.target.value === "" ? { storyGoal: undefined } : { storyGoal: e.target.value },
                )
              }
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>Target words</span>
            <input
              type="number"
              min={0}
              value={draft.targetWords ?? ""}
              placeholder="guidance, never a quota"
              onChange={(e) =>
                patch(
                  e.target.value === ""
                    ? { targetWords: undefined }
                    : { targetWords: Number(e.target.value) },
                )
              }
              disabled={busy}
            />
          </label>

          <fieldset className="abuild__chapters-edit">
            <legend>Acts, in order</legend>
            {actIds.length === 0 && (
              <p className="hint">
                No act plans yet. Plan the acts first — the Write act panel is where an act's
                chapters and goals live.
              </p>
            )}
            {actIds.map((actId) => {
              const member = draft.acts.find((m) => m.actId === actId);
              return (
                <div key={actId} className="abuild__chapter-row">
                  <label className="abuild__chapter-tick">
                    <input
                      type="checkbox"
                      checked={member !== undefined}
                      disabled={busy}
                      onChange={(e) =>
                        patch({
                          acts: e.target.checked
                            ? [...draft.acts, { actId }]
                            : draft.acts.filter((m) => m.actId !== actId),
                        })
                      }
                    />
                    <span>{actTitles.get(actId) ?? actId}</span>
                  </label>
                  {member !== undefined && (
                    <input
                      className="abuild__role"
                      value={member.intent ?? ""}
                      placeholder="its job in the whole"
                      disabled={busy}
                      onChange={(e) =>
                        patch({
                          acts: draft.acts.map((m) =>
                            m.actId === actId
                              ? {
                                  ...m,
                                  ...(e.target.value === ""
                                    ? { intent: undefined }
                                    : { intent: e.target.value }),
                                }
                              : m,
                          ),
                        })
                      }
                    />
                  )}
                </div>
              );
            })}
          </fieldset>

          <details className="abuild__goals">
            <summary>
              Book goals (
              {draft.majorPlotThreads.length +
                draft.characterArcGoals.length +
                draft.relationshipArcGoals.length}
              )
            </summary>
            <div className="abuild__goal-group">
              <h4>Major plot threads</h4>
              {draft.majorPlotThreads.map((goal, index) => (
                <div key={index} className="abuild__goal-row">
                  <select
                    value={goal.threadId}
                    disabled={busy}
                    onChange={(e) =>
                      patch({
                        majorPlotThreads: draft.majorPlotThreads.map((g, i) =>
                          i === index ? { ...g, threadId: e.target.value } : g,
                        ),
                      })
                    }
                  >
                    {threads.map((t) => (
                      <option key={t.id} value={t.id as string}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <input
                    value={goal.intent}
                    placeholder="its arc across the book"
                    disabled={busy}
                    onChange={(e) =>
                      patch({
                        majorPlotThreads: draft.majorPlotThreads.map((g, i) =>
                          i === index ? { ...g, intent: e.target.value } : g,
                        ),
                      })
                    }
                  />
                  <button
                    className="btn btn--ghost btn--tiny"
                    title="Remove"
                    disabled={busy}
                    onClick={() =>
                      patch({
                        majorPlotThreads: draft.majorPlotThreads.filter((_, i) => i !== index),
                      })
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="btn btn--ghost btn--tiny"
                disabled={busy || threads.length === 0}
                onClick={() =>
                  patch({
                    majorPlotThreads: [
                      ...draft.majorPlotThreads,
                      { threadId: threads[0]?.id as string, intent: "" },
                    ],
                  })
                }
              >
                Add a thread
              </button>
            </div>
            <div className="abuild__goal-group">
              <h4>Character arcs</h4>
              {draft.characterArcGoals.map((goal, index) => (
                <div key={index} className="abuild__goal-row">
                  <select
                    value={goal.characterId}
                    disabled={busy}
                    onChange={(e) =>
                      patch({
                        characterArcGoals: draft.characterArcGoals.map((g, i) =>
                          i === index ? { ...g, characterId: e.target.value } : g,
                        ),
                      })
                    }
                  >
                    {characters.map((c) => (
                      <option key={c.id} value={c.id as string}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <input
                    value={goal.movement}
                    placeholder="guarded → trusting → betrayed → reconciled"
                    disabled={busy}
                    onChange={(e) =>
                      patch({
                        characterArcGoals: draft.characterArcGoals.map((g, i) =>
                          i === index ? { ...g, movement: e.target.value } : g,
                        ),
                      })
                    }
                  />
                  <button
                    className="btn btn--ghost btn--tiny"
                    title="Remove"
                    disabled={busy}
                    onClick={() =>
                      patch({
                        characterArcGoals: draft.characterArcGoals.filter((_, i) => i !== index),
                      })
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="btn btn--ghost btn--tiny"
                disabled={busy || characters.length === 0}
                onClick={() =>
                  patch({
                    characterArcGoals: [
                      ...draft.characterArcGoals,
                      { characterId: characters[0]?.id as string, movement: "" },
                    ],
                  })
                }
              >
                Add an arc
              </button>
            </div>
            <div className="abuild__goal-group">
              <h4>Relationship arcs</h4>
              {draft.relationshipArcGoals.map((goal, index) => (
                <div key={index} className="abuild__goal-row">
                  <select
                    value={goal.relationshipId}
                    disabled={busy}
                    onChange={(e) =>
                      patch({
                        relationshipArcGoals: draft.relationshipArcGoals.map((g, i) =>
                          i === index ? { ...g, relationshipId: e.target.value } : g,
                        ),
                      })
                    }
                  >
                    {relationships.map((r) => (
                      <option key={r.id} value={r.id as string}>
                        {name(r.id as string)}
                      </option>
                    ))}
                  </select>
                  <input
                    value={goal.intent}
                    placeholder="how it moves across the book"
                    disabled={busy}
                    onChange={(e) =>
                      patch({
                        relationshipArcGoals: draft.relationshipArcGoals.map((g, i) =>
                          i === index ? { ...g, intent: e.target.value } : g,
                        ),
                      })
                    }
                  />
                  <button
                    className="btn btn--ghost btn--tiny"
                    title="Remove"
                    disabled={busy}
                    onClick={() =>
                      patch({
                        relationshipArcGoals: draft.relationshipArcGoals.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="btn btn--ghost btn--tiny"
                disabled={busy || relationships.length === 0}
                onClick={() =>
                  patch({
                    relationshipArcGoals: [
                      ...draft.relationshipArcGoals,
                      { relationshipId: relationships[0]?.id as string, intent: "" },
                    ],
                  })
                }
              >
                Add a relationship arc
              </button>
            </div>
            <div className="abuild__goal-group">
              <h4>Promises to the reader</h4>
              <textarea
                rows={2}
                value={draft.promises.join("\n")}
                placeholder="one per line"
                disabled={busy}
                onChange={(e) =>
                  patch({
                    promises: e.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter((line) => line !== ""),
                  })
                }
              />
            </div>
          </details>

          <div className="abuild__plan-actions">
            <button className="btn btn--small" disabled={busy} onClick={() => void savePlan()}>
              Save the plan
            </button>
            <button
              className="btn btn--small"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  const held = await repo.bookPlan.get();
                  if (held !== null) setFindings(await repo.validateBookPlan(held));
                })();
              }}
            >
              Check the plan
            </button>
            {plan.status !== "approved" && (
              <button
                className="btn btn--primary btn--small"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      const approved = await repo.approveBookPlan();
                      setPlan(approved);
                      setDraft(toDraft(approved));
                      onChanged();
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : String(cause));
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                Approve the plan
              </button>
            )}
          </div>

          {findings !== null && (
            <ul className="abuild__findings">
              {findings.length === 0 ? (
                <li className="severity severity--info">
                  <span className="severity__word">CLEAR</span> Nothing contradicts the project.
                </li>
              ) : (
                findings.map((finding, index) => (
                  <li key={index} className={`severity severity--${finding.severity}`}>
                    <span className="severity__word">{finding.severity.toUpperCase()}</span>{" "}
                    {finding.message}
                  </li>
                ))
              )}
            </ul>
          )}

          {plan.status === "approved" && (
            <div className="abuild__start">
              <div className="bbuild__preflight">
                <h4>Before it starts</h4>
                <ul>
                  <li>Version: {branchId}</li>
                  <li>
                    Scope: {plan.acts.length} act(s) · {chapters.length} chapter(s)
                    {words !== null && words > 0
                      ? ` · the manuscript already holds ${String(words)} words (existing prose is kept)`
                      : ""}
                  </li>
                  <li>A checkpoint is taken before anything is written.</li>
                </ul>
                <p className="hint">
                  For a hands-off run, consider building on a separate version first — Versions can
                  branch the project, and a draft build merges back on your terms.
                </p>
              </div>
              <fieldset className="abuild__policies">
                <legend>Approval</legend>
                {(Object.keys(POLICY_COPY) as BookBuild["approvalPolicy"][]).map((entry) => (
                  <label key={entry} className="abuild__policy">
                    <input
                      type="radio"
                      name="bbuild-policy"
                      checked={policy === entry}
                      onChange={() => setPolicy(entry)}
                      disabled={busy}
                    />
                    <span>
                      <strong>{POLICY_COPY[entry].label}</strong>
                      <span className="abuild__hint">{POLICY_COPY[entry].hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <button
                className="btn btn--primary btn--small"
                disabled={busy}
                onClick={() =>
                  void run((b) =>
                    b.start({ branchId, approvalPolicy: policy, routing: routingNotes.current }),
                  )
                }
              >
                {busy ? "Working…" : "Build the book"}
              </button>
            </div>
          )}
        </section>
      )}

      {(active === null || finished) && draft === null && (
        <section className="abuild__plan">
          <p className="abuild__intro">
            A book build works from the planning hierarchy: the book plan names the acts, each act
            plan names its chapters, and every chapter is built scene by scene from the project's
            current state.
          </p>
          <button
            className="btn btn--primary btn--small"
            disabled={busy}
            onClick={() => void newPlan()}
          >
            Start a book plan
          </button>
        </section>
      )}

      {active !== null && !finished && (
        <section className="abuild__run">
          <header className="abuild__head">
            <h3 className="abuild__title">{repo.getManifest().title}</h3>
            <span className={`abuild__status abuild__status--${active.status}`} role="status">
              {describeStatus(active)}
            </span>
          </header>

          <ol className="abuild__chapters bbuild__acts">
            {active.acts.map((act) => {
              const child = activeActs.get(act.actId);
              return (
                <li key={act.actId} className={`bbuild__act bbuild__act--${act.status}`}>
                  <div className="abuild__chapter">
                    <span className="abuild__glyph" aria-hidden="true">
                      {ACT_GLYPH[act.status]}
                    </span>
                    <span className="abuild__chapter-name">{act.title}</span>
                    <span className="abuild__chapter-meta">
                      {act.status === "completed" && act.words !== undefined
                        ? `${String(act.words)} words`
                        : act.status === "pending"
                          ? "not started"
                          : ""}
                    </span>
                  </div>
                  {child !== undefined && act.status !== "pending" && (
                    <ul className="bbuild__chapters">
                      {child.chapters.map((chapter) => (
                        <li
                          key={chapter.chapterId}
                          className={`abuild__chapter abuild__chapter--${chapter.status}`}
                        >
                          <span className="abuild__glyph" aria-hidden="true">
                            {chapter.status === "completed"
                              ? "✓"
                              : chapter.status === "building"
                                ? "→"
                                : chapter.status === "failed"
                                  ? "!"
                                  : "○"}
                          </span>
                          <span className="abuild__chapter-name">{chapter.title}</span>
                          <span className="abuild__chapter-meta">
                            {chapter.status === "completed" && chapter.words !== undefined
                              ? `${String(chapter.words)} words`
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>

          <p className="bbuild__now">
            {currentTask ?? describeStatus(active)}
            {progress === "" ? "" : ` · ${progress}`}
            {words !== null ? ` · ${String(words)} words` : ""}
          </p>

          {Object.keys(active.usage.byClass).length > 0 && (
            <p className="hint">
              {Object.entries(active.usage.byClass)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(
                  ([cls, entry]) =>
                    `${cls.replaceAll("_", " ")}: ${describeClassUsage(
                      entry,
                      active.modelAssignments[cls as RoutingClass],
                      profiles,
                    )}`,
                )
                .join(" · ")}
            </p>
          )}

          {active.routing !== undefined && active.routing.length > 0 && (
            <details className="abuild__goalreport">
              <summary>Why these models</summary>
              <ul>
                {active.routing.map((note) => (
                  <li key={note.operation} className="hint">
                    {note.operation.replaceAll("_", " ")} → {note.modelId}. {note.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {active.goalReport !== undefined && (
            <details className="abuild__goalreport">
              <summary>
                Book goals: {active.goalReport.satisfied} / {active.goalReport.results.length}{" "}
                currently satisfied
              </summary>
              <ul>
                {active.goalReport.results.map((result, index) => (
                  <li key={index} className={`abuild__goal abuild__goal--${result.status}`}>
                    <span className="abuild__goal-glyph" aria-hidden="true">
                      {result.status === "satisfied"
                        ? "✓"
                        : result.status === "unsatisfied"
                          ? "○"
                          : "—"}
                    </span>
                    <span>
                      {result.statement}
                      <span className="abuild__goal-evidence">
                        {" "}
                        {result.method === "semantic" ? "(your reading)" : result.evidence}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {active.pending !== undefined && (
            <div className="abuild__gate">
              <p className="abuild__question">{active.pending.question}</p>
              <div className="abuild__actions">
                <button
                  className="btn btn--primary btn--small"
                  disabled={busy}
                  onClick={() => void run((b) => b.approve(active.id))}
                >
                  {active.pending.kind === "act_plan" ? "Approve the plan" : "Keep going"}
                </button>
                <button
                  className="btn btn--small"
                  disabled={busy}
                  onClick={() => void run((b) => b.rejectPending(active.id, "declined"))}
                >
                  Not this
                </button>
              </div>
            </div>
          )}

          {(active.status === "paused" || active.status === "failed") && (
            <div className="abuild__actions">
              <button
                className="btn btn--primary btn--small"
                disabled={busy}
                onClick={() => void run((b) => b.resume(active.id))}
              >
                Resume
              </button>
            </div>
          )}

          {!finished && (
            <div className="abuild__actions">
              {running && (
                <button
                  className="btn btn--ghost btn--small"
                  onClick={() => builder.current?.requestPause(active.id)}
                >
                  Pause
                </button>
              )}
              <button
                className="btn btn--ghost btn--small"
                disabled={busy}
                onClick={() => void run((b) => b.cancel(active.id))}
              >
                Cancel
              </button>
            </div>
          )}

          {active.diagnostics.length > 0 && (
            <details className="abuild__diagnostics">
              <summary>What the build noted ({active.diagnostics.length})</summary>
              <ul>
                {active.diagnostics.slice(-16).map((diagnostic, index) => (
                  <li
                    key={index}
                    className={`severity severity--${
                      diagnostic.severity === "semantic_concern" ? "info" : diagnostic.severity
                    }`}
                  >
                    <span className="severity__word">
                      {diagnostic.severity === "semantic_concern"
                        ? "YOUR CALL"
                        : diagnostic.severity.toUpperCase()}
                    </span>{" "}
                    {diagnostic.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {active !== null && active.status === "completed" && active.report !== undefined && (
        <section className="bbuild__report">
          <h4>{active.report.label}</h4>
          <dl className="bbuild__figures">
            <div>
              <dt>Words</dt>
              <dd>{active.report.words}</dd>
            </div>
            <div>
              <dt>Acts</dt>
              <dd>
                {active.report.actsCompleted} / {active.report.actsTotal}
              </dd>
            </div>
            <div>
              <dt>Chapters</dt>
              <dd>
                {active.report.chaptersCompleted} / {active.report.chaptersTotal}
              </dd>
            </div>
            <div>
              <dt>Scenes</dt>
              <dd>{active.report.scenes}</dd>
            </div>
            <div>
              <dt>Story Compiler</dt>
              <dd>
                {active.report.compilerErrors} errors · {active.report.compilerWarnings} warnings
              </dd>
            </div>
            <div>
              <dt>Story tests</dt>
              <dd>
                {active.report.testsPassed} / {active.report.testsTotal} passed
              </dd>
            </div>
            <div>
              <dt>Unresolved threads</dt>
              <dd>{active.report.unresolvedThreads.length}</dd>
            </div>
            <div>
              <dt>Your calls</dt>
              <dd>{active.report.semanticConcerns}</dd>
            </div>
          </dl>
          {active.report.failingTests.length > 0 && (
            <ul className="abuild__findings">
              {active.report.failingTests.map((failure) => (
                <li key={failure.testId} className="severity severity--error">
                  <span className="severity__word">FAILING</span> {failure.statement}
                </li>
              ))}
            </ul>
          )}
          {active.report.unresolvedThreads.length > 0 && (
            <ul className="abuild__findings">
              {active.report.unresolvedThreads.map((thread) => (
                <li key={thread.threadId} className="severity severity--warning">
                  <span className="severity__word">OPEN</span> {thread.name}
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            A draft build: the pipeline finished and every claim above is on the record. Editing and
            revision are their own future work — nothing here calls the book done.
          </p>
        </section>
      )}

      {error !== null && (
        <p className="status status--error" role="alert">
          {error}
        </p>
      )}

      {history.length > 0 && (
        <details className="abuild__history">
          <summary>Past book builds ({history.length})</summary>
          <ul>
            {history.map((entry) => (
              <li key={entry.id} className="abuild__past" title={entry.id}>
                <span>
                  {entry.variant === "first_draft" ? "First draft" : entry.variant} · {entry.status}
                </span>
                <span className="abuild__past-meta">
                  {entry.actsCompleted}/{entry.actsTotal} acts
                  {entry.words !== undefined ? ` · ${String(entry.words)} words` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function describeStatus(build: BookBuild): string {
  switch (build.status) {
    case "building": {
      const current = build.acts.find((act) => act.actId === build.currentActId);
      return current === undefined ? "Building…" : `Building ${current.title}…`;
    }
    case "planning":
      return "Confirming plans…";
    case "validating":
      return "Evaluating the book…";
    case "awaiting_approval":
      return "Waiting for you";
    case "paused":
      return "Paused";
    case "failed":
      return "Stopped on an error";
    case "completed":
      return "Draft build complete";
    case "cancelled":
      return "Cancelled";
    default:
      return "Preparing…";
  }
}
