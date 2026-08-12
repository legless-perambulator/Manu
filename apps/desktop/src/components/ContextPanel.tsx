import { useCallback, useEffect, useState } from "react";
import {
  ContextCompiler,
  RECIPES,
  renderContextPackage,
  type ContextPackage,
  type ProjectReader,
  type RecipeName,
} from "@jellytind/context-compiler";
import type { Chapter, Scene } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";

interface Props {
  repo: StoryRepository;
  refreshToken: number;
}

const SECTION_TITLES: Record<string, string> = {
  task: "Task",
  target: "Target",
  primaryText: "Primary text",
  adjacentScenes: "Adjacent scenes",
  characters: "Characters",
  locations: "Locations",
  plotThreads: "Plot threads",
  styleRules: "Style",
  worldRules: "World rules",
  additionalRetrievedContext: "Additional context",
};

/**
 * Inspect Context.
 *
 * Compiling context must never be a black box: this panel shows exactly which
 * elements a recipe selected, **why** each one was included, what the token
 * budget did to it, and the final text a model would receive
 * (docs/CONTEXT_COMPILER.md — "Explicit and inspectable"). It is the debugging
 * surface for the subsystem and the honest answer to "what did the AI actually
 * see?".
 */
export function ContextPanel({ repo, refreshToken }: Props) {
  const [recipe, setRecipe] = useState<RecipeName>("scene_inspection");
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [targetId, setTargetId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [maxTokens, setMaxTokens] = useState(12000);
  const [pkg, setPkg] = useState<ContextPackage | null>(null);
  const [showText, setShowText] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const targetKind = RECIPES.find((r) => r.name === recipe)?.targetKind ?? "scene";
  const targets: Array<{ id: string; label: string }> =
    targetKind === "scene"
      ? scenes.map((s) => ({ id: s.id, label: s.title }))
      : chapters.map((c) => ({ id: c.id, label: c.title }));

  const reload = useCallback(async () => {
    const [s, c] = await Promise.all([repo.listScenes(), repo.listChapters()]);
    setScenes(s);
    setChapters(c);
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  useEffect(() => {
    // Keep the target valid when the recipe switches between scene and chapter.
    if (!targets.some((t) => t.id === targetId)) setTargetId(targets[0]?.id ?? "");
  }, [targets, targetId]);

  async function compile() {
    if (targetId === "") return;
    setBusy(true);
    setError(null);
    try {
      // The repository satisfies the compiler's read port directly.
      const reader: ProjectReader = repo;
      const compiled = await new ContextCompiler(reader).compile({
        recipe,
        targetId,
        budget: { maxTokens, reserveForOutput: Math.round(maxTokens / 6) },
        ...(instruction.trim() === "" ? {} : { instruction: instruction.trim() }),
      });
      setPkg(compiled);
    } catch (cause) {
      setPkg(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const meta = pkg?.metadata;

  return (
    <div className="context">
      <div className="context__controls">
        <label className="field">
          <span>Recipe</span>
          <select
            value={recipe}
            onChange={(e) => setRecipe(e.target.value as RecipeName)}
            disabled={busy}
          >
            {RECIPES.map((r) => (
              <option key={r.name} value={r.name}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">{RECIPES.find((r) => r.name === recipe)?.description}</p>

        <label className="field">
          <span>{targetKind === "scene" ? "Scene" : "Chapter"}</span>
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={busy}>
            {targets.length === 0 && <option value="">none in this project</option>}
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} — {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Instruction (optional)</span>
          <input
            value={instruction}
            placeholder="What is this context for?"
            onChange={(e) => setInstruction(e.target.value)}
            disabled={busy}
          />
        </label>

        <label className="field">
          <span>Token budget</span>
          <input
            type="number"
            min={200}
            step={500}
            value={maxTokens}
            onChange={(e) => setMaxTokens(Math.max(200, Number(e.target.value)))}
            disabled={busy}
          />
        </label>

        <button
          className="btn btn--primary btn--small"
          onClick={() => void compile()}
          disabled={busy || targetId === ""}
        >
          Compile context
        </button>
      </div>

      {error !== null && <p className="status status--error">{error}</p>}

      {pkg !== null && meta !== undefined && (
        <>
          <section className="context__meta">
            <div>
              <strong>{meta.estimatedTokens.toLocaleString()}</strong> of{" "}
              {meta.availableTokens.toLocaleString()} tokens
              {meta.withinBudget ? "" : " — over budget"}
            </div>
            <div className="hint">
              {meta.includedCount} of {meta.candidateCount} candidates at full or summary fidelity ·{" "}
              {meta.tokenEstimator}
            </div>
            <button className="btn btn--ghost btn--small" onClick={() => setShowText(!showText)}>
              {showText ? "Show selection" : "Show compiled text"}
            </button>
          </section>

          {showText ? (
            <pre className="context__text">{renderContextPackage(pkg)}</pre>
          ) : (
            pkg.sections.map((sec) => (
              <section key={sec.name} className="context__section">
                <h3>{SECTION_TITLES[sec.name] ?? sec.name}</h3>
                <ul className="context__items">
                  {sec.items.map((item) => (
                    <li key={`${sec.name}-${item.id}`} className={`ctx ctx--${item.rendering}`}>
                      <div className="ctx__head">
                        <span className="ctx__id">{item.id}</span>
                        <span className="ctx__label">{item.label}</span>
                        <span className="ctx__tokens">
                          {item.estimatedTokens}t
                          {item.rendering === "full" ? "" : ` / ${String(item.fullTokens ?? 0)}t`}
                        </span>
                      </div>
                      <div className="ctx__why">included because: {item.provenance.reason}</div>
                      {item.rendering !== "full" && (
                        <div className="ctx__downgrade">
                          {item.rendering === "summary" ? "summarised" : "reference only"} — budget
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}

          {meta.notes.length > 0 && !showText && (
            <section className="context__section">
              <h3>Budget decisions</h3>
              <ul className="context__items">
                {meta.notes.map((note) => (
                  <li key={`note-${note.id}`} className={`ctx ctx--${note.disposition}`}>
                    <div className="ctx__head">
                      <span className="ctx__id">{note.id}</span>
                      <span className="ctx__label">{note.label}</span>
                      <span className="ctx__tokens">{note.disposition}</span>
                    </div>
                    <div className="ctx__why">{note.reason}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
