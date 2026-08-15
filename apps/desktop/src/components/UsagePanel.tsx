import { useCallback, useEffect, useState } from "react";
import type { ChapterBuildSummary } from "@jellytind/domain";
import type { StoryRepository, ModelFeedbackRecord } from "@jellytind/story-repository";
import { formatCostSummary, spendOverview, usageByClass, type SpendOverview } from "../lib/costs";
import type { StoredUsageRecord } from "@jellytind/story-repository";

interface Props {
  repo: StoryRepository;
  refreshToken: number;
}

/**
 * Usage & costs (Phase 36 §11): a few honest numbers, quietly.
 *
 * Everything shown comes from the ledger of calls that actually happened.
 * Money appears only where pricing is configured; calls whose cost is unknown
 * are counted and said, never folded into a total or pretended free. No
 * charts, no projections, no gamified meters — a writer glances here to
 * answer "what is this costing me", and leaves.
 */
export function UsagePanel({ repo, refreshToken }: Props) {
  const [overview, setOverview] = useState<SpendOverview | null>(null);
  const [records, setRecords] = useState<readonly StoredUsageRecord[]>([]);
  const [builds, setBuilds] = useState<readonly ChapterBuildSummary[]>([]);
  const [feedback, setFeedback] = useState<readonly ModelFeedbackRecord[]>([]);

  const reload = useCallback(async () => {
    const [held, all, chapterBuilds, entries] = await Promise.all([
      spendOverview(repo),
      repo.usage.list(),
      repo.chapterBuilds.list(),
      repo.usage.listFeedback(),
    ]);
    setOverview(held);
    setRecords(all);
    setBuilds(chapterBuilds.filter((build) => build.status === "completed").slice(0, 5));
    setFeedback(entries);
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  const give = async (build: ChapterBuildSummary, verdict: "good" | "poor") => {
    const full = await repo.chapterBuilds.get(build.id);
    await repo.usage.appendFeedback({
      at: new Date().toISOString(),
      verdict,
      modelId: full?.modelAssignments.premium_prose ?? "unknown",
      operation: "scene_drafting",
      buildId: build.id,
    });
    await reload();
  };

  if (overview === null) return <p className="hint">Reading the ledger…</p>;

  const rows: readonly [string, SpendOverview["today"]][] = [
    ["Today", overview.today],
    ["This month", overview.month],
    ["Project lifetime", overview.lifetime],
  ];
  const byClass = usageByClass(records);
  const verdictFor = (buildId: string): ModelFeedbackRecord | undefined =>
    feedback.find((entry) => entry.buildId === buildId);

  return (
    <div className="usage">
      <table className="usage__totals">
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Calls</th>
            <th scope="col">Tokens in / out</th>
            <th scope="col">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, summary]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{summary.calls}</td>
              <td>
                {summary.inputTokens.toLocaleString()} / {summary.outputTokens.toLocaleString()}
              </td>
              <td>{formatCostSummary(summary)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {Object.keys(byClass).length > 0 && (
        <>
          <h4 className="usage__heading">By kind of work</h4>
          <table className="usage__totals">
            <tbody>
              {Object.entries(byClass)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([kind, summary]) => (
                  <tr key={kind}>
                    <th scope="row">{kind.replaceAll("_", " ")}</th>
                    <td>{summary.calls}</td>
                    <td>
                      {summary.inputTokens.toLocaleString()} /{" "}
                      {summary.outputTokens.toLocaleString()}
                    </td>
                    <td>{formatCostSummary(summary)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}

      {builds.length > 0 && (
        <>
          <h4 className="usage__heading">Recent builds</h4>
          <ul className="usage__builds">
            {builds.map((build) => {
              const held = verdictFor(build.id);
              return (
                <li key={build.id} className="usage__build">
                  <span>{build.chapterTitle}</span>
                  {held !== undefined ? (
                    <span className="hint">
                      You called this {held.verdict === "good" ? "a good" : "a poor"} result.
                    </span>
                  ) : (
                    <span className="usage__verdicts">
                      <button
                        className="btn btn--ghost btn--small"
                        onClick={() => void give(build, "good")}
                      >
                        Good result
                      </button>
                      <button
                        className="btn btn--ghost btn--small"
                        onClick={() => void give(build, "poor")}
                      >
                        Poor result
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="hint">
            Verdicts are kept as your own record beside the model that did the work — nothing is
            trained on them, and nothing reroutes behind your back.
          </p>
        </>
      )}

      <p className="hint">
        Counted from calls as they actually completed. Models without configured pricing show as
        calls with unknown cost — enter prices in Settings → AI providers to see money here.
      </p>
    </div>
  );
}
