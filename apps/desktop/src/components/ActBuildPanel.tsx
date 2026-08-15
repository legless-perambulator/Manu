import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PermissionGrant } from "@jellytind/agent-runtime";
import type {
  ActBuild,
  ActBuildSummary,
  ActChapterRecord,
  ActPlan,
  ActPlanFinding,
  Chapter,
  ChapterPlan,
  Character,
  Fact,
  ModelRouteNote,
  PlotThread,
  Relationship,
  Setup,
} from "@jellytind/domain";
import { CHAPTER_ROLE_SUGGESTIONS } from "@jellytind/domain";
import { ActBuilder } from "@jellytind/editing";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import { createRoutedModel, routeNote } from "../lib/routing";
import { chapterNumberLabel } from "../lib/naming";

interface Props {
  repo: StoryRepository;
  secrets: SecretStore;
  branchId: string;
  refreshToken: number;
  onChanged: () => void;
}

/**
 * Building an act edits the manuscript, proposes state changes, and drafts
 * chapter plans for review. Approval of anything stays with the writer.
 */
const ACT_GRANT: PermissionGrant = {
  permissions: [
    "read_manuscript",
    "read_canon",
    "edit_manuscript",
    "edit_story_state",
    "edit_plans",
  ],
  allowedTools: ["build_act", "build_chapter", "analyse_state_changes", "create_chapter_plan"],
};

const POLICY_COPY = {
  every_chapter: {
    label: "Show me every chapter",
    hint: "Pauses after each chapter is built, and once more at the end.",
  },
  plan_and_final: {
    label: "Plan up front, show me the act",
    hint: "Runs the chapters hands-off; you decide once, on the finished act.",
  },
  auto_until_error: {
    label: "Build until something is wrong",
    hint: "Commits as it goes — checkpointed — and stops on errors and stale plans.",
  },
} as const;

const AUTONOMY_COPY = {
  pause: {
    label: "Stop and tell me",
    hint: "When a chapter's outcome breaks a later plan, the act stops and names it.",
  },
  propose: {
    label: "Draft me an update first",
    hint: "Manu proposes a revised plan for the affected chapter, then stops for review.",
  },
} as const;

const CHAPTER_GLYPH: Readonly<Record<ActChapterRecord["status"], string>> = {
  pending: "○",
  building: "→",
  completed: "✓",
  failed: "!",
};

/** The editable shape a plan is worked on as, before it is saved. */
type PlanDraft = Parameters<StoryRepository["saveActPlan"]>[0];

function toDraft(plan: ActPlan): PlanDraft {
  const { version: _v, revisions: _r, updatedAt: _u, ...rest } = plan;
  return rest;
}

/**
 * The Act view (§15–16): the plan an act is working toward — chapters, roles
 * and goals — and the build that carries it out, chapter by chapter, with the
 * goals' standing always in sight. Manual first: everything here except
 * "draft plans for me" works with no model configured.
 */
export function ActBuildPanel({ repo, secrets, branchId, refreshToken, onChanged }: Props) {
  const [actIds, setActIds] = useState<readonly string[]>([]);
  const [actId, setActId] = useState<string>("");
  const [plan, setPlan] = useState<ActPlan | null>(null);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [findings, setFindings] = useState<readonly ActPlanFinding[] | null>(null);
  const [chapters, setChapters] = useState<readonly Chapter[]>([]);
  const [threads, setThreads] = useState<readonly PlotThread[]>([]);
  const [characters, setCharacters] = useState<readonly Character[]>([]);
  const [relationships, setRelationships] = useState<readonly Relationship[]>([]);
  const [setups, setSetups] = useState<readonly Setup[]>([]);
  const [facts, setFacts] = useState<readonly Fact[]>([]);
  const [policy, setPolicy] = useState<ActBuild["approvalPolicy"]>("every_chapter");
  const [autonomy, setAutonomy] = useState<ActBuild["autonomy"]>("pause");
  const [generatePlans, setGeneratePlans] = useState(false);
  const [active, setActive] = useState<ActBuild | null>(null);
  const [history, setHistory] = useState<readonly ActBuildSummary[]>([]);
  const [inspected, setInspected] = useState<string | null>(null);
  const [inspectedPlan, setInspectedPlan] = useState<ChapterPlan | null>(null);
  const [replanText, setReplanText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const builder = useRef<ActBuilder | null>(null);
  /** Why each model was chosen — recorded on the build it starts (§19). */
  const routingNotes = useRef<ModelRouteNote[]>([]);

  const reload = useCallback(async () => {
    const [ids, list, threadList, characterList, relationshipList, setupList, factList, builds] =
      await Promise.all([
        repo.actPlans.list(),
        repo.listChapters(),
        repo.listPlotThreads(),
        repo.listCharacters(),
        repo.listRelationships(),
        repo.listSetups(),
        repo.listFacts(),
        repo.actBuilds.list(),
      ]);
    setActIds(ids);
    setChapters([...list].sort((a, b) => a.order - b.order));
    setThreads(threadList);
    setCharacters(characterList);
    setRelationships(relationshipList);
    setSetups(setupList);
    setFacts(factList);
    setHistory(builds);
    const openId = builds.find(
      (entry) => entry.status !== "completed" && entry.status !== "cancelled",
    )?.id;
    if (openId !== undefined) setActive(await repo.actBuilds.get(openId));
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  useEffect(() => {
    if (actId === "") {
      setPlan(null);
      setDraft(null);
      setFindings(null);
      return;
    }
    void repo.actPlans.get(actId).then((held) => {
      setPlan(held);
      setDraft(held === null ? null : toDraft(held));
      setFindings(null);
    });
  }, [repo, actId, refreshToken]);

  const name = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of characters) map.set(c.id as string, c.name);
    for (const t of threads) map.set(t.id as string, t.name);
    for (const c of chapters) map.set(c.id as string, c.title);
    for (const s of setups) map.set(s.id as string, s.description);
    for (const f of facts) map.set(f.id as string, f.statement);
    for (const r of relationships) {
      map.set(
        r.id as string,
        `${map.get(r.characterAId as string) ?? "?"} · ${map.get(r.characterBId as string) ?? "?"}`,
      );
    }
    return (id: string) => map.get(id) ?? id;
  }, [characters, threads, chapters, setups, facts, relationships]);

  const ensureBuilder = useCallback(async (): Promise<ActBuilder> => {
    if (builder.current !== null) return builder.current;
    // Every slot resolves through the Model Router, so the policy, privacy
    // rules and pins decide, and every call lands in the usage ledger
    // (Phase 36 §10, §21). Analysis and planning stay optional: the pipeline
    // says honestly when either is absent.
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
    builder.current = new ActBuilder({
      repo,
      models: {
        drafting: drafting.model,
        ...(analysis === undefined ? {} : { analysis: analysis.model }),
        ...(planning === undefined ? {} : { planning: planning.model }),
      },
      grant: ACT_GRANT,
      onProgress: (build) => setActive(build),
    });
    return builder.current;
  }, [repo, secrets]);

  const run = useCallback(
    async (work: (b: ActBuilder) => Promise<ActBuild>) => {
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
      const saved = await repo.saveActPlan({ ...draft, status: "draft", source });
      setPlan(saved);
      setDraft(toDraft(saved));
      setFindings(await repo.validateActPlan(saved));
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const newAct = async () => {
    setBusy(true);
    setError(null);
    try {
      const nextId = await repo.actPlans.nextActId();
      const ordinal = actIds.length + 1;
      const saved = await repo.saveActPlan({
        id: `PLANFOR_${nextId}`,
        actId: nextId,
        title: `Act ${["I", "II", "III", "IV", "V", "VI"][ordinal - 1] ?? String(ordinal)}`,
        status: "draft",
        chapters: [],
        plotThreadGoals: [],
        characterArcGoals: [],
        relationshipGoals: [],
        requiredSetupIds: [],
        requiredPayoffIds: [],
        forbiddenFacts: [],
        constraints: [],
        notes: [],
        storyTestIds: [],
        source: "author",
      });
      setActIds([...actIds, nextId]);
      setActId(nextId);
      setPlan(saved);
      setDraft(toDraft(saved));
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const inspect = async (chapterId: string) => {
    if (inspected === chapterId) {
      setInspected(null);
      setInspectedPlan(null);
      return;
    }
    setInspected(chapterId);
    setInspectedPlan(await repo.plans.get(chapterId));
  };

  const finished = active?.status === "completed" || active?.status === "cancelled";
  const running =
    active !== null &&
    !finished &&
    (active.status === "building" ||
      active.status === "planning" ||
      active.status === "validating");

  return (
    <div className="abuild">
      {(active === null || finished) && (
        <section className="abuild__plan">
          <div className="abuild__pick">
            <label className="field field--grow">
              <span>Act</span>
              <select value={actId} onChange={(e) => setActId(e.target.value)} disabled={busy}>
                <option value="">Pick an act…</option>
                {actIds.map((id) => (
                  <option key={id} value={id}>
                    {id === actId && plan !== null ? plan.title : id}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn--small" disabled={busy} onClick={() => void newAct()}>
              New act
            </button>
          </div>

          {draft !== null && plan !== null && (
            <>
              <p className="abuild__meta">
                {plan.status === "approved" ? "Approved" : "Draft"} · version {plan.version}
                {plan.source === "author" ? "" : ` · ${plan.source}`}
              </p>
              <label className="field">
                <span>Name</span>
                <input
                  value={draft.title}
                  onChange={(e) => patch({ title: e.target.value })}
                  disabled={busy}
                />
              </label>
              <label className="field">
                <span>Objective</span>
                <input
                  value={draft.objective ?? ""}
                  placeholder="What this act is for, in your words"
                  onChange={(e) =>
                    patch(
                      e.target.value === ""
                        ? { objective: undefined }
                        : { objective: e.target.value },
                    )
                  }
                  disabled={busy}
                />
              </label>
              <label className="field">
                <span>By its end</span>
                <input
                  value={draft.targetClosingState ?? ""}
                  placeholder="Where things must stand leaving the act"
                  onChange={(e) =>
                    patch(
                      e.target.value === ""
                        ? { targetClosingState: undefined }
                        : { targetClosingState: e.target.value },
                    )
                  }
                  disabled={busy}
                />
              </label>

              <fieldset className="abuild__chapters-edit">
                <legend>Chapters</legend>
                {chapters.map((chapter, index) => {
                  const member = draft.chapters.find((m) => m.chapterId === (chapter.id as string));
                  return (
                    <div key={chapter.id} className="abuild__chapter-row">
                      <label className="abuild__chapter-tick">
                        <input
                          type="checkbox"
                          checked={member !== undefined}
                          disabled={busy}
                          onChange={(e) =>
                            patch({
                              chapters: e.target.checked
                                ? [...draft.chapters, { chapterId: chapter.id as string }]
                                : draft.chapters.filter(
                                    (m) => m.chapterId !== (chapter.id as string),
                                  ),
                            })
                          }
                        />
                        <span>
                          {chapterNumberLabel(index)} — {chapter.title}
                        </span>
                      </label>
                      {member !== undefined && (
                        <input
                          className="abuild__role"
                          value={member.role ?? ""}
                          placeholder="role in the act"
                          list="abuild-roles"
                          disabled={busy}
                          onChange={(e) =>
                            patch({
                              chapters: draft.chapters.map((m) =>
                                m.chapterId === member.chapterId
                                  ? {
                                      ...m,
                                      ...(e.target.value === ""
                                        ? { role: undefined }
                                        : { role: e.target.value }),
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
                <datalist id="abuild-roles">
                  {CHAPTER_ROLE_SUGGESTIONS.map((role) => (
                    <option key={role} value={role} />
                  ))}
                </datalist>
              </fieldset>

              <details className="abuild__goals">
                <summary>Goals ({goalCount(draft)})</summary>

                <div className="abuild__goal-group">
                  <h4>Plot threads</h4>
                  {draft.plotThreadGoals.map((goal, index) => (
                    <div key={index} className="abuild__goal-row">
                      <select
                        value={goal.threadId}
                        disabled={busy}
                        onChange={(e) =>
                          patch({
                            plotThreadGoals: draft.plotThreadGoals.map((g, i) =>
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
                        placeholder="what should happen to it"
                        disabled={busy}
                        onChange={(e) =>
                          patch({
                            plotThreadGoals: draft.plotThreadGoals.map((g, i) =>
                              i === index ? { ...g, intent: e.target.value } : g,
                            ),
                          })
                        }
                      />
                      <input
                        className="abuild__num"
                        type="number"
                        min={0}
                        value={goal.minAdvances ?? ""}
                        placeholder="×"
                        title="How many act scenes must touch it (leave empty for intent only)"
                        disabled={busy}
                        onChange={(e) =>
                          patch({
                            plotThreadGoals: draft.plotThreadGoals.map((g, i) => {
                              if (i !== index) return g;
                              const { minAdvances: _m, ...rest } = g;
                              return e.target.value === ""
                                ? rest
                                : { ...rest, minAdvances: Number(e.target.value) };
                            }),
                          })
                        }
                      />
                      <button
                        className="btn btn--ghost btn--tiny"
                        title="Remove"
                        disabled={busy}
                        onClick={() =>
                          patch({
                            plotThreadGoals: draft.plotThreadGoals.filter((_, i) => i !== index),
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
                        plotThreadGoals: [
                          ...draft.plotThreadGoals,
                          { threadId: threads[0]?.id as string, intent: "" },
                        ],
                      })
                    }
                  >
                    Add a thread goal
                  </button>
                </div>

                <div className="abuild__goal-group">
                  <h4>Character movement</h4>
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
                        placeholder="how they should move"
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
                            characterArcGoals: draft.characterArcGoals.filter(
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
                    Add a character goal
                  </button>
                </div>

                <div className="abuild__goal-group">
                  <h4>Relationships</h4>
                  {draft.relationshipGoals.map((goal, index) => (
                    <div key={index} className="abuild__goal-row">
                      <select
                        value={goal.relationshipId}
                        disabled={busy}
                        onChange={(e) =>
                          patch({
                            relationshipGoals: draft.relationshipGoals.map((g, i) =>
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
                        placeholder="how it should move"
                        disabled={busy}
                        onChange={(e) =>
                          patch({
                            relationshipGoals: draft.relationshipGoals.map((g, i) =>
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
                            relationshipGoals: draft.relationshipGoals.filter(
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
                        relationshipGoals: [
                          ...draft.relationshipGoals,
                          { relationshipId: relationships[0]?.id as string, intent: "" },
                        ],
                      })
                    }
                  >
                    Add a relationship goal
                  </button>
                </div>

                {setups.length > 0 && (
                  <div className="abuild__goal-group">
                    <h4>Setups and payoffs</h4>
                    {setups.map((setup) => (
                      <div key={setup.id} className="abuild__setup-row">
                        <span className="abuild__setup-name">{setup.description}</span>
                        <label>
                          <input
                            type="checkbox"
                            checked={draft.requiredSetupIds.includes(setup.id as string)}
                            disabled={busy}
                            onChange={(e) =>
                              patch({
                                requiredSetupIds: e.target.checked
                                  ? [...draft.requiredSetupIds, setup.id as string]
                                  : draft.requiredSetupIds.filter(
                                      (id) => id !== (setup.id as string),
                                    ),
                              })
                            }
                          />
                          plant here
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={draft.requiredPayoffIds.includes(setup.id as string)}
                            disabled={busy}
                            onChange={(e) =>
                              patch({
                                requiredPayoffIds: e.target.checked
                                  ? [...draft.requiredPayoffIds, setup.id as string]
                                  : draft.requiredPayoffIds.filter(
                                      (id) => id !== (setup.id as string),
                                    ),
                              })
                            }
                          />
                          pay off here
                        </label>
                      </div>
                    ))}
                  </div>
                )}

                {facts.length > 0 && (
                  <div className="abuild__goal-group">
                    <h4>Must stay withheld</h4>
                    {draft.forbiddenFacts.map((constraint, index) => (
                      <div key={index} className="abuild__goal-row">
                        <select
                          value={constraint.factId}
                          disabled={busy}
                          onChange={(e) =>
                            patch({
                              forbiddenFacts: draft.forbiddenFacts.map((f, i) =>
                                i === index ? { ...f, factId: e.target.value } : f,
                              ),
                            })
                          }
                        >
                          {facts.map((fact) => (
                            <option key={fact.id} value={fact.id as string}>
                              {fact.statement}
                            </option>
                          ))}
                        </select>
                        <input
                          value={constraint.reason ?? ""}
                          placeholder="why"
                          disabled={busy}
                          onChange={(e) =>
                            patch({
                              forbiddenFacts: draft.forbiddenFacts.map((f, i) => {
                                if (i !== index) return f;
                                const { reason: _r, ...rest } = f;
                                return e.target.value === ""
                                  ? rest
                                  : { ...rest, reason: e.target.value };
                              }),
                            })
                          }
                        />
                        <button
                          className="btn btn--ghost btn--tiny"
                          title="Remove"
                          disabled={busy}
                          onClick={() =>
                            patch({
                              forbiddenFacts: draft.forbiddenFacts.filter((_, i) => i !== index),
                            })
                          }
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      className="btn btn--ghost btn--tiny"
                      disabled={busy}
                      onClick={() =>
                        patch({
                          forbiddenFacts: [
                            ...draft.forbiddenFacts,
                            { factId: facts[0]?.id as string },
                          ],
                        })
                      }
                    >
                      Add a withheld fact
                    </button>
                  </div>
                )}
              </details>

              <div className="abuild__plan-actions">
                <button className="btn btn--small" disabled={busy} onClick={() => void savePlan()}>
                  Save the plan
                </button>
                <button
                  className="btn btn--small"
                  disabled={busy || plan === null}
                  onClick={() => {
                    void (async () => {
                      const held = await repo.actPlans.get(actId);
                      if (held !== null) setFindings(await repo.validateActPlan(held));
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
                          const approved = await repo.approveActPlan(actId);
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
                  <fieldset className="abuild__policies">
                    <legend>Approval</legend>
                    {(Object.keys(POLICY_COPY) as ActBuild["approvalPolicy"][]).map((entry) => (
                      <label key={entry} className="abuild__policy">
                        <input
                          type="radio"
                          name="abuild-policy"
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
                  <fieldset className="abuild__policies">
                    <legend>If a later plan stops holding</legend>
                    {(Object.keys(AUTONOMY_COPY) as ActBuild["autonomy"][]).map((entry) => (
                      <label key={entry} className="abuild__policy">
                        <input
                          type="radio"
                          name="abuild-autonomy"
                          checked={autonomy === entry}
                          onChange={() => setAutonomy(entry)}
                          disabled={busy}
                        />
                        <span>
                          <strong>{AUTONOMY_COPY[entry].label}</strong>
                          <span className="abuild__hint">{AUTONOMY_COPY[entry].hint}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <label className="abuild__tick">
                    <input
                      type="checkbox"
                      checked={generatePlans}
                      onChange={(e) => setGeneratePlans(e.target.checked)}
                      disabled={busy}
                    />
                    <span>Draft plans for chapters that have none, for my review</span>
                  </label>
                  <button
                    className="btn btn--primary btn--small"
                    disabled={busy}
                    onClick={() =>
                      void run((b) =>
                        b.start({
                          actId,
                          branchId,
                          approvalPolicy: policy,
                          autonomy,
                          generateMissingPlans: generatePlans,
                          routing: routingNotes.current,
                        }),
                      )
                    }
                  >
                    {busy ? "Working…" : "Build the act"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {active !== null && !finished && (
        <section className="abuild__run">
          <header className="abuild__head">
            <h3 className="abuild__title">{active.title}</h3>
            <span className={`abuild__status abuild__status--${active.status}`} role="status">
              {describeStatus(active)}
            </span>
          </header>

          {active.openingNotes.length > 0 && (
            <details className="abuild__opening">
              <summary>Where the act started</summary>
              <ul>
                {active.openingNotes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </details>
          )}

          <ol className="abuild__chapters">
            {active.chapters.map((chapter) => (
              <li
                key={chapter.chapterId}
                className={`abuild__chapter abuild__chapter--${chapter.status}`}
              >
                <span className="abuild__glyph" aria-hidden="true">
                  {CHAPTER_GLYPH[chapter.status]}
                </span>
                <button
                  className="abuild__chapter-name"
                  title="Show this chapter's plan"
                  onClick={() => void inspect(chapter.chapterId)}
                >
                  {chapter.title}
                </button>
                <span className="abuild__chapter-meta">
                  {chapter.role ?? ""}
                  {chapter.planStale === true ? " · plan needs another look" : ""}
                  {chapter.status === "completed" && chapter.words !== undefined
                    ? ` · ${String(chapter.words)} words`
                    : ""}
                </span>
              </li>
            ))}
          </ol>

          {inspected !== null && (
            <div className="abuild__inspect">
              {inspectedPlan === null ? (
                <p className="hint">
                  No chapter plan — this chapter builds from its scene records.
                </p>
              ) : (
                <>
                  <p className="abuild__meta">
                    {inspectedPlan.status === "approved" ? "Approved plan" : "Draft plan"} · version{" "}
                    {inspectedPlan.version}
                    {inspectedPlan.objective === undefined ? "" : ` — ${inspectedPlan.objective}`}
                  </p>
                  <ul className="abuild__inspect-scenes">
                    {inspectedPlan.scenes.map((scene) => (
                      <li key={scene.key}>
                        <strong>{scene.title}</strong>
                        {scene.beats.length > 0 && (
                          <ul>
                            {scene.beats.map((beat, index) => (
                              <li key={index}>{beat}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {active.goalReport !== undefined && (
            <details className="abuild__goalreport">
              <summary>
                Act goals: {active.goalReport.satisfied} / {active.goalReport.results.length}{" "}
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
                  {active.pending.kind === "chapter_plan" || active.pending.kind === "stale_plan"
                    ? "Approve the plan"
                    : "Keep going"}
                </button>
                <button
                  className="btn btn--small"
                  disabled={busy}
                  onClick={() => void run((b) => b.rejectPending(active.id, "declined"))}
                >
                  {active.pending.kind === "chapter_plan" ? "No — build without it" : "Not yet"}
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
              <details className="abuild__replan">
                <summary>Replan the remaining act</summary>
                <p className="hint">
                  Manu drafts fresh plans for the chapters not yet built — completed chapters are
                  untouched. You review and approve each plan before it is used.
                </p>
                <textarea
                  rows={2}
                  value={replanText}
                  placeholder="Anything the new plans should honour (optional)"
                  onChange={(e) => setReplanText(e.target.value)}
                  disabled={busy}
                />
                <button
                  className="btn btn--small"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        const b = await ensureBuilder();
                        await b.replanRemaining(active.id, {
                          ...(replanText.trim() === "" ? {} : { instruction: replanText.trim() }),
                        });
                        setActive(await repo.actBuilds.get(active.id));
                        onChanged();
                      } catch (cause) {
                        setError(cause instanceof Error ? cause.message : String(cause));
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  Draft new plans
                </button>
              </details>
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
                {active.diagnostics.slice(-14).map((diagnostic, index) => (
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

      {error !== null && (
        <p className="status status--error" role="alert">
          {error}
        </p>
      )}

      {history.length > 0 && (
        <details className="abuild__history">
          <summary>Past act builds ({history.length})</summary>
          <ul>
            {history.map((entry) => (
              <li key={entry.id} className="abuild__past" title={entry.id}>
                <span>{entry.title}</span>
                <span className="abuild__past-meta">
                  {entry.chaptersCompleted}/{entry.chaptersTotal} chapters
                  {entry.goalsTotal !== undefined
                    ? ` · ${String(entry.goalsSatisfied ?? 0)}/${String(entry.goalsTotal)} goals`
                    : ""}{" "}
                  · {entry.status}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function goalCount(draft: PlanDraft): number {
  return (
    draft.plotThreadGoals.length +
    draft.characterArcGoals.length +
    draft.relationshipGoals.length +
    draft.requiredSetupIds.length +
    draft.requiredPayoffIds.length +
    draft.forbiddenFacts.length
  );
}

function describeStatus(build: ActBuild): string {
  switch (build.status) {
    case "building": {
      const current = build.chapters.find((c) => c.chapterId === build.currentChapterId);
      return current === undefined ? "Building…" : `Building “${current.title}”…`;
    }
    case "planning":
      return "Confirming plans…";
    case "validating":
      return "Evaluating the act…";
    case "awaiting_approval":
      return "Waiting for you";
    case "paused":
      return "Paused";
    case "failed":
      return "Stopped on an error";
    case "completed":
      return "Done";
    case "cancelled":
      return "Cancelled";
    default:
      return "Preparing…";
  }
}
