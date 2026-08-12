import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Character,
  Location,
  PlotThread,
  Scene,
  StoryTime,
  StoryTimeKind,
  TemporalLink,
  TemporalRelation,
} from "@jellytind/domain";
import { describeStoryTime, RELATION_VERBS, TEMPORAL_RELATIONS } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import type { StoryChronology, TimelineNode, TimelineViolation } from "@jellytind/story-state";
import { explainEditError } from "../lib/editing";

interface Props {
  repo: StoryRepository;
  refreshToken: number;
  onChanged: () => void;
  onSelectEntity: (id: string) => void;
}

type Ordering = "story" | "manuscript";
type Layer = "characters" | "locations" | "threads";

const PLACEHOLDERS: Readonly<Record<string, string>> = {
  exact: "1997-08-14T22:00:00Z",
  date: "1997-08-14",
  approximate: "the summer of the fire",
  ordinal: "Day 3, evening",
};

/**
 * The visual timeline.
 *
 * Two orderings of the same material, switchable, because the difference
 * between them *is* the information: a story presented 1-2-3-4 that happens
 * 3-1-2-4 has a flashback, and no other view in the app shows that.
 *
 * Positions along the chart are ranks, not a scaled clock. Most projects carry
 * no calendar at all — a chart that needed one would be empty for them, and the
 * ordering is exactly as true without it (docs/TIMELINE.md).
 */
export function TimelinePanel({ repo, refreshToken, onChanged, onSelectEntity }: Props) {
  const [chronology, setChronology] = useState<StoryChronology | null>(null);
  const [violations, setViolations] = useState<TimelineViolation[]>([]);
  const [links, setLinks] = useState<TemporalLink[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [threads, setThreads] = useState<PlotThread[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());

  const [ordering, setOrdering] = useState<Ordering>("story");
  const [layer, setLayer] = useState<Layer>("characters");
  const [filterId, setFilterId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [timeKind, setTimeKind] = useState<StoryTimeKind | "">("");
  const [timeValue, setTimeValue] = useState("");
  const [relation, setRelation] = useState<TemporalRelation>("before");
  const [relateTo, setRelateTo] = useState("");

  const label = useCallback((id: string) => names.get(id) ?? id, [names]);

  const load = useCallback(async () => {
    const [built, found, allLinks, chars, locs, plots, summaries] = await Promise.all([
      repo.getStoryChronology(),
      repo.checkTimeline(),
      repo.listTemporalLinks(),
      repo.listCharacters(),
      repo.listLocations(),
      repo.listPlotThreads(),
      repo.listEntitySummaries(),
    ]);
    setChronology(built);
    setViolations(found);
    setLinks(allLinks);
    setCharacters(chars);
    setLocations(locs);
    setThreads(plots);
    setNames(new Map(summaries.map((s) => [s.id, s.name])));
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const nodes = useMemo<TimelineNode[]>(() => {
    if (chronology === null) return [];
    const all =
      ordering === "story" ? chronology.chronologicalOrder() : chronology.presentationOrder();
    if (filterId === "") return all;
    return all.filter((n) =>
      layer === "characters"
        ? n.characterIds.includes(filterId)
        : layer === "locations"
          ? n.locationId === filterId
          : n.plotThreadIds.includes(filterId),
    );
  }, [chronology, ordering, filterId, layer]);

  const occupies = useCallback(
    (node: TimelineNode, laneId: string): boolean =>
      layer === "characters"
        ? node.characterIds.includes(laneId)
        : layer === "locations"
          ? node.locationId === laneId
          : node.plotThreadIds.includes(laneId),
    [layer],
  );

  /** One lane per participant the filtered view actually shows. */
  const lanes = useMemo<Array<{ id: string; name: string }>>(() => {
    const source =
      layer === "characters"
        ? characters.map((c) => ({ id: c.id as string, name: c.name }))
        : layer === "locations"
          ? locations.map((l) => ({ id: l.id as string, name: l.name }))
          : threads.map((t) => ({ id: t.id as string, name: t.name }));
    return source.filter((lane) => nodes.some((node) => occupies(node, lane.id)));
  }, [nodes, layer, characters, locations, threads, occupies]);

  const selected = selectedId === null ? null : (nodes.find((n) => n.id === selectedId) ?? null);
  const violationsFor = (id: string): TimelineViolation[] =>
    violations.filter((v) => v.nodeIds.includes(id));

  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
      onChanged();
    } catch (cause) {
      setError(explainEditError(cause));
    } finally {
      setBusy(false);
    }
  }

  const filterOptions =
    layer === "characters"
      ? characters.map((c) => ({ id: c.id as string, name: c.name }))
      : layer === "locations"
        ? locations.map((l) => ({ id: l.id as string, name: l.name }))
        : threads.map((t) => ({ id: t.id as string, name: t.name }));

  return (
    <div className="state">
      <div className="state__controls">
        <div className="state__toggle">
          <button
            className={`btn btn--small${ordering === "story" ? " btn--primary" : ""}`}
            onClick={() => setOrdering("story")}
            title="The order things happen in the story world"
          >
            Story order
          </button>
          <button
            className={`btn btn--small${ordering === "manuscript" ? " btn--primary" : ""}`}
            onClick={() => setOrdering("manuscript")}
            title="The order the reader meets them"
          >
            Manuscript order
          </button>
        </div>
        <label className="field">
          <span>Layer</span>
          <select
            value={layer}
            onChange={(e) => {
              setLayer(e.target.value as Layer);
              setFilterId("");
            }}
          >
            <option value="characters">Characters</option>
            <option value="locations">Locations</option>
            <option value="threads">Plot threads</option>
          </select>
        </label>
        <label className="field">
          <span>Showing</span>
          <select value={filterId} onChange={(e) => setFilterId(e.target.value)}>
            <option value="">Everything</option>
            {filterOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error !== null && <p className="status status--error">{error}</p>}

      {nodes.length === 0 ? (
        <p className="hint">Nothing on the timeline yet. Add scenes or story events.</p>
      ) : (
        <div className="tl__scroll">
          <table className="tl__chart">
            <thead>
              <tr>
                <th className="tl__corner" />
                {nodes.map((node) => (
                  <th key={node.id} className="tl__head">
                    <button
                      className={[
                        "tl__node",
                        `tl__node--${node.kind}`,
                        node.id === selectedId ? "tl__node--on" : "",
                        chronology?.isFlashback(node.id) === true ? "tl__node--flashback" : "",
                        violationsFor(node.id).length > 0 ? "tl__node--bad" : "",
                      ]
                        .filter((c) => c !== "")
                        .join(" ")}
                      title={`${node.label} — ${describeStoryTime(node.storyTime)}`}
                      onClick={() => setSelectedId(node.id === selectedId ? null : node.id)}
                    >
                      {node.label}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lanes.map((lane) => (
                <tr key={lane.id}>
                  <th className="tl__lane">{lane.name}</th>
                  {nodes.map((node) => (
                    <td key={node.id} className="tl__cell">
                      {occupies(node, lane.id) ? (
                        <span
                          className={`tl__dot tl__dot--${node.kind}`}
                          title={`${lane.name} in ${node.label}`}
                        />
                      ) : (
                        <span className="tl__thread" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected !== null && chronology !== null && (
        <section className="state__section">
          <h3>Selected</h3>
          <div className="state__card">
            <div className="state__card-head">
              <strong>{selected.label}</strong>
              <span className="ctx__id">{selected.id}</span>
              <button className="btn btn--small" onClick={() => onSelectEntity(selected.id)}>
                Inspect
              </button>
            </div>
            <ul className="state__knowledge">
              <li>when: {describeStoryTime(selected.storyTime)}</li>
              <li>
                story position: {chronology.chronologicalIndexOf(selected.id) + 1} of{" "}
                {chronology.chronologicalOrder().length}
              </li>
              <li>
                manuscript position:{" "}
                {selected.presentationIndex === undefined
                  ? "not presented directly"
                  : selected.presentationIndex + 1}
              </li>
              {selected.locationId !== undefined && <li>at: {label(selected.locationId)}</li>}
              {selected.characterIds.length > 0 && (
                <li>present: {selected.characterIds.map(label).join(", ")}</li>
              )}
            </ul>

            {chronology.isFlashback(selected.id) && (
              <p className="ctx__why">
                Presented after material that happens later — out of chronological sequence.
              </p>
            )}
            {chronology.simultaneousWith(selected.id).length > 0 && (
              <p className="ctx__why">
                Same story moment as{" "}
                {chronology
                  .simultaneousWith(selected.id)
                  .map((n) => n.label)
                  .join(", ")}
                .
              </p>
            )}
            {violationsFor(selected.id).map((violation, i) => (
              <p key={i} className="state__rejected">
                {violation.message}
              </p>
            ))}
          </div>

          {selected.kind === "scene" && (
            <>
              <label className="field">
                <span>Story time</span>
                <select
                  value={timeKind}
                  onChange={(e) => {
                    setTimeKind(e.target.value as StoryTimeKind | "");
                    setTimeValue("");
                  }}
                  disabled={busy}
                >
                  <option value="">choose a precision…</option>
                  <option value="exact">exact instant</option>
                  <option value="date">date only</option>
                  <option value="approximate">approximate</option>
                  <option value="ordinal">ordered marker</option>
                  <option value="unknown">unknown</option>
                </select>
              </label>
              {timeKind !== "" && timeKind !== "unknown" && (
                <label className="field">
                  <span>Value</span>
                  <input
                    value={timeValue}
                    placeholder={PLACEHOLDERS[timeKind] ?? ""}
                    onChange={(e) => setTimeValue(e.target.value)}
                    disabled={busy}
                  />
                </label>
              )}
              <button
                className="btn btn--primary btn--small"
                disabled={busy || timeKind === ""}
                onClick={() =>
                  void run(async () => {
                    await repo.updateEntity<Scene>(selected.id, {
                      storyTime: buildStoryTime(timeKind, timeValue),
                    });
                    setTimeKind("");
                    setTimeValue("");
                  })
                }
              >
                Set story time
              </button>
              <p className="hint">
                Every precision is legitimate. A story with no calendar is ordered by relations
                alone.
              </p>
            </>
          )}

          <label className="field">
            <span>This</span>
            <select
              value={relation}
              onChange={(e) => setRelation(e.target.value as TemporalRelation)}
              disabled={busy}
            >
              {TEMPORAL_RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {RELATION_VERBS[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>That</span>
            <select value={relateTo} onChange={(e) => setRelateTo(e.target.value)} disabled={busy}>
              <option value="">choose…</option>
              {chronology
                .chronologicalOrder()
                .filter((n) => n.id !== selected.id)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="btn btn--primary btn--small"
            disabled={busy || relateTo === ""}
            onClick={() =>
              void run(async () => {
                await repo.addTemporalLinks([{ fromId: selected.id, toId: relateTo, relation }]);
                setRelateTo("");
              })
            }
          >
            Record relation
          </button>
        </section>
      )}

      {links.length > 0 && (
        <section className="state__section">
          <h3>Temporal relations</h3>
          <ul className="rel__changes">
            {links.map((link) => (
              <li key={link.id}>
                <span className="rel__from">{label(link.fromId)}</span>
                <span className="rel__arrow">{RELATION_VERBS[link.relation]}</span>
                <span className="rel__to">{label(link.toId)}</span>
                {link.confirmationStatus !== "confirmed" && (
                  <span className="badge"> {link.confirmationStatus}</span>
                )}
                <button
                  className="btn btn--small"
                  disabled={busy}
                  onClick={() => void run(() => repo.deleteTemporalLink(link.id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="state__section">
        <h3>Timeline check</h3>
        {violations.length === 0 ? (
          <p className="status status--ok">No contradictions found.</p>
        ) : (
          <ul className="state__knowledge">
            {violations.map((violation, i) => (
              <li key={i} className={`ctx--${violation.severity}`}>
                {violation.message}
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          Travel times are never assumed. Declare one between two locations and journeys that cannot
          fit become checkable.
        </p>
      </section>
    </div>
  );
}

/**
 * Turn the form into a story time, or `undefined` to clear it.
 *
 * An approximate time keeps the writer's own words as its label rather than
 * being coerced into a range they never gave — "that winter" is a real answer,
 * not a missing one.
 */
function buildStoryTime(kind: StoryTimeKind | "", value: string): StoryTime | undefined {
  const text = value.trim();
  switch (kind) {
    case "exact":
      return text === "" ? undefined : { kind: "exact", instant: text };
    case "date":
      return text === "" ? undefined : { kind: "date", date: text };
    case "approximate":
      return text === "" ? undefined : { kind: "approximate", label: text };
    case "ordinal":
      return text === "" ? undefined : { kind: "ordinal", label: text };
    case "unknown":
      return { kind: "unknown" };
    default:
      return undefined;
  }
}
