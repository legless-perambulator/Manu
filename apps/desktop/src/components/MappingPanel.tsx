import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  MAPPING_PROPOSALS_PATH,
  STEP_LABEL,
  StoryMapper,
  acceptWhere,
  applyProposals,
  chapterBody,
  rejectWhere,
  resolveAlias,
  reviewSummary,
  setStatus,
  type MappingAnalyst,
  type MappingProposal,
  type MappingRun,
  type MappingSourceChapter,
  type ProposalCategory,
} from "@jellytind/story-mapper";
import { createMappingAnalyst } from "../lib/mapping-analyst";
import { routeFor } from "../lib/routing";
import { estimateMappingCost, formatCostRange } from "../lib/costs";

interface Props {
  repo: StoryRepository;
  secrets: SecretStore;
  refreshToken: number;
  onChanged: () => void;
  onSelectEntity: (id: string) => void;
}

const CATEGORY_LABEL: Readonly<Record<ProposalCategory, string>> = {
  character: "Characters",
  alias: "Names & aliases",
  importance: "Story roles",
  location: "Locations",
  object: "Objects",
  fact: "Facts",
  scene: "Scenes",
  timeline: "Timeline",
  knowledge: "Knowledge",
  relationship: "Relationships",
  thread: "Plot threads",
  setup_payoff: "Setups & payoffs",
  causality: "Causality",
  voice: "Author voice",
  character_voice: "Character voices",
  summary: "Summaries",
};

/**
 * Map Manuscript (Phase 40 Part B): analyse an existing book and reconstruct
 * the structured project around it — persistently, resumably, and always
 * through review. The panel is the workspace of §24: counts first, queues on
 * demand, batch actions for the obvious, one-by-one only for the ambiguous.
 */
export function MappingPanel({ repo, secrets, refreshToken, onChanged, onSelectEntity }: Props) {
  void onSelectEntity;
  const [source, setSource] = useState<MappingSourceChapter[]>([]);
  const [run, setRun] = useState<MappingRun | null>(null);
  const [proposals, setProposals] = useState<MappingProposal[]>([]);
  const [analyst, setAnalyst] = useState<MappingAnalyst | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openCategory, setOpenCategory] = useState<ProposalCategory | null>(null);
  const pauseFlag = useRef(false);
  const mapperRef = useRef<StoryMapper | null>(null);

  const store = useMemo(
    () => ({
      read: (path: string) => repo.readProjectFile(path),
      write: (path: string, content: string) => repo.writeProjectFile(path, content),
    }),
    [repo],
  );

  const load = useCallback(async () => {
    const chapters = [...(await repo.listChapters())].sort((a, b) => a.order - b.order);
    const held: MappingSourceChapter[] = [];
    for (const [index, chapter] of chapters.entries()) {
      const raw = (await repo.readProjectFile(chapter.filePath)) ?? "";
      held.push({
        index,
        chapterId: chapter.id as string,
        title: chapter.title,
        text: chapterBody(raw).replace(/<!--[\s\S]*?-->/g, ""),
      });
    }
    setSource(held);
    const routed = await createMappingAnalyst(repo, secrets);
    setAnalyst(routed);
    const persisted = await repo.readProjectFile(MAPPING_PROPOSALS_PATH);
    if (persisted !== null) setProposals(JSON.parse(persisted) as MappingProposal[]);
    const mapper = new StoryMapper({
      source: held,
      store,
      ...(routed !== null ? { analyst: routed } : {}),
    });
    setRun(await mapper.load());
  }, [repo, secrets, store]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const scope = useMemo(() => {
    if (source.length === 0) return null;
    const mapper = new StoryMapper({
      source,
      store,
      ...(analyst !== null ? { analyst } : {}),
    });
    return mapper.scope();
  }, [source, store, analyst]);

  const estimate = useMemo(() => {
    if (scope === null || scope.estimatedOperations === 0) return null;
    try {
      const decision = routeFor("manuscript_mapping");
      if (decision.selected === undefined) return null;
      const range = estimateMappingCost({
        profile: decision.selected,
        operations: scope.estimatedOperations,
      });
      return range === null ? null : formatCostRange(range);
    } catch {
      return null;
    }
  }, [scope]);

  const persistProposals = useCallback(
    async (next: MappingProposal[]) => {
      setProposals(next);
      await repo.writeProjectFile(MAPPING_PROPOSALS_PATH, JSON.stringify(next, null, 2));
    },
    [repo],
  );

  async function runMapping() {
    setBusy(true);
    setError(null);
    pauseFlag.current = false;
    try {
      const mapper = new StoryMapper({
        source,
        store,
        ...(analyst !== null ? { analyst } : {}),
      });
      mapperRef.current = mapper;
      await mapper.start();
      setRun(await mapper.load());
      for (;;) {
        if (pauseFlag.current) {
          setRun(await mapper.pause());
          break;
        }
        const { run: current, done } = await mapper.advance();
        setRun(current);
        setProposals([...(await mapper.proposals())]);
        if (done || current.status !== "running") break;
      }
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const result = await applyProposals(repo, proposals);
      await persistProposals([...result.proposals]);
      setNotes([
        ...Object.entries(result.created).map(([kind, count]) => `${count} ${kind} created.`),
        ...result.notes,
      ]);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const summary = useMemo(() => reviewSummary(proposals), [proposals]);
  const open = openCategory === null ? [] : proposals.filter((p) => p.category === openCategory);
  const anyAccepted = proposals.some((p) => p.status === "accepted");

  return (
    <div className="state mapping">
      <section className="state__section">
        <h3>Map Manuscript</h3>
        <p className="hint">
          Reconstruct characters, locations, timeline, knowledge, relationships and threads from the
          prose. Everything arrives as a proposal with evidence — nothing becomes canon until you
          accept it.
        </p>
        {scope !== null && (
          <p className="mapping__scope">
            {scope.words.toLocaleString()} words · {scope.chapters} chapters ·{" "}
            {scope.estimatedOperations === 0
              ? "no model configured — deterministic mapping only"
              : `~${scope.estimatedOperations} model operations${
                  estimate !== null ? ` · about ${estimate}` : ""
                } (an estimate, not a promise)`}
          </p>
        )}
        <div className="mapping__actions">
          {(run === null || run.status === "completed" || run.status === "failed") && (
            <button
              className="btn btn--primary"
              disabled={busy || source.length === 0}
              onClick={() => void runMapping()}
            >
              {run?.status === "completed" ? "Map again" : "Map the manuscript"}
            </button>
          )}
          {run?.status === "paused" && (
            <button className="btn btn--primary" disabled={busy} onClick={() => void runMapping()}>
              Resume mapping
            </button>
          )}
          {busy && run?.status === "running" && (
            <button
              className="btn"
              onClick={() => {
                pauseFlag.current = true;
              }}
            >
              Pause
            </button>
          )}
        </div>
        {error !== null && <p className="status status--error">{error}</p>}
        {run !== null && (
          <ul className="mapping__steps">
            {run.steps.map((step) => (
              <li key={step.id} className={`mapping__step is-${step.status}`}>
                <span>{STEP_LABEL[step.id]}</span>
                <span className="mapping__stepstate">
                  {step.status === "running"
                    ? `${step.chunksDone}/${step.chunksTotal}`
                    : step.status === "skipped"
                      ? (step.note ?? "skipped")
                      : step.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {proposals.length > 0 && (
        <section className="state__section">
          <h3>Review</h3>
          <ul className="mapping__summary">
            {summary.map((row) => (
              <li key={row.category}>
                <button
                  className={`mapping__cat${openCategory === row.category ? " is-open" : ""}`}
                  onClick={() =>
                    setOpenCategory(openCategory === row.category ? null : row.category)
                  }
                >
                  <span>{CATEGORY_LABEL[row.category]}</span>
                  <span className="mapping__counts">
                    {row.accepted + row.applied > 0 && (
                      <em>{row.accepted + row.applied} confirmed</em>
                    )}
                    {row.proposed > 0 && <span>{row.proposed} proposed</span>}
                    {row.needsReview > 0 && <strong>{row.needsReview} need review</strong>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mapping__batch">
            <button
              className="btn btn--small"
              disabled={busy}
              onClick={() =>
                void persistProposals(
                  acceptWhere(proposals, { minConfidence: "high" }) as MappingProposal[],
                )
              }
            >
              Accept everything high-confidence
            </button>
            <button
              className="btn btn--small"
              disabled={busy}
              onClick={() =>
                void persistProposals(
                  rejectWhere(proposals, {
                    category: "object",
                    includeNeedsReview: true,
                  }) as MappingProposal[],
                )
              }
            >
              Ignore minor objects
            </button>
            <button
              className="btn btn--primary btn--small"
              disabled={busy || !anyAccepted}
              onClick={() => void apply()}
            >
              Apply accepted proposals
            </button>
          </div>
          {notes.length > 0 && (
            <ul className="mapping__notes">
              {notes.map((note, index) => (
                <li key={index} className="hint">
                  {note}
                </li>
              ))}
            </ul>
          )}
          {openCategory !== null && (
            <ul className="mapping__list">
              {open.map((proposal) => (
                <li key={proposal.id} className={`mapping__item is-${proposal.status}`}>
                  <div className="mapping__head">
                    <span className={`mapping__conf mapping__conf--${proposal.confidence}`}>
                      {proposal.confidence}
                    </span>
                    <span className="mapping__summaryline">{proposal.summary}</span>
                    <span className="mapping__origin">
                      {proposal.origin === "model" ? "model" : "parsed"}
                    </span>
                  </div>
                  {proposal.evidence[0] !== undefined && (
                    <div className="mapping__evidence">
                      {proposal.evidence.map((held) => held.chapterTitle).join(" · ")}
                      {proposal.evidence[0].quote !== undefined && (
                        <em> — “{proposal.evidence[0].quote}”</em>
                      )}
                    </div>
                  )}
                  {proposal.status === "proposed" || proposal.status === "needs_review" ? (
                    <div className="mapping__decide">
                      {proposal.category === "alias" &&
                      Array.isArray(proposal.payload["candidates"]) ? (
                        (proposal.payload["candidates"] as string[]).map((candidate) => (
                          <button
                            key={candidate}
                            className="btn btn--ghost btn--small"
                            disabled={busy}
                            onClick={() =>
                              void persistProposals(
                                resolveAlias(
                                  proposals,
                                  proposal.id,
                                  candidate,
                                ) as MappingProposal[],
                              )
                            }
                          >
                            It’s {candidate}
                          </button>
                        ))
                      ) : (
                        <button
                          className="btn btn--ghost btn--small"
                          disabled={busy}
                          onClick={() =>
                            void persistProposals(
                              setStatus(proposals, proposal.id, "accepted") as MappingProposal[],
                            )
                          }
                        >
                          Accept
                        </button>
                      )}
                      <button
                        className="btn btn--ghost btn--small"
                        disabled={busy}
                        onClick={() =>
                          void persistProposals(
                            setStatus(proposals, proposal.id, "rejected") as MappingProposal[],
                          )
                        }
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span className="mapping__state">{proposal.status}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
