import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PermissionGrant } from "@jellytind/agent-runtime";
import type { ResearchItem, ResearchStatus, ResearchTask } from "@jellytind/domain";
import { RESEARCH_STATUSES, emptyResearchItem } from "@jellytind/domain";
import { ResearchAgent } from "@jellytind/editing";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import { createRoutedModel } from "../lib/routing";
import { documentName } from "../lib/naming";

interface Props {
  repo: StoryRepository;
  secrets: SecretStore;
  refreshToken: number;
  onChanged: () => void;
  /** The current selection, so "Linked to selection" can filter. */
  selectedEntityId?: string | null;
}

/** Research may read the project and file items. It cannot touch canon. */
const RESEARCH_GRANT: PermissionGrant = {
  permissions: ["read_manuscript", "read_canon", "run_research"],
};

type View = "all" | "recent" | "linked" | "archived";

const STATUS_WORD: Readonly<Record<ResearchStatus, string>> = {
  unreviewed: "Unreviewed",
  reviewed: "Reviewed",
  trusted: "Trusted",
  questionable: "Questionable",
  archived: "Archived",
};

/**
 * The Research library (§9–11): sourced real-world knowledge, kept apart from
 * canon, beside the manuscript. Everything here works with no model
 * configured (§5); the Research agent and the research pass are offered on
 * top, never instead.
 */
export function ResearchPanel({ repo, secrets, refreshToken, onChanged, selectedEntityId }: Props) {
  const [items, setItems] = useState<readonly ResearchItem[]>([]);
  const [tasks, setTasks] = useState<readonly ResearchTask[]>([]);
  const [gaps, setGaps] = useState<number>(0);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [documents, setDocuments] = useState<readonly string[]>([]);
  const [view, setView] = useState<View>("all");
  const [tag, setTag] = useState<string>("");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [naming, setNaming] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agent = useRef<ResearchAgent | null>(null);

  const reload = useCallback(async () => {
    const [list, taskList, gapList, summaries, files] = await Promise.all([
      repo.listResearchItems(),
      repo.listResearchTasks(),
      repo.findResearchGaps(),
      repo.listEntitySummaries(),
      repo.listProjectFiles("research"),
    ]);
    setItems(list);
    setTasks(taskList);
    setGaps(gapList.length);
    setNames(new Map(summaries.map((entry) => [entry.id, entry.name])));
    setDocuments(files.filter((path) => /\.(md|txt|pdf)$/i.test(path)).sort());
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  const tags = useMemo(() => {
    const out = new Set<string>();
    for (const item of items) for (const t of item.tags) out.add(t);
    return [...out].sort();
  }, [items]);

  const shown = useMemo(() => {
    const needle = query.toLowerCase().trim();
    return items.filter((item) => {
      if (view === "archived") return item.status === "archived";
      if (item.status === "archived") return false;
      if (view === "linked") {
        if (selectedEntityId === undefined || selectedEntityId === null) return false;
        if (
          !item.linkedEntityIds.includes(selectedEntityId) &&
          !item.linkedSceneIds.includes(selectedEntityId)
        ) {
          return false;
        }
      }
      if (tag !== "" && !item.tags.includes(tag)) return false;
      if (needle !== "") {
        const haystack = [
          item.title,
          item.summary ?? "",
          item.content ?? "",
          item.notes ?? "",
          item.tags.join(" "),
          item.sourceTitle ?? "",
          ...item.facts.map((fact) => fact.statement),
        ]
          .join("\n")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [items, view, tag, query, selectedEntityId]);

  const recent = useMemo(
    () => [...shown].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [shown],
  );
  const listed = view === "recent" ? recent.slice(0, 12) : shown;
  const open = openId === null ? null : (items.find((item) => item.id === openId) ?? null);

  const ensureAgent = useCallback(async (): Promise<ResearchAgent> => {
    if (agent.current !== null) return agent.current;
    const { model } = await createRoutedModel(repo, secrets, "research");
    agent.current = new ResearchAgent({ repo, model, grant: RESEARCH_GRANT });
    return agent.current;
  }, [repo, secrets]);

  const act = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await work();
        onChanged();
        await reload();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [onChanged, reload],
  );

  const name = (id: string) => names.get(id) ?? id;

  return (
    <div className="rsrch">
      <div className="rsrch__bar">
        <select value={view} onChange={(e) => setView(e.target.value as View)} disabled={busy}>
          <option value="all">All research</option>
          <option value="recent">Recent</option>
          <option value="linked">Linked to selection</option>
          <option value="archived">Archived</option>
        </select>
        {tags.length > 0 && (
          <select value={tag} onChange={(e) => setTag(e.target.value)} disabled={busy}>
            <option value="">Any tag</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
        <input
          className="rsrch__search"
          value={query}
          placeholder="Search research…"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {open === null ? (
        <>
          <ul className="rsrch__list">
            {listed.length === 0 && (
              <li className="hint">
                Nothing here yet. Research is what you looked up while writing — sourced, tagged,
                linked to the story, and never mistaken for canon.
              </li>
            )}
            {listed.map((item) => (
              <li key={item.id}>
                <button className="rsrch__row" onClick={() => setOpenId(item.id)}>
                  <span className="rsrch__row-title">{item.title}</span>
                  <span className="rsrch__row-meta">
                    {STATUS_WORD[item.status]}
                    {item.sourceTitle !== undefined ? ` · ${item.sourceTitle}` : ""}
                    {item.pinned === true ? " · pinned" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {naming ? (
            <div className="rsrch__new">
              <input
                value={newTitle}
                placeholder="What is the research about?"
                autoFocus
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTitle.trim() !== "") {
                    void act(async () => {
                      const item = await repo.addResearchItem(
                        emptyResearchItem(newTitle.trim(), new Date().toISOString()),
                      );
                      setOpenId(item.id);
                      setNewTitle("");
                      setNaming(false);
                    });
                  }
                  if (e.key === "Escape") setNaming(false);
                }}
              />
            </div>
          ) : (
            <div className="rsrch__actions">
              <button className="btn btn--small" disabled={busy} onClick={() => setNaming(true)}>
                New research
              </button>
            </div>
          )}

          <details className="rsrch__tasks">
            <summary>
              Research questions (
              {tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled").length}{" "}
              open
              {gaps > 0 ? ` · ${String(gaps)} marked in the manuscript` : ""})
            </summary>
            <div className="rsrch__ask">
              <input
                value={question}
                placeholder="What do you need to know?"
                onChange={(e) => setQuestion(e.target.value)}
              />
              <button
                className="btn btn--tiny"
                disabled={busy || question.trim() === ""}
                onClick={() =>
                  void act(async () => {
                    await repo.addResearchTask({ question: question.trim() });
                    setQuestion("");
                  })
                }
              >
                Add
              </button>
            </div>
            <ul>
              {tasks.map((task) => (
                <li key={task.id} className="rsrch__task">
                  <span className="rsrch__task-q">{task.question}</span>
                  <span className="rsrch__task-meta">
                    {task.status.replace("_", " ")}
                    {task.findingItemIds.length > 0
                      ? ` · ${String(task.findingItemIds.length)} finding(s)`
                      : ""}
                  </span>
                  {(task.status === "pending" || task.status === "failed") && (
                    <button
                      className="btn btn--tiny"
                      disabled={busy}
                      title="Ask Manu to research this. Findings arrive here, with sources, for your review."
                      onClick={() =>
                        void act(async () => {
                          await (await ensureAgent()).run(task.id);
                        })
                      }
                    >
                      Research
                    </button>
                  )}
                  {task.status === "awaiting_review" && (
                    <button
                      className="btn btn--tiny"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await repo.updateResearchTask(task.id, { status: "completed" });
                        })
                      }
                    >
                      Done
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <button
              className="btn btn--ghost btn--small"
              disabled={busy}
              title="Sweep the manuscript for [RESEARCH: …] markers, make a task for each question, and research them. Prose is never changed."
              onClick={() =>
                void act(async () => {
                  await (await ensureAgent()).researchPass();
                })
              }
            >
              Research pass
            </button>
          </details>

          {documents.length > 0 && (
            <details className="rsrch__import">
              <summary>Documents in your research folder ({documents.length})</summary>
              <ul>
                {documents.map((path) => (
                  <li key={path} className="rsrch__doc">
                    <span>{documentName(path)}</span>
                    <button
                      className="btn btn--tiny"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const isPdf = /\.pdf$/i.test(path);
                          const text = isPdf ? null : await repo.readProjectFile(path);
                          const item = await repo.addResearchItem({
                            ...emptyResearchItem(documentName(path), new Date().toISOString()),
                            type: "document",
                            ...(text !== null ? { content: text } : {}),
                            sourceTitle: path,
                            notes: isPdf
                              ? "A PDF in the research folder — kept as a reference; open it outside Manu."
                              : undefined,
                            provenance: { origin: "import", retrievalMethod: "file_import" },
                          });
                          setOpenId(item.id);
                        })
                      }
                    >
                      Add to library
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <section className="rsrch__detail">
          <header className="rsrch__head">
            <button className="btn btn--ghost btn--tiny" onClick={() => setOpenId(null)}>
              ← Library
            </button>
            <select
              value={open.status}
              disabled={busy}
              title="Your judgement of this research. Nothing is trusted automatically."
              onChange={(e) =>
                void act(async () => {
                  await repo.updateResearchItem(open.id, {
                    status: e.target.value as ResearchStatus,
                  });
                })
              }
            >
              {RESEARCH_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_WORD[status]}
                </option>
              ))}
            </select>
            <label
              className="rsrch__pin"
              title="Pinned research travels with every drafting context for its linked scenes."
            >
              <input
                type="checkbox"
                checked={open.pinned === true}
                disabled={busy}
                onChange={(e) =>
                  void act(async () => {
                    await repo.updateResearchItem(open.id, { pinned: e.target.checked });
                  })
                }
              />
              Pin
            </label>
          </header>

          <h3 className="rsrch__title">{open.title}</h3>
          {open.summary !== undefined && open.summary !== "" && (
            <p className="rsrch__summary">{open.summary}</p>
          )}

          {(open.sourceTitle !== undefined || open.sourceUrl !== undefined) && (
            <p className="rsrch__source">
              Source: {open.sourceTitle ?? ""}
              {open.sourceAuthor !== undefined ? ` — ${open.sourceAuthor}` : ""}
              {open.sourceUrl !== undefined && (
                <>
                  {" "}
                  <a href={open.sourceUrl} target="_blank" rel="noreferrer noopener">
                    open ↗
                  </a>
                </>
              )}
              {open.accessedAt !== undefined ? ` · accessed ${open.accessedAt.slice(0, 10)}` : ""}
            </p>
          )}
          <p className="rsrch__prov">
            {open.provenance.origin === "manual"
              ? "Written by you"
              : open.provenance.origin === "import"
                ? "Imported from your research folder"
                : `Gathered by Manu (${open.provenance.retrievalMethod ?? "research"})`}
            {" · never part of the story until you use it"}
          </p>

          {open.content !== undefined && open.content !== "" && (
            <details className="rsrch__content">
              <summary>Source material</summary>
              <blockquote>{open.content}</blockquote>
            </details>
          )}

          {open.facts.length > 0 && (
            <div className="rsrch__facts">
              <h4>What it says</h4>
              <ul>
                {open.facts.map((fact, index) => (
                  <li key={index} className="rsrch__fact">
                    <span>
                      {fact.statement}
                      <span className="rsrch__fact-meta">
                        {fact.proposedBy === "model" ? " (model)" : ""}
                        {fact.confidence !== undefined
                          ? ` · confidence ${fact.confidence.toFixed(2)}`
                          : ""}
                        {fact.conflictsWithItemId !== undefined
                          ? ` · differs from ${
                              items.find((i) => i.id === fact.conflictsWithItemId)?.title ??
                              fact.conflictsWithItemId
                            }`
                          : ""}
                      </span>
                    </span>
                    {fact.canonisedAs !== undefined ? (
                      <span className="rsrch__fact-meta">
                        in the story as {name(fact.canonisedAs)}
                      </span>
                    ) : (
                      <button
                        className="btn btn--tiny"
                        disabled={busy}
                        title="Make this a canonical story fact. This is the one bridge from research to canon, and it is yours."
                        onClick={() =>
                          void act(async () => {
                            await repo.canoniseResearchFact(open.id, index, { kind: "fact" });
                          })
                        }
                      >
                        Use in story
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className="field">
            <span>Your notes</span>
            <textarea
              rows={2}
              defaultValue={open.notes ?? ""}
              disabled={busy}
              onBlur={(e) => {
                if (e.target.value === (open.notes ?? "")) return;
                void act(async () => {
                  await repo.updateResearchItem(open.id, { notes: e.target.value });
                });
              }}
            />
          </label>
          <label className="field">
            <span>Tags</span>
            <input
              defaultValue={open.tags.join(", ")}
              placeholder="comma, separated"
              disabled={busy}
              onBlur={(e) => {
                const next = e.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter((t) => t !== "");
                if (next.join(",") === open.tags.join(",")) return;
                void act(async () => {
                  await repo.updateResearchItem(open.id, { tags: next });
                });
              }}
            />
          </label>

          <div className="rsrch__links">
            <h4>Linked to</h4>
            {[...open.linkedSceneIds, ...open.linkedEntityIds].length === 0 && (
              <p className="hint">
                Nothing yet. Linked research travels into drafting context for those scenes and
                people.
              </p>
            )}
            <ul>
              {[...open.linkedSceneIds, ...open.linkedEntityIds].map((id) => (
                <li key={id} className="rsrch__link">
                  <span>{name(id)}</span>
                  <button
                    className="btn btn--ghost btn--tiny"
                    title="Unlink"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await repo.updateResearchItem(open.id, {
                          linkedEntityIds: open.linkedEntityIds.filter((held) => held !== id),
                          linkedSceneIds: open.linkedSceneIds.filter((held) => held !== id),
                        });
                      })
                    }
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <select
              value=""
              disabled={busy}
              onChange={(e) => {
                const id = e.target.value;
                if (id === "") return;
                void act(async () => {
                  const isScene = id.startsWith("SCENE_");
                  await repo.updateResearchItem(open.id, {
                    ...(isScene
                      ? { linkedSceneIds: [...open.linkedSceneIds, id] }
                      : { linkedEntityIds: [...open.linkedEntityIds, id] }),
                  });
                });
              }}
            >
              <option value="">Link to a story element…</option>
              {[...names.entries()]
                .filter(
                  ([id]) => !open.linkedEntityIds.includes(id) && !open.linkedSceneIds.includes(id),
                )
                .map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
            </select>
          </div>

          <div className="rsrch__actions">
            <button
              className="btn btn--ghost btn--small"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await repo.deleteResearchItem(open.id);
                  setOpenId(null);
                })
              }
            >
              Delete
            </button>
          </div>
        </section>
      )}

      {error !== null && (
        <p className="status status--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
