import { useCallback, useEffect, useState } from "react";
import type { PermissionGrant } from "@jellytind/agent-runtime";
import {
  emptyPlannedScene,
  planImpact,
  type Chapter,
  type ChapterPlan,
  type PlanFinding,
  type PlannedScene,
} from "@jellytind/domain";
import { PlanArchitect } from "@jellytind/editing";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import { createConfiguredModel } from "../lib/models";
import { chapterNumberLabel } from "../lib/naming";

interface Props {
  repo: StoryRepository;
  secrets: SecretStore;
  refreshToken: number;
  onChanged: () => void;
}

const PLAN_GRANT: PermissionGrant = {
  permissions: ["read_manuscript", "read_canon", "edit_plans"],
  allowedTools: ["create_chapter_plan"],
};

/**
 * The chapter plan, as a working document (§9–12).
 *
 * Manual first: everything here — scenes, beats, objectives, reordering,
 * splitting, merging — works with no model configured. "Draft a plan" is one
 * button among the writer's tools, not the door into the panel. A quick plan
 * (POV, goal, conflict, outcome) is a complete plan; beats and the deeper
 * fields appear on demand.
 */
export function ChapterPlanPanel({ repo, secrets, refreshToken, onChanged }: Props) {
  const [chapters, setChapters] = useState<readonly Chapter[]>([]);
  const [chapterId, setChapterId] = useState<string>("");
  const [plan, setPlan] = useState<ChapterPlan | null>(null);
  const [findings, setFindings] = useState<readonly PlanFinding[] | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [list, summaries] = await Promise.all([repo.listChapters(), repo.listEntitySummaries()]);
    setChapters([...list].sort((a, b) => a.order - b.order));
    setNames(new Map(summaries.map((entry) => [entry.id, entry.name])));
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  useEffect(() => {
    setFindings(null);
    if (chapterId === "") {
      setPlan(null);
      return;
    }
    void repo.plans.get(chapterId).then(setPlan);
  }, [repo, chapterId, refreshToken]);

  const name = useCallback(
    (id: string | undefined) => (id === undefined ? "" : (names.get(id) ?? id)),
    [names],
  );

  /** Persist a changed scene list (or field) as the next plan version. */
  const save = useCallback(
    async (
      patch: Partial<Pick<ChapterPlan, "objective" | "scenes" | "notes" | "constraints">>,
      note: string,
    ) => {
      if (chapterId === "") return;
      setBusy("Saving…");
      setError(null);
      try {
        const base: Omit<ChapterPlan, "version" | "revisions" | "createdAt" | "updatedAt"> =
          plan === null
            ? {
                id: `PLANFOR_${chapterId}`,
                chapterId,
                status: "draft",
                scenes: [],
                activePlotThreadIds: [],
                requiredSetupIds: [],
                requiredPayoffIds: [],
                characterArcMovement: [],
                forbiddenFacts: [],
                constraints: [],
                notes: [],
                source: "author",
              }
            : { ...plan, status: "draft", source: plan.source === "model" ? "mixed" : plan.source };
        const stored = await repo.saveChapterPlan({ ...base, ...patch }, { note });
        setPlan(stored);
        setFindings(null);
        onChanged();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    },
    [chapterId, plan, repo, onChanged],
  );

  const scenes = plan?.scenes ?? [];

  const setScene = (key: string, patch: Partial<PlannedScene>) =>
    void save(
      { scenes: scenes.map((scene) => (scene.key === key ? { ...scene, ...patch } : scene)) },
      "scene edited",
    );

  const move = (key: string, by: -1 | 1) => {
    const at = scenes.findIndex((scene) => scene.key === key);
    const to = at + by;
    if (at === -1 || to < 0 || to >= scenes.length) return;
    const next = [...scenes];
    const [taken] = next.splice(at, 1);
    if (taken === undefined) return;
    next.splice(to, 0, taken);
    void save({ scenes: next }, "scenes reordered");
  };

  const addScene = () =>
    void save(
      {
        scenes: [
          ...scenes,
          emptyPlannedScene(
            `s${String(Date.now() % 100000)}`,
            `Scene ${String(scenes.length + 1)}`,
          ),
        ],
      },
      "scene added",
    );

  const removeScene = (key: string) =>
    void save({ scenes: scenes.filter((scene) => scene.key !== key) }, "scene removed");

  const splitScene = (key: string) => {
    const at = scenes.findIndex((scene) => scene.key === key);
    const scene = scenes[at];
    if (scene === undefined) return;
    const half = Math.ceil(scene.beats.length / 2);
    const second: PlannedScene = {
      ...emptyPlannedScene(`${key}b`, `${scene.title} (continued)`),
      ...(scene.pov !== undefined ? { pov: scene.pov } : {}),
      ...(scene.locationId !== undefined ? { locationId: scene.locationId } : {}),
      characterIds: scene.characterIds,
      beats: scene.beats.slice(half),
    };
    const first: PlannedScene = { ...scene, beats: scene.beats.slice(0, half) };
    const next = [...scenes];
    next.splice(at, 1, first, second);
    void save({ scenes: next }, "scene split");
  };

  const mergeScene = (key: string) => {
    const at = scenes.findIndex((scene) => scene.key === key);
    const a = scenes[at];
    const b = scenes[at + 1];
    if (a === undefined || b === undefined) return;
    const merged: PlannedScene = {
      ...a,
      beats: [...a.beats, ...b.beats],
      characterIds: [...new Set([...a.characterIds, ...b.characterIds])],
      revelations: [...a.revelations, ...b.revelations],
      knowledgeChanges: [...a.knowledgeChanges, ...b.knowledgeChanges],
      plotThreadIds: [...new Set([...a.plotThreadIds, ...b.plotThreadIds])],
    };
    const next = [...scenes];
    next.splice(at, 2, merged);
    void save({ scenes: next }, "scenes merged");
  };

  const generate = async () => {
    if (chapterId === "") return;
    setBusy("Drafting a plan…");
    setError(null);
    try {
      const model = await createConfiguredModel(secrets, "reasoning").catch(() =>
        createConfiguredModel(secrets, "default"),
      );
      const architect = new PlanArchitect({ repo, model, grant: PLAN_GRANT });
      const result = await architect.proposeChapterPlan({
        chapterId,
        ...(instruction.trim() === "" ? {} : { instruction: instruction.trim() }),
      });
      setPlan(result.plan);
      setFindings(result.findings);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const validate = async () => {
    if (plan === null) return;
    setBusy("Checking…");
    try {
      setFindings(await repo.validateChapterPlan(plan));
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (chapterId === "") return;
    setBusy("Approving…");
    setError(null);
    try {
      const approved = await repo.approveChapterPlan(chapterId);
      setPlan(approved);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const impact = plan === null ? null : planImpact(plan);

  return (
    <div className="cplan">
      <label className="field">
        <span>Chapter</span>
        <select value={chapterId} onChange={(event) => setChapterId(event.target.value)}>
          <option value="">Pick a chapter…</option>
          {chapters.map((chapter, index) => (
            <option key={chapter.id} value={chapter.id as string}>
              {chapterNumberLabel(index)} — {chapter.title}
            </option>
          ))}
        </select>
      </label>

      {chapterId !== "" && (
        <>
          {plan !== null && (
            <div className="cplan__meta" role="status">
              <span className={`cplan__status cplan__status--${plan.status}`}>
                {plan.status === "approved"
                  ? `Approved — v${String(plan.approvedVersion ?? plan.version)}`
                  : `Draft — v${String(plan.version)}`}
              </span>
              {plan.source !== "author" && (
                <span className="cplan__source">
                  {plan.source === "model" ? "generated" : "generated, then edited"}
                </span>
              )}
            </div>
          )}

          <label className="field">
            <span>What the chapter is for</span>
            <input
              value={plan?.objective ?? ""}
              placeholder="Mara discovers the key, but not what it opens"
              onBlur={(event) => {
                if (event.target.value !== (plan?.objective ?? ""))
                  void save({ objective: event.target.value }, "objective edited");
              }}
              onChange={(event) =>
                setPlan((current) =>
                  current === null ? current : { ...current, objective: event.target.value },
                )
              }
            />
          </label>

          <div className="cplan__scenes">
            {scenes.map((scene, index) => (
              <SceneCard
                key={scene.key}
                scene={scene}
                index={index}
                last={index === scenes.length - 1}
                name={name}
                findings={(findings ?? []).filter((finding) => finding.sceneKey === scene.key)}
                onEdit={(patch) => setScene(scene.key, patch)}
                onMove={(by) => move(scene.key, by)}
                onRemove={() => removeScene(scene.key)}
                onSplit={() => splitScene(scene.key)}
                onMerge={() => mergeScene(scene.key)}
              />
            ))}
          </div>

          <div className="cplan__actions">
            <button className="btn btn--small" onClick={addScene} disabled={busy !== null}>
              Add a scene
            </button>
            <button
              className="btn btn--small"
              onClick={() => void validate()}
              disabled={busy !== null || plan === null}
            >
              Check the plan
            </button>
            <button
              className="btn btn--primary btn--small"
              onClick={() => void approve()}
              disabled={busy !== null || plan === null || scenes.length === 0}
              title="Approval turns planned scenes into scene records the Chapter Builder can work from."
            >
              Approve
            </button>
            {busy !== null && <span className="hint">{busy}</span>}
          </div>

          {impact !== null &&
            (impact.advances.length > 0 ||
              impact.introduces.length > 0 ||
              impact.resolves.length > 0) && (
              <div className="cplan__impact">
                {impact.advances.length > 0 && (
                  <p>
                    <strong>Advances</strong> {impact.advances.map(name).join(", ")}
                  </p>
                )}
                {impact.introduces.length > 0 && (
                  <p>
                    <strong>Introduces</strong> {impact.introduces.map(name).join(", ")}
                  </p>
                )}
                {impact.resolves.length > 0 && (
                  <p>
                    <strong>Resolves</strong> {impact.resolves.map(name).join(", ")}
                  </p>
                )}
              </div>
            )}

          {findings !== null && (
            <div className="cplan__findings" role="status">
              {findings.length === 0 ? (
                <p className="severity severity--info">
                  <span className="severity__word">CLEAN</span> Nothing in the plan contradicts the
                  project.
                </p>
              ) : (
                findings.map((finding, index) => (
                  <p key={index} className={`severity severity--${finding.severity}`}>
                    <span className="severity__word">{finding.severity.toUpperCase()}</span>{" "}
                    {finding.message}
                  </p>
                ))
              )}
            </div>
          )}

          <details className="cplan__generate">
            <summary>Draft a plan with Manu</summary>
            <p className="hint">
              Manu proposes a structured plan from the outline, the story state and the live
              threads. It arrives as a draft for you to edit; nothing is approved for you.
            </p>
            <textarea
              className="cplan__instruction"
              value={instruction}
              placeholder="Mara needs to discover the key, but she must not yet understand what it opens."
              onChange={(event) => setInstruction(event.target.value)}
              rows={3}
            />
            <button
              className="btn btn--small"
              onClick={() => void generate()}
              disabled={busy !== null}
            >
              Propose a plan
            </button>
          </details>
        </>
      )}

      {error !== null && (
        <p className="status status--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * One planned scene: the quick plan on the card, the deep plan behind a
 * disclosure. Beats are reorderable lines, not screenplay structure.
 */
function SceneCard({
  scene,
  index,
  last,
  name,
  findings,
  onEdit,
  onMove,
  onRemove,
  onSplit,
  onMerge,
}: {
  scene: PlannedScene;
  index: number;
  last: boolean;
  name: (id: string | undefined) => string;
  findings: readonly PlanFinding[];
  onEdit: (patch: Partial<PlannedScene>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  onSplit: () => void;
  onMerge: () => void;
}) {
  const [beatsText, setBeatsText] = useState<string | null>(null);
  const beats = beatsText ?? scene.beats.join("\n");

  return (
    <section className="cplan__scene">
      <header className="cplan__scene-head">
        <input
          className="cplan__scene-title"
          value={scene.title}
          aria-label={`Scene ${String(index + 1)} title`}
          onChange={(event) => onEdit({ title: event.target.value })}
        />
        <span className="cplan__scene-tools">
          <button
            className="cplan__tool"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            title="Move earlier"
            aria-label="Move earlier"
          >
            ↑
          </button>
          <button
            className="cplan__tool"
            disabled={last}
            onClick={() => onMove(1)}
            title="Move later"
            aria-label="Move later"
          >
            ↓
          </button>
          <button
            className="cplan__tool"
            onClick={onSplit}
            title="Split into two scenes"
            aria-label="Split"
          >
            ⑂
          </button>
          <button
            className="cplan__tool"
            disabled={last}
            onClick={onMerge}
            title="Merge with the next scene"
            aria-label="Merge with next"
          >
            ⑃
          </button>
          <button
            className="cplan__tool"
            onClick={onRemove}
            title="Remove from the plan"
            aria-label="Remove"
          >
            ✕
          </button>
        </span>
      </header>

      {(scene.pov !== undefined ||
        scene.locationId !== undefined ||
        scene.characterIds.length > 0) && (
        <p className="cplan__scene-who">
          {scene.pov !== undefined && <span>POV {name(scene.pov)}</span>}
          {scene.locationId !== undefined && <span> · {name(scene.locationId)}</span>}
          {scene.characterIds.length > 0 && (
            <span> · {scene.characterIds.map(name).join(", ")}</span>
          )}
        </p>
      )}

      <label className="field field--quiet">
        <span>Goal</span>
        <input
          value={scene.objective ?? ""}
          onChange={(event) => onEdit({ objective: event.target.value })}
        />
      </label>
      <label className="field field--quiet">
        <span>Conflict</span>
        <input
          value={scene.conflict ?? ""}
          onChange={(event) => onEdit({ conflict: event.target.value })}
        />
      </label>
      <label className="field field--quiet">
        <span>Outcome</span>
        <input
          value={scene.exitState ?? ""}
          onChange={(event) => onEdit({ exitState: event.target.value })}
        />
      </label>

      <details className="cplan__beats" open={scene.beats.length > 0}>
        <summary>Beats {scene.beats.length > 0 ? `(${String(scene.beats.length)})` : ""}</summary>
        <textarea
          rows={Math.max(3, scene.beats.length + 1)}
          value={beats}
          placeholder={
            "One beat per line:\nMara arrives expecting Elias alone.\nMarcus is unexpectedly present."
          }
          onChange={(event) => setBeatsText(event.target.value)}
          onBlur={() => {
            if (beatsText !== null) {
              onEdit({
                beats: beatsText
                  .split("\n")
                  .map((line) => line.trim())
                  .filter((line) => line !== ""),
              });
              setBeatsText(null);
            }
          }}
        />
      </details>

      {findings.length > 0 && (
        <div className="cplan__scene-findings">
          {findings.map((finding, at) => (
            <p key={at} className={`severity severity--${finding.severity}`}>
              <span className="severity__word">{finding.severity.toUpperCase()}</span>{" "}
              {finding.message}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
