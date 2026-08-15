import { useEffect, useState } from "react";
import type { StoryRepository, SearchHit, ResultKind } from "@jellytind/story-repository";

interface Props {
  repo: StoryRepository;
  onOpenFile: (path: string) => void;
  onSelectEntity: (id: string) => void;
  refreshToken: number;
  /** Arrange the hits' scenes on the Story Map, chronologically (Phase 38 §12). */
  onShowOnMap?: (sceneIds: readonly string[]) => void;
}

const FILTERS: ResultKind[] = [
  "prose",
  "character",
  "location",
  "object",
  "scene",
  "plot_thread",
  "fact",
  "event",
];

const KIND_LABELS: Partial<Record<ResultKind, string>> = {
  prose: "prose",
  plot_thread: "thread",
  world_rule: "rule",
};

function label(kind: ResultKind): string {
  return KIND_LABELS[kind] ?? kind;
}

export function SearchPanel({
  repo,
  onOpenFile,
  onSelectEntity,
  refreshToken,
  onShowOnMap,
}: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<Set<ResultKind>>(new Set());
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [ran, setRan] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q === "") {
      setHits([]);
      setRan(false);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      const filters = active.size > 0 ? { kinds: [...active] } : undefined;
      repo
        .searchText({ text: q, filters, limit: 100 })
        .then((results) => {
          if (!cancelled) {
            setHits(results);
            setRan(true);
          }
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [repo, query, active, refreshToken]);

  function toggle(kind: ResultKind) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  function openHit(hit: SearchHit) {
    if (hit.meta.path !== undefined) onOpenFile(hit.meta.path);
    else if (hit.meta.entityId !== undefined) onSelectEntity(String(hit.meta.entityId));
  }

  return (
    <div className="search">
      <div className="search__box">
        <input
          className="search__input"
          placeholder='Search prose & entities — e.g. "brass key"'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>
      <div className="search__filters">
        {FILTERS.map((k) => (
          <button
            key={k}
            className={`chip${active.has(k) ? " chip--on" : ""}`}
            onClick={() => toggle(k)}
          >
            {label(k)}
          </button>
        ))}
      </div>
      <div className="search__results">
        {ran && hits.length === 0 && <p className="placeholder">No matches.</p>}
        {onShowOnMap !== undefined && hits.some((hit) => hit.meta.sceneId !== undefined) && (
          <button
            className="btn btn--ghost btn--small"
            onClick={() =>
              onShowOnMap([
                ...new Set(
                  hits
                    .map((hit) => hit.meta.sceneId)
                    .filter((sceneId): sceneId is string => sceneId !== undefined),
                ),
              ])
            }
          >
            Show on Story Map
          </button>
        )}
        {hits.map((hit) => (
          <button key={hit.id} className="result" onClick={() => openHit(hit)}>
            <div className="result__head">
              <span className="result__kind">{label(hit.meta.kind)}</span>
              <span className="result__title">{hit.meta.title}</span>
            </div>
            <div className="result__excerpt">{hit.excerpt}</div>
            <div className="result__loc">
              {hit.meta.path ?? String(hit.meta.entityId ?? "")}
              {hit.meta.chapterId !== undefined ? ` · ${hit.meta.chapterId}` : ""}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
