import { useCallback, useEffect, useRef, useState } from "react";
import type { PermissionGrant } from "@jellytind/agent-runtime";
import type {
  ApprovalPolicy,
  ChapterBuild,
  ChapterBuildSummary,
  ModelRouteNote,
  SceneBuildRecord,
} from "@jellytind/domain";
import type { Chapter } from "@jellytind/domain";
import { ChapterBuilder } from "@jellytind/editing";
import type { RouteDecision, SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import { budgetVerdict, estimateChapterBuildCost, formatCostRange } from "../lib/costs";
import { createRoutedModel, routeFor, routeNote } from "../lib/routing";
import { chapterNumberLabel } from "../lib/naming";

interface Props {
  repo: StoryRepository;
  secrets: SecretStore;
  branchId: string;
  refreshToken: number;
  onChanged: () => void;
  /** Open the chapter file, so committed scenes can be read while it builds. */
  onOpenFile: (path: string) => void;
}

/**
 * Building a chapter needs to edit the manuscript and to propose state
 * changes. Nothing else: no entity creation, no deletion, no branching.
 */
const BUILD_GRANT: PermissionGrant = {
  permissions: ["read_manuscript", "read_canon", "edit_manuscript", "edit_story_state"],
  allowedTools: ["build_chapter", "analyse_state_changes"],
};

const POLICY_COPY: Readonly<Record<ApprovalPolicy, { label: string; hint: string }>> = {
  every_scene: {
    label: "Show me every scene",
    hint: "Each scene is drafted and held. Nothing lands until you say so.",
  },
  every_chapter: {
    label: "Show me the chapter",
    hint: "The scenes build in sequence; you decide once at the end.",
  },
  auto_until_error: {
    label: "Build until something is wrong",
    hint: "Commits as it goes — checkpointed and revertible — and stops on any error.",
  },
};

const SCENE_GLYPH: Readonly<Record<SceneBuildRecord["status"], string>> = {
  pending: "○",
  drafting: "→",
  awaiting_approval: "⏸",
  extracting: "→",
  validating: "→",
  revising: "→",
  committed: "✓",
  failed: "!",
};

/**
 * The writer-facing face of the chapter builder (§14).
 *
 * A scene checklist, what the pipeline is doing right now, and the four verbs
 * that matter — approve, pause, resume, cancel. The workflow engine's steps
 * exist on the record for anyone who opens it; they are not the interface.
 */
export function ChapterBuildPanel({
  repo,
  secrets,
  branchId,
  refreshToken,
  onChanged,
  onOpenFile,
}: Props) {
  const [chapters, setChapters] = useState<readonly Chapter[]>([]);
  const [chapterId, setChapterId] = useState<string>("");
  const [policy, setPolicy] = useState<ApprovalPolicy>("every_scene");
  const [history, setHistory] = useState<readonly ChapterBuildSummary[]>([]);
  const [active, setActive] = useState<ChapterBuild | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The route preview (§20), the honest estimate (§12), the budget word (§13). */
  const [plan, setPlan] = useState<{
    drafting: RouteDecision;
    analysis: RouteDecision;
    estimate: string;
    budget: { allowed: boolean; message?: string };
  } | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  /** One builder per panel life, so pause flags reach the running loop. */
  const builder = useRef<ChapterBuilder | null>(null);
  /** Why each model was chosen — recorded on the build it starts (§19). */
  const routingNotes = useRef<ModelRouteNote[]>([]);

  const reload = useCallback(async () => {
    const [list, builds] = await Promise.all([repo.listChapters(), repo.chapterBuilds.list()]);
    setChapters([...list].sort((a, b) => a.order - b.order));
    setHistory(builds);
    const openId = builds.find(
      (entry) => entry.status !== "completed" && entry.status !== "cancelled",
    )?.id;
    if (openId !== undefined) setActive(await repo.chapterBuilds.get(openId));
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  /**
   * The builder is created on demand: opening the panel must not require a
   * configured model. Both slots resolve through the Model Router — drafting
   * as "scene_drafting", analysis as "state_extraction" — so the policy,
   * privacy rules and pins in Settings decide, and every call the build makes
   * lands in the usage ledger (Phase 36 §10, §21).
   */
  const ensureBuilder = useCallback(async (): Promise<ChapterBuilder> => {
    if (builder.current !== null) return builder.current;
    const drafting = await createRoutedModel(repo, secrets, "scene_drafting");
    const analysis = await createRoutedModel(repo, secrets, "state_extraction").catch(
      () => undefined,
    );
    routingNotes.current = [
      routeNote(drafting.decision),
      ...(analysis !== undefined ? [routeNote(analysis.decision)] : []),
    ].filter((note): note is ModelRouteNote => note !== null);
    builder.current = new ChapterBuilder({
      repo,
      models: {
        drafting: drafting.model,
        ...(analysis === undefined ? {} : { analysis: analysis.model }),
      },
      grant: BUILD_GRANT,
      onProgress: (build) => setActive(build),
    });
    return builder.current;
  }, [repo, secrets]);

  // The route preview needs no model call at all: the same pure decision the
  // build will use, shown before anything starts (§20, §28).
  useEffect(() => {
    if (chapterId === "") {
      setPlan(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const scenes = (await repo.listScenes()).filter((scene) => scene.chapterId === chapterId);
      const drafting = routeFor("scene_drafting");
      const analysis = routeFor("state_extraction");
      const estimate =
        drafting.selected === undefined
          ? null
          : estimateChapterBuildCost({
              drafting: drafting.selected,
              ...(analysis.selected !== undefined ? { analysis: analysis.selected } : {}),
              sceneCount: scenes.length,
            });
      const verdict = await budgetVerdict(repo, estimate?.high.amount ?? null);
      if (cancelled) return;
      setPlan({
        drafting,
        analysis,
        estimate: formatCostRange(estimate),
        budget: verdict.allowed
          ? {
              allowed: true,
              ...(verdict.warning !== undefined ? { message: verdict.warning } : {}),
            }
          : { allowed: false, message: verdict.reason },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [chapterId, repo, refreshToken]);

  const run = useCallback(
    async (work: (b: ChapterBuilder) => Promise<ChapterBuild>) => {
      setBusy(true);
      setError(null);
      try {
        const result = await work(await ensureBuilder());
        setActive(result);
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

  const chapterOf = (id: string) => chapters.find((chapter) => (chapter.id as string) === id);
  const activeChapter = active === null ? undefined : chapterOf(active.chapterId);
  const finished = active?.status === "completed" || active?.status === "cancelled";

  return (
    <div className="cbuild">
      {active === null || finished ? (
        <section className="cbuild__start">
          <p className="cbuild__intro">
            Build a chapter from its scene plan, one scene at a time. Manu drafts each scene from
            the project's current state, checks it, and checkpoints as it goes — you choose how much
            to see before it lands.
          </p>
          <label className="field">
            <span>Chapter</span>
            <select
              value={chapterId}
              onChange={(event) => setChapterId(event.target.value)}
              disabled={busy}
            >
              <option value="">Pick a chapter…</option>
              {chapters.map((chapter, index) => (
                <option key={chapter.id} value={chapter.id as string}>
                  {chapterNumberLabel(index)} — {chapter.title}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="cbuild__policies">
            <legend>Approval</legend>
            {(Object.keys(POLICY_COPY) as ApprovalPolicy[]).map((entry) => (
              <label key={entry} className="cbuild__policy">
                <input
                  type="radio"
                  name="cbuild-policy"
                  checked={policy === entry}
                  onChange={() => setPolicy(entry)}
                  disabled={busy}
                />
                <span>
                  <strong>{POLICY_COPY[entry].label}</strong>
                  <span className="cbuild__hint">{POLICY_COPY[entry].hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {plan !== null && (
            <div className="cbuild__routing">
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => setShowPlan((held) => !held)}
              >
                {showPlan ? "Hide model plan" : "View model plan"}
              </button>
              {showPlan && (
                <ul className="cbuild__routes">
                  {(
                    [
                      ["Scene drafting", plan.drafting],
                      ["State extraction", plan.analysis],
                    ] as const
                  ).map(([label, decision]) => (
                    <li key={label}>
                      <strong>{label}</strong> —{" "}
                      {decision.selected !== undefined
                        ? `${decision.selected.displayName}. ${decision.reasons.join(" ")}`
                        : (decision.blocked ?? "No model available.")}
                    </li>
                  ))}
                </ul>
              )}
              <p className="hint">{plan.estimate}</p>
              {plan.budget.message !== undefined && (
                <p className={plan.budget.allowed ? "hint" : "status status--error"} role="status">
                  {plan.budget.message}
                </p>
              )}
            </div>
          )}
          <button
            className="btn btn--primary btn--small"
            disabled={busy || chapterId === "" || plan?.budget.allowed === false}
            onClick={() =>
              void run((b) =>
                b.start({
                  chapterId,
                  branchId,
                  approvalPolicy: policy,
                  routing: routingNotes.current,
                }),
              )
            }
          >
            {busy ? "Working…" : "Build the chapter"}
          </button>
          <p className="hint">
            Every scene is committed to the ordinary history with a checkpoint before it, so
            anything the build writes can be reverted afterwards.
          </p>
        </section>
      ) : (
        <section className="cbuild__run">
          <header className="cbuild__head">
            <h3 className="cbuild__title">{activeChapter?.title ?? active.chapterTitle}</h3>
            <span className={`cbuild__status cbuild__status--${active.status}`} role="status">
              {describeStatus(active)}
            </span>
          </header>

          <ol className="cbuild__scenes">
            {active.scenes.map((scene) => (
              <li key={scene.sceneId} className={`cbuild__scene cbuild__scene--${scene.status}`}>
                <span className="cbuild__glyph" aria-hidden="true">
                  {SCENE_GLYPH[scene.status]}
                </span>
                <button
                  className="cbuild__scene-name"
                  title={scene.sceneId}
                  disabled={activeChapter === undefined}
                  onClick={() => {
                    // §14: committed scenes can be read while the build goes on.
                    if (activeChapter !== undefined) onOpenFile(activeChapter.filePath);
                  }}
                >
                  {scene.title}
                </button>
                <span className="cbuild__scene-meta">
                  {scene.status === "committed" && scene.words !== undefined
                    ? `${String(scene.words)} words`
                    : scene.status === "awaiting_approval"
                      ? "waiting for you"
                      : scene.status === "pending"
                        ? ""
                        : scene.status}
                </span>
              </li>
            ))}
          </ol>

          {active.pending !== undefined && (
            <div className="cbuild__gate">
              <p className="cbuild__question">{active.pending.question}</p>
              {active.pending.sceneId !== undefined &&
                (() => {
                  const held = active.scenes.find(
                    (scene) => scene.sceneId === active.pending?.sceneId,
                  );
                  return held?.draft === undefined ? null : (
                    <blockquote className="cbuild__draft">{held.draft}</blockquote>
                  );
                })()}
              <div className="cbuild__actions">
                <button
                  className="btn btn--primary btn--small"
                  disabled={busy}
                  onClick={() => void run((b) => b.approve(active.id))}
                >
                  Keep going
                </button>
                <button
                  className="btn btn--small"
                  disabled={busy}
                  onClick={() => void run((b) => b.rejectPending(active.id, "declined"))}
                >
                  Not this — redraft
                </button>
              </div>
            </div>
          )}

          {(active.status === "paused" || active.status === "failed") && (
            <div className="cbuild__actions">
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
            <div className="cbuild__actions">
              {(active.status === "drafting" ||
                active.status === "validating" ||
                active.status === "revising") && (
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
            <details className="cbuild__diagnostics">
              <summary>What the build noted ({active.diagnostics.length})</summary>
              <ul>
                {active.diagnostics.slice(-12).map((diagnostic, index) => (
                  <li key={index} className={`severity severity--${diagnostic.severity}`}>
                    <span className="severity__word">{diagnostic.severity.toUpperCase()}</span>{" "}
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
        <details className="cbuild__history">
          <summary>Past builds ({history.length})</summary>
          <ul>
            {history.map((entry) => (
              <li key={entry.id} className="cbuild__past" title={entry.id}>
                <span>{entry.chapterTitle}</span>
                <span className="cbuild__past-meta">
                  {entry.scenesCommitted}/{entry.scenesTotal} scenes · {entry.status}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function describeStatus(build: ChapterBuild): string {
  switch (build.status) {
    case "drafting": {
      const current = build.scenes.find((scene) => scene.sceneId === build.currentSceneId);
      return current === undefined ? "Building…" : `Drafting “${current.title}”…`;
    }
    case "validating":
      return "Checking…";
    case "revising":
      return "Revising against the plan…";
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
