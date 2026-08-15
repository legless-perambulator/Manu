import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StoryRepository } from "@jellytind/story-repository";
import type { BuildContext, Diagnostic } from "@jellytind/story-compiler";
import {
  blastRadiusView,
  causalityView,
  characterArcView,
  characterKnowledgeView,
  describeStoryPoint,
  diagnosticOverlay,
  factKnowledgeView,
  relationshipView,
  searchStrip,
  storyPointStops,
  storyTestOverlay,
  threadView,
  timelineView,
  type StoryMapContext,
  type StoryPoint,
} from "@jellytind/story-map";

/** Where another panel can land the writer: a view, a focus, some scenes. */
export interface MapFocus {
  readonly view?: MapView;
  readonly focusId?: string;
  readonly sceneIds?: readonly string[];
}

type MapView = "timeline" | "knowledge" | "relationships" | "causality" | "threads" | "arc";

interface Props {
  repo: StoryRepository;
  refreshToken: number;
  onOpenScene: (sceneId: string) => void;
  onSelectEntity: (id: string) => void;
  /** A handed-in destination — search results, a refactor's blast radius. */
  focus?: MapFocus | null;
}

const VIEWS: ReadonlyArray<{ id: MapView; label: string }> = [
  { id: "timeline", label: "Timeline" },
  { id: "knowledge", label: "Knowledge" },
  { id: "relationships", label: "Relationships" },
  { id: "causality", label: "Causality" },
  { id: "threads", label: "Threads" },
  { id: "arc", label: "Character arc" },
];

const PERSIST_KEY = "manu.story-map";

/** §18: never draw a 200k-word novel at once. The range filter opens the rest. */
const MAX_DRAWN_SCENES = 160;

interface Persisted {
  view?: MapView;
  showDiagnostics?: boolean;
  showTests?: boolean;
}

const loadPersisted = (): Persisted => {
  try {
    return JSON.parse(window.localStorage.getItem(PERSIST_KEY) ?? "{}") as Persisted;
  } catch {
    return {};
  }
};

/**
 * The Story Map (Phase 38): one canonical story, explored visually.
 *
 * Every element is a real entity at its stable ID — clicking a scene opens
 * the scene, clicking a character selects the character used everywhere else
 * (§3, §13). The scrubber (§4) moves one Story Point that the state views
 * answer at; filters keep the defaults clean; arrangement and filter state
 * persist locally and are never story data (§19).
 */
export function StoryMapPanel({ repo, refreshToken, onOpenScene, onSelectEntity, focus }: Props) {
  const persisted = useRef(loadPersisted());
  const [context, setContext] = useState<StoryMapContext | null>(null);
  const [diagnostics, setDiagnostics] = useState<readonly Diagnostic[]>([]);
  const [testFailures, setTestFailures] = useState<
    ReadonlyArray<{ testId: string; sceneIds: readonly string[] }>
  >([]);
  const [view, setView] = useState<MapView>(persisted.current.view ?? "timeline");
  const [pointIndex, setPointIndex] = useState<number | null>(null);
  const [order, setOrder] = useState<"presentation" | "chronology">("presentation");
  const [characterFilter, setCharacterFilter] = useState("");
  const [chapterFilter, setChapterFilter] = useState("");
  const [threadFilter, setThreadFilter] = useState("");
  const [showDiagnostics, setShowDiagnostics] = useState(
    persisted.current.showDiagnostics ?? false,
  );
  const [showTests, setShowTests] = useState(persisted.current.showTests ?? false);
  const [factId, setFactId] = useState("");
  const [knowledgeCharacter, setKnowledgeCharacter] = useState("");
  const [causalityFocus, setCausalityFocus] = useState("");
  const [causalityDepth, setCausalityDepth] = useState(2);
  const [blastMode, setBlastMode] = useState(false);
  const [threadId, setThreadId] = useState("");
  const [arcCharacter, setArcCharacter] = useState("");
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [strip, setStrip] = useState<readonly string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const svgHost = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async () => {
    const [buildContext, latestBuild] = await Promise.all([
      repo.getBuildContext(),
      repo.getLatestBuild(),
    ]);
    // The build context IS the map context (§3): same entities, same IDs.
    setContext(buildContext as BuildContext as unknown as StoryMapContext);
    setDiagnostics(latestBuild?.diagnostics ?? []);
    setTestFailures(
      (latestBuild?.tests.results ?? [])
        .filter((result) => result.failures.length > 0)
        .map((result) => ({
          testId: result.testId,
          sceneIds: result.failures.map((failure) => failure.sceneId),
        })),
    );
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  // §19: remember the useful arrangement — locally, never as story data.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        PERSIST_KEY,
        JSON.stringify({ view, showDiagnostics, showTests } satisfies Persisted),
      );
    } catch {
      // Not remembering a view choice loses nothing from the project.
    }
  }, [view, showDiagnostics, showTests]);

  // A handed-in destination (§12, §17): search results or a refactor focus.
  useEffect(() => {
    if (focus === null || focus === undefined) return;
    if (focus.view !== undefined) setView(focus.view);
    if (focus.focusId !== undefined) {
      setCausalityFocus(focus.focusId);
      setBlastMode(focus.view === "causality");
    }
    setStrip(focus.sceneIds ?? null);
  }, [focus]);

  const stops = useMemo(
    () => (context === null ? [] : storyPointStops(context.scenes, context.chapters)),
    [context],
  );
  const point: StoryPoint | null = useMemo(() => {
    if (stops.length === 0) return null;
    const index = Math.min(pointIndex ?? stops.length - 1, stops.length - 1);
    const stop = stops[index];
    return stop === undefined ? null : { sceneId: stop.sceneId, position: "after" };
  }, [stops, pointIndex]);

  const filters = useMemo(
    () => ({
      ...(characterFilter !== "" ? { characterIds: [characterFilter] } : {}),
      ...(chapterFilter !== "" ? { chapterIds: [chapterFilter] } : {}),
      ...(threadFilter !== "" ? { threadIds: [threadFilter] } : {}),
    }),
    [characterFilter, chapterFilter, threadFilter],
  );

  const overlay = useMemo(
    () => (showDiagnostics ? diagnosticOverlay(diagnostics) : null),
    [showDiagnostics, diagnostics],
  );
  const tests = useMemo(
    () => (showTests && context !== null ? storyTestOverlay(context, testFailures) : []),
    [showTests, context, testFailures],
  );

  const copySvg = async () => {
    const svg = svgHost.current?.querySelector("svg");
    if (svg === null || svg === undefined) return;
    try {
      await navigator.clipboard.writeText(new XMLSerializer().serializeToString(svg));
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard unavailable: the view is still on screen.
    }
  };

  if (context === null) return <p className="hint">Reading the story…</p>;
  if (context.scenes.length === 0) {
    return (
      <p className="hint">
        The Story Map draws the project&rsquo;s recorded structure — scenes, knowledge,
        relationships, causality. Add scenes and it fills in.
      </p>
    );
  }

  return (
    <div className="smap">
      <div className="smap__views" role="tablist">
        {VIEWS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={view === entry.id}
            className={`smap__view${view === entry.id ? " is-active" : ""}`}
            onClick={() => setView(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/* §4: the time scrubber — one Story Point every state view answers at. */}
      <div className="smap__scrubber">
        <input
          type="range"
          min={0}
          max={Math.max(0, stops.length - 1)}
          value={Math.min(pointIndex ?? stops.length - 1, stops.length - 1)}
          onChange={(event) => setPointIndex(Number(event.target.value))}
          aria-label="Story point"
        />
        <span className="smap__point">
          {point !== null ? describeStoryPoint(point, stops) : ""}
          {pointIndex !== null && pointIndex < stops.length - 1 && (
            <button className="btn btn--ghost btn--small" onClick={() => setPointIndex(null)}>
              Back to now
            </button>
          )}
        </span>
      </div>

      <div className="smap__filters">
        <select
          value={characterFilter}
          onChange={(event) => setCharacterFilter(event.target.value)}
          aria-label="Filter by character"
        >
          <option value="">All characters</option>
          {context.characters.map((character) => (
            <option key={character.id} value={character.id as string}>
              {character.name}
            </option>
          ))}
        </select>
        <select
          value={chapterFilter}
          onChange={(event) => setChapterFilter(event.target.value)}
          aria-label="Filter by chapter"
        >
          <option value="">All chapters</option>
          {context.chapters.map((chapter) => (
            <option key={chapter.id} value={chapter.id as string}>
              {chapter.title}
            </option>
          ))}
        </select>
        <select
          value={threadFilter}
          onChange={(event) => setThreadFilter(event.target.value)}
          aria-label="Filter by thread"
        >
          <option value="">All threads</option>
          {context.threads.map((thread) => (
            <option key={thread.id} value={thread.id as string}>
              {thread.name}
            </option>
          ))}
        </select>
        <label className="smap__toggle">
          <input
            type="checkbox"
            checked={showDiagnostics}
            onChange={(event) => setShowDiagnostics(event.target.checked)}
          />
          <span>Diagnostics</span>
        </label>
        <label className="smap__toggle">
          <input
            type="checkbox"
            checked={showTests}
            onChange={(event) => setShowTests(event.target.checked)}
          />
          <span>Story tests</span>
        </label>
        <button className="btn btn--ghost btn--small" onClick={() => void copySvg()}>
          {copied ? "Copied" : "Copy as SVG"}
        </button>
      </div>

      {strip !== null && strip.length > 0 && (
        <div className="smap__strip">
          <span className="hint">From search — in telling order:</span>
          {searchStrip(context, strip).map((entry) => (
            <button
              key={entry.sceneId}
              className="btn btn--small"
              onClick={() => onOpenScene(entry.sceneId)}
            >
              {entry.title}
            </button>
          ))}
          <button className="btn btn--ghost btn--small" onClick={() => setStrip(null)}>
            Clear
          </button>
        </div>
      )}

      <div className="smap__canvas" ref={svgHost}>
        {view === "timeline" && (
          <TimelineCanvas
            context={context}
            filters={filters}
            order={order}
            onOrder={setOrder}
            point={point}
            overlay={overlay}
            tests={tests}
            highlight={strip}
            onOpenScene={onOpenScene}
          />
        )}
        {view === "knowledge" && (
          <KnowledgeView
            context={context}
            point={point}
            factId={factId}
            onFact={setFactId}
            characterId={knowledgeCharacter}
            onCharacter={setKnowledgeCharacter}
            onOpenScene={onOpenScene}
            onSelectEntity={onSelectEntity}
          />
        )}
        {view === "relationships" && (
          <RelationshipsCanvas
            context={context}
            point={point}
            filters={filters}
            selectedEdge={selectedEdge}
            onSelectEdge={setSelectedEdge}
            onOpenScene={onOpenScene}
            onSelectEntity={onSelectEntity}
          />
        )}
        {view === "causality" && (
          <CausalityCanvas
            context={context}
            focusId={causalityFocus}
            depth={causalityDepth}
            blastMode={blastMode}
            overlay={overlay}
            onFocus={(id) => {
              setCausalityFocus(id);
            }}
            onDepth={setCausalityDepth}
            onBlastMode={setBlastMode}
            onOpenScene={onOpenScene}
            onSelectEntity={onSelectEntity}
          />
        )}
        {view === "threads" && (
          <ThreadsCanvas
            context={context}
            threadId={threadId}
            onThread={setThreadId}
            overlay={overlay}
            onOpenScene={onOpenScene}
          />
        )}
        {view === "arc" && (
          <ArcView
            context={context}
            characterId={arcCharacter}
            onCharacter={setArcCharacter}
            onOpenScene={onOpenScene}
            onSelectEntity={onSelectEntity}
          />
        )}
      </div>
    </div>
  );
}

// ── Timeline (§10) ───────────────────────────────────────────────────────────

function TimelineCanvas({
  context,
  filters,
  order,
  onOrder,
  point,
  overlay,
  tests,
  highlight,
  onOpenScene,
}: {
  context: StoryMapContext;
  filters: Parameters<typeof timelineView>[1];
  order: "presentation" | "chronology";
  onOrder: (order: "presentation" | "chronology") => void;
  point: StoryPoint | null;
  overlay: ReturnType<typeof diagnosticOverlay> | null;
  tests: ReturnType<typeof storyTestOverlay>;
  highlight: readonly string[] | null;
  onOpenScene: (sceneId: string) => void;
}) {
  const model = useMemo(() => timelineView(context, filters), [context, filters]);
  const drawn = model.scenes.slice(0, MAX_DRAWN_SCENES);
  const xOf = (scene: (typeof drawn)[number], index: number): number =>
    28 + (order === "chronology" ? (scene.chronologicalIndex ?? index) : index) * 34;
  const width = 60 + Math.max(drawn.length, 1) * 34;
  const laneHeight = 26;
  const lanesTop = 96;
  const testsTop = lanesTop + model.lanes.length * laneHeight + 14;
  const height = testsTop + tests.length * 20 + 26;
  const highlighted = new Set(highlight ?? []);
  const pointX = (() => {
    if (point === null) return null;
    const at = drawn.findIndex((scene) => scene.sceneId === point.sceneId);
    return at === -1 ? null : xOf(drawn[at] as (typeof drawn)[number], at) + 12;
  })();

  return (
    <div className="smap__scroll">
      <div className="smap__ordertoggle">
        <button
          className={`btn btn--ghost btn--small${order === "presentation" ? " is-active" : ""}`}
          onClick={() => onOrder("presentation")}
        >
          Telling order
        </button>
        <button
          className={`btn btn--ghost btn--small${order === "chronology" ? " is-active" : ""}`}
          onClick={() => onOrder("chronology")}
        >
          Story chronology
        </button>
        {model.scenes.length > MAX_DRAWN_SCENES && (
          <span className="hint">
            Showing the first {MAX_DRAWN_SCENES} of {model.scenes.length} scenes — filter by chapter
            or character to see the rest.
          </span>
        )}
        {model.unresolvable.length > 0 && (
          <span className="hint">{model.unresolvable.length} node(s) cannot be ordered.</span>
        )}
      </div>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Story timeline"
        className="smap__svg"
      >
        {pointX !== null && (
          <line x1={pointX} y1={8} x2={pointX} y2={height - 8} className="smap__pointline" />
        )}
        {drawn.map((scene, index) => {
          const x = xOf(scene, index);
          const flagged = overlay?.byScene[scene.sceneId] !== undefined;
          return (
            <g key={scene.sceneId}>
              <circle
                cx={x + 12}
                cy={56}
                r={highlighted.has(scene.sceneId) ? 9 : 7}
                className={`smap__scene${scene.isFlashback ? " smap__scene--flashback" : ""}${
                  highlighted.has(scene.sceneId) ? " smap__scene--hit" : ""
                }`}
                role="button"
                aria-label={`Open ${scene.title}`}
                onClick={() => onOpenScene(scene.sceneId)}
              >
                <title>
                  {scene.title}
                  {scene.chapterTitle !== undefined ? ` — ${scene.chapterTitle}` : ""}
                  {scene.isFlashback ? " (flashback)" : ""}
                </title>
              </circle>
              {flagged && <circle cx={x + 18} cy={48} r={3} className="smap__flag" />}
              {index % 2 === 0 && (
                <text x={x + 12} y={82} textAnchor="middle" className="smap__label">
                  {scene.title.length > 10 ? `${scene.title.slice(0, 9)}…` : scene.title}
                </text>
              )}
            </g>
          );
        })}
        {model.events.map((event, index) => {
          const at =
            event.sceneId === undefined
              ? -1
              : drawn.findIndex((scene) => scene.sceneId === event.sceneId);
          const x = at === -1 ? 28 + index * 34 : xOf(drawn[at] as (typeof drawn)[number], at);
          return (
            <g key={event.eventId}>
              <rect x={x + 6} y={16} width={12} height={12} className="smap__event">
                <title>
                  {event.name}
                  {event.isHistorical ? " (historical, before the story opens)" : ""}
                </title>
              </rect>
            </g>
          );
        })}
        {model.lanes.map((lane, laneIndex) => {
          const y = lanesTop + laneIndex * laneHeight;
          const xs = lane.stops
            .map((stop) => {
              const at = drawn.findIndex((scene) => scene.sceneId === stop.sceneId);
              return at === -1 ? null : xOf(drawn[at] as (typeof drawn)[number], at) + 12;
            })
            .filter((x): x is number => x !== null);
          return (
            <g key={lane.characterId}>
              <text x={4} y={y + 4} className="smap__label">
                {lane.name}
              </text>
              {xs.length > 1 && (
                <line x1={xs[0]} y1={y} x2={xs[xs.length - 1]} y2={y} className="smap__lane" />
              )}
              {lane.stops.map((stop) => {
                const at = drawn.findIndex((scene) => scene.sceneId === stop.sceneId);
                if (at === -1) return null;
                return (
                  <circle
                    key={stop.sceneId}
                    cx={xOf(drawn[at] as (typeof drawn)[number], at) + 12}
                    cy={y}
                    r={3.5}
                    className="smap__stop"
                    onClick={() => onOpenScene(stop.sceneId)}
                  />
                );
              })}
            </g>
          );
        })}
        {tests.map((test, testIndex) => {
          const y = testsTop + testIndex * 20;
          const span = test.scopeSceneIds
            .map((sceneId) => drawn.findIndex((scene) => scene.sceneId === sceneId))
            .filter((index) => index !== -1);
          if (span.length === 0) return null;
          const from = Math.min(...span);
          const to = Math.max(...span);
          return (
            <g key={test.testId}>
              <line
                x1={xOf(drawn[from] as (typeof drawn)[number], from) + 12}
                y1={y}
                x2={xOf(drawn[to] as (typeof drawn)[number], to) + 12}
                y2={y}
                className="smap__testspan"
              >
                <title>{test.statement}</title>
              </line>
              {test.failSceneIds.map((sceneId) => {
                const at = drawn.findIndex((scene) => scene.sceneId === sceneId);
                if (at === -1) return null;
                const x = xOf(drawn[at] as (typeof drawn)[number], at) + 12;
                return (
                  <text key={sceneId} x={x} y={y + 4} textAnchor="middle" className="smap__fail">
                    ✕
                  </text>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Knowledge (§5) ───────────────────────────────────────────────────────────

function KnowledgeView({
  context,
  point,
  factId,
  onFact,
  characterId,
  onCharacter,
  onOpenScene,
  onSelectEntity,
}: {
  context: StoryMapContext;
  point: StoryPoint | null;
  factId: string;
  onFact: (id: string) => void;
  characterId: string;
  onCharacter: (id: string) => void;
  onOpenScene: (sceneId: string) => void;
  onSelectEntity: (id: string) => void;
}) {
  if (point === null) return null;
  const fact = factId !== "" ? factId : ((context.facts[0]?.id as string | undefined) ?? "");
  return (
    <div className="smap__panes">
      <section>
        <label className="field">
          <span>Fact</span>
          <select value={fact} onChange={(event) => onFact(event.target.value)}>
            {context.facts.map((held) => (
              <option key={held.id} value={held.id as string}>
                {held.statement}
              </option>
            ))}
          </select>
        </label>
        {fact !== "" && (
          <ul className="smap__rows">
            {factKnowledgeView(context, fact, point).rows.map((row) => (
              <li key={row.characterId} className="smap__row">
                <button className="btn btn--small" onClick={() => onSelectEntity(row.characterId)}>
                  {row.name}
                </button>
                <span className={`smap__kstate smap__kstate--${row.state}`}>{row.state}</span>
                {row.acquiredAtSceneId !== undefined && (
                  <button
                    className="btn btn--ghost btn--small"
                    onClick={() => onOpenScene(row.acquiredAtSceneId as string)}
                  >
                    {row.acquiredAtSceneId}
                  </button>
                )}
                {row.sourceEntityId !== undefined && (
                  <span className="hint">
                    source:{" "}
                    {context.characters.find((c) => c.id === row.sourceEntityId)?.name ??
                      row.sourceEntityId}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <label className="field">
          <span>A character&rsquo;s information world</span>
          <select value={characterId} onChange={(event) => onCharacter(event.target.value)}>
            <option value="">Pick a character…</option>
            {context.characters.map((held) => (
              <option key={held.id} value={held.id as string}>
                {held.name}
              </option>
            ))}
          </select>
        </label>
        {characterId !== "" && (
          <ul className="smap__rows">
            {characterKnowledgeView(context, characterId, point).holdings.map((holding) => (
              <li key={holding.factId} className="smap__row">
                <span className={`smap__kstate smap__kstate--${holding.state}`}>
                  {holding.state}
                </span>
                <span>{holding.statement}</span>
                {holding.acquiredAtSceneId !== undefined && (
                  <button
                    className="btn btn--ghost btn--small"
                    onClick={() => onOpenScene(holding.acquiredAtSceneId as string)}
                  >
                    {holding.acquiredAtSceneId}
                  </button>
                )}
              </li>
            ))}
            {characterKnowledgeView(context, characterId, point).holdings.length === 0 && (
              <li className="hint">Nothing yet, at this story point.</li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Relationships (§6) ───────────────────────────────────────────────────────

function RelationshipsCanvas({
  context,
  point,
  filters,
  selectedEdge,
  onSelectEdge,
  onOpenScene,
  onSelectEntity,
}: {
  context: StoryMapContext;
  point: StoryPoint | null;
  filters: Parameters<typeof relationshipView>[2];
  selectedEdge: string | null;
  onSelectEdge: (id: string | null) => void;
  onOpenScene: (sceneId: string) => void;
  onSelectEntity: (id: string) => void;
}) {
  const model = useMemo(
    () => (point === null ? null : relationshipView(context, point, filters)),
    [context, point, filters],
  );
  if (model === null) return null;
  const size = 340;
  const radius = 130;
  const positions = new Map(
    model.nodes.map((node, index) => {
      const angle = (index / Math.max(model.nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
      return [
        node.characterId,
        { x: size / 2 + radius * Math.cos(angle), y: size / 2 + radius * Math.sin(angle) },
      ];
    }),
  );
  const selected = model.edges.find((edge) => edge.relationshipId === selectedEdge) ?? null;

  return (
    <div className="smap__panes">
      <svg width={size} height={size} role="img" aria-label="Relationships" className="smap__svg">
        {model.edges.map((edge) => {
          const a = positions.get(edge.characterAId);
          const b = positions.get(edge.characterBId);
          if (a === undefined || b === undefined) return null;
          return (
            <line
              key={edge.relationshipId}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={`smap__edge${selectedEdge === edge.relationshipId ? " is-selected" : ""}`}
              onClick={() => onSelectEdge(edge.relationshipId)}
            >
              <title>{edge.status}</title>
            </line>
          );
        })}
        {model.nodes.map((node) => {
          const at = positions.get(node.characterId);
          if (at === undefined) return null;
          return (
            <g key={node.characterId} onClick={() => onSelectEntity(node.characterId)}>
              <circle cx={at.x} cy={at.y} r={16} className="smap__node" />
              <text x={at.x} y={at.y + 28} textAnchor="middle" className="smap__label">
                {node.name}
              </text>
            </g>
          );
        })}
      </svg>
      {selected !== null && (
        <section className="smap__detail">
          <h4>
            {model.nodes.find((n) => n.characterId === selected.characterAId)?.name} ↔{" "}
            {model.nodes.find((n) => n.characterId === selected.characterBId)?.name}
          </h4>
          <p>
            Current: <strong>{selected.status}</strong> ({selected.type})
          </p>
          {selected.dimensions.map((dimension) => (
            <p key={dimension.dimension}>
              {dimension.dimension}: <strong>{dimension.value}</strong>
            </p>
          ))}
          {selected.keyChangeSceneIds.length > 0 && (
            <>
              <p className="hint">Key changes:</p>
              <div className="build__links">
                {selected.keyChangeSceneIds.map((sceneId) => (
                  <button
                    key={sceneId}
                    className="btn btn--small"
                    onClick={() => onOpenScene(sceneId)}
                  >
                    {sceneId}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ── Causality (§7, §17) ──────────────────────────────────────────────────────

function CausalityCanvas({
  context,
  focusId,
  depth,
  blastMode,
  overlay,
  onFocus,
  onDepth,
  onBlastMode,
  onOpenScene,
  onSelectEntity,
}: {
  context: StoryMapContext;
  focusId: string;
  depth: number;
  blastMode: boolean;
  overlay: ReturnType<typeof diagnosticOverlay> | null;
  onFocus: (id: string) => void;
  onDepth: (depth: number) => void;
  onBlastMode: (on: boolean) => void;
  onOpenScene: (sceneId: string) => void;
  onSelectEntity: (id: string) => void;
}) {
  const inGraph = useMemo(
    () =>
      [
        ...new Set(
          context.dependencies.flatMap((dependency) => [dependency.fromId, dependency.toId]),
        ),
      ].sort(),
    [context],
  );
  const focus = focusId !== "" ? focusId : (inGraph[0] ?? "");
  const model = useMemo(
    () =>
      focus === "" ? null : causalityView(context, focus, { upDepth: depth, downDepth: depth }),
    [context, focus, depth],
  );
  const blast = useMemo(
    () => (blastMode && focus !== "" ? blastRadiusView(context, focus) : null),
    [blastMode, context, focus],
  );
  if (model === null) {
    return <p className="hint">No cause-and-effect links recorded yet.</p>;
  }

  const open = (id: string): void => {
    if (id.startsWith("SCENE_")) onOpenScene(id);
    else onSelectEntity(id);
  };
  const distances = [...new Set(model.nodes.map((node) => node.distance))].sort((a, b) => a - b);

  return (
    <div>
      <div className="smap__controls">
        <select value={focus} onChange={(event) => onFocus(event.target.value)} aria-label="Focus">
          {inGraph.map((id) => (
            <option key={id} value={id}>
              {model.nodes.find((node) => node.id === id)?.label ?? labelIn(context, id)}
            </option>
          ))}
        </select>
        <button className="btn btn--ghost btn--small" onClick={() => onDepth(depth + 1)}>
          Expand further
        </button>
        {depth > 1 && (
          <button className="btn btn--ghost btn--small" onClick={() => onDepth(depth - 1)}>
            Tighter
          </button>
        )}
        <label className="smap__toggle">
          <input
            type="checkbox"
            checked={blastMode}
            onChange={(event) => onBlastMode(event.target.checked)}
          />
          <span>Blast radius</span>
        </label>
        {model.cyclic && <span className="hint">This graph contains a cycle.</span>}
      </div>
      <div className="smap__columns">
        {distances.map((distance) => (
          <div key={distance} className="smap__column">
            <p className="smap__colhead">
              {distance === 0
                ? "Focus"
                : distance < 0
                  ? `Prerequisite ${String(-distance)} step${distance === -1 ? "" : "s"} up`
                  : `Consequence ${String(distance)} step${distance === 1 ? "" : "s"} on`}
            </p>
            {model.nodes
              .filter((node) => node.distance === distance)
              .map((node) => (
                <div
                  key={node.id}
                  className={`smap__cnode${node.distance === 0 ? " is-focus" : ""}${
                    blast?.affected.some((entry) => entry.id === node.id) === true
                      ? " is-affected"
                      : ""
                  }`}
                >
                  <button className="smap__cnodebtn" onClick={() => onFocus(node.id)}>
                    {node.label}
                  </button>
                  {overlay?.byEntity[node.id] !== undefined && (
                    <span className="smap__flagword">issue</span>
                  )}
                  <button className="btn btn--ghost btn--small" onClick={() => open(node.id)}>
                    Open
                  </button>
                </div>
              ))}
          </div>
        ))}
      </div>
      {blast !== null && (
        <p className="hint">
          A change to “{blast.focusLabel}” may reach {blast.total} element(s)
          {blast.total > 0
            ? `: ${blast.affected
                .slice(0, 6)
                .map((entry) => entry.label)
                .join(", ")}${blast.total > 6 ? "…" : ""}.`
            : "."}
        </p>
      )}
    </div>
  );
}

const labelIn = (context: StoryMapContext, id: string): string =>
  context.scenes.find((held) => held.id === id)?.title ??
  context.characters.find((held) => held.id === id)?.name ??
  context.threads.find((held) => held.id === id)?.name ??
  context.facts.find((held) => held.id === id)?.statement ??
  id;

// ── Threads (§8) ─────────────────────────────────────────────────────────────

function ThreadsCanvas({
  context,
  threadId,
  onThread,
  overlay,
  onOpenScene,
}: {
  context: StoryMapContext;
  threadId: string;
  onThread: (id: string) => void;
  overlay: ReturnType<typeof diagnosticOverlay> | null;
  onOpenScene: (sceneId: string) => void;
}) {
  const thread =
    threadId !== "" ? threadId : ((context.threads[0]?.id as string | undefined) ?? "");
  const model = useMemo(
    () => (thread === "" ? null : threadView(context, thread)),
    [context, thread],
  );
  if (model === null) return <p className="hint">No plot threads recorded yet.</p>;
  const dormant = new Set(
    model.dormantSpans.flatMap((span) =>
      model.chapters
        .filter(
          (chapter) =>
            chapter.order >=
              (model.chapters.find((held) => held.chapterId === span.fromChapterId)?.order ?? 0) &&
            chapter.order <=
              (model.chapters.find((held) => held.chapterId === span.toChapterId)?.order ?? 0),
        )
        .map((chapter) => chapter.chapterId),
    ),
  );
  return (
    <div>
      <div className="smap__controls">
        <select value={thread} onChange={(event) => onThread(event.target.value)}>
          {context.threads.map((held) => (
            <option key={held.id} value={held.id as string}>
              {held.name}
            </option>
          ))}
        </select>
        <span className="hint">{model.status}</span>
      </div>
      <ol className="smap__threadstrip">
        {model.chapters.map((chapter) => (
          <li
            key={chapter.chapterId}
            className={`smap__tchapter${dormant.has(chapter.chapterId) ? " is-dormant" : ""}`}
          >
            <span className="smap__tchaptertitle">{chapter.title}</span>
            {chapter.marks.length === 0 ? (
              <span className="smap__tquiet">
                {dormant.has(chapter.chapterId) ? "· dormant" : ""}
              </span>
            ) : (
              chapter.marks.map((mark) => (
                <button
                  key={mark.sceneId}
                  className={`smap__tmark smap__tmark--${mark.kind}`}
                  onClick={() => onOpenScene(mark.sceneId)}
                >
                  ● {mark.kind}
                  {overlay?.byScene[mark.sceneId] !== undefined ? " · issue" : ""}
                </button>
              ))
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Character arc (§9) ───────────────────────────────────────────────────────

function ArcView({
  context,
  characterId,
  onCharacter,
  onOpenScene,
  onSelectEntity,
}: {
  context: StoryMapContext;
  characterId: string;
  onCharacter: (id: string) => void;
  onOpenScene: (sceneId: string) => void;
  onSelectEntity: (id: string) => void;
}) {
  const character =
    characterId !== "" ? characterId : ((context.characters[0]?.id as string | undefined) ?? "");
  const model = useMemo(
    () => (character === "" ? null : characterArcView(context, character)),
    [context, character],
  );
  if (model === null) return null;
  return (
    <div>
      <div className="smap__controls">
        <select value={character} onChange={(event) => onCharacter(event.target.value)}>
          {context.characters.map((held) => (
            <option key={held.id} value={held.id as string}>
              {held.name}
            </option>
          ))}
        </select>
        {model.goals.length > 0 && <span className="hint">Goals: {model.goals.join(" · ")}</span>}
      </div>
      {model.milestones.length === 0 ? (
        <p className="hint">
          No recorded changes yet — milestones appear as state, knowledge and relationships are
          recorded.
        </p>
      ) : (
        <ol className="smap__arc">
          {model.milestones.map((milestone, index) => (
            <li key={index} className={`smap__milestone smap__milestone--${milestone.kind}`}>
              <span className="smap__mkind">{milestone.kind}</span>
              <span>{milestone.label}</span>
              <button
                className="btn btn--ghost btn--small"
                onClick={() => onOpenScene(milestone.sceneId)}
              >
                {milestone.sceneId}
              </button>
              {milestone.aboutId !== undefined && !milestone.aboutId.startsWith("SCENE_") && (
                <button
                  className="btn btn--ghost btn--small"
                  onClick={() => onSelectEntity(milestone.aboutId as string)}
                >
                  view
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
