import { useCallback, useEffect, useState } from "react";
import type { BehaviourTest, Counterfactual, PersonalityDimension } from "@jellytind/domain";
import { PERSONALITY_DIMENSIONS, describePlausibility } from "@jellytind/domain";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  auditAgency,
  snapshotAt,
  testBehaviour,
  whatWouldTheyDo,
  type AgencyAudit,
  type CharacterSnapshot,
} from "@jellytind/character-sim";
import { createCharacterAnalyst } from "../lib/editing";

interface Props {
  repo: StoryRepository;
  secrets: SecretStore;
  refreshToken: number;
  onChanged: () => void;
  onSelectEntity: (id: string) => void;
  onOpenScene: (sceneId: string) => void;
}

/**
 * The Character Simulator.
 *
 * Two things are kept visibly apart throughout: what the project **records**
 * about this person at this point in the story, and what a model **makes** of
 * a proposed action against it. The first is checkable and the second is a
 * reading — and a writer deciding whether to rewrite a scene needs to know
 * which they are looking at (docs/SIMULATIONS.md).
 */
export function BehaviourPanel({
  repo,
  secrets,
  refreshToken,
  onChanged,
  onSelectEntity,
  onOpenScene,
}: Props) {
  const [characters, setCharacters] = useState<Array<{ id: string; name: string }>>([]);
  const [scenes, setScenes] = useState<Array<{ id: string; title: string }>>([]);
  const [characterId, setCharacterId] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [snapshot, setSnapshot] = useState<CharacterSnapshot | null>(null);
  const [action, setAction] = useState("");
  const [test, setTest] = useState<BehaviourTest | null>(null);
  const [instead, setInstead] = useState<Counterfactual | null>(null);
  const [audit, setAudit] = useState<AgencyAudit | null>(null);
  const [dimension, setDimension] = useState<PersonalityDimension>("fears");
  const [trait, setTrait] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [people, allScenes] = await Promise.all([repo.listCharacters(), repo.listScenes()]);
    setCharacters(people.map((entry) => ({ id: entry.id as string, name: entry.name })));
    setScenes(allScenes.map((entry) => ({ id: entry.id as string, title: entry.title })));
    if (characterId === "" && people[0] !== undefined) setCharacterId(people[0].id as string);
    if (sceneId === "" && allScenes[0] !== undefined) setSceneId(allScenes[0].id as string);
  }, [repo, characterId, sceneId]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const refreshSnapshot = useCallback(async () => {
    if (characterId === "" || sceneId === "") return;
    try {
      setSnapshot(await snapshotAt(repo, characterId, sceneId));
      setError(null);
    } catch (cause) {
      setSnapshot(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [repo, characterId, sceneId]);

  useEffect(() => {
    void refreshSnapshot();
  }, [refreshSnapshot, refreshToken]);

  async function run(what: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await what();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const name = (id: string) => characters.find((entry) => entry.id === id)?.name ?? id;

  return (
    <div className="agent">
      <div className="agent__ask">
        <div className="state__toggle">
          <select
            value={characterId}
            disabled={busy}
            aria-label="Character"
            onChange={(event) => {
              setCharacterId(event.target.value);
              setTest(null);
              setInstead(null);
              setAudit(null);
            }}
          >
            {characters.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          <select
            value={sceneId}
            disabled={busy}
            aria-label="Scene"
            onChange={(event) => {
              setSceneId(event.target.value);
              setTest(null);
              setInstead(null);
            }}
          >
            {scenes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
              </option>
            ))}
          </select>
        </div>
        <p className="hint">
          Everything below is this character as the project records them <strong>entering</strong>{" "}
          this scene. They are not given anything from later in the book, and not given a fact they
          have not been told.
        </p>
      </div>

      {error !== null && <p className="status status--error">{error}</p>}

      {snapshot !== null && (
        <section className="agent__section">
          <h3>
            {snapshot.name} entering {snapshot.sceneTitle}{" "}
            <span className="agent__count">scene {snapshot.position}</span>
          </h3>

          <dl className="specialist__facts">
            <dt>State</dt>
            <dd>
              {snapshot.physical.status}, {snapshot.physical.presence}
              {snapshot.physical.locationName === undefined
                ? ""
                : ` at ${snapshot.physical.locationName}`}
            </dd>
            <dt>Knows</dt>
            <dd>
              {snapshot.knowledge.length === 0
                ? "nothing recorded"
                : `${String(snapshot.knowledge.length)} thing(s)`}
              {snapshot.notKnownCount > 0 && (
                <span className="ctx__why">
                  {snapshot.notKnownCount} established proposition(s) they do not hold — withheld
                  from the simulation
                </span>
              )}
            </dd>
            <dt>Wants</dt>
            <dd>
              {snapshot.profile.goals.length === 0
                ? "nothing recorded"
                : snapshot.profile.goals.join("; ")}
            </dd>
          </dl>

          {snapshot.personality.length > 0 && (
            <>
              <h4 className="agent__label">Confirmed personality</h4>
              <ul className="state__knowledge">
                {snapshot.personality.map((entry) => (
                  <li key={entry.id}>
                    <span className="ctx__id">{entry.dimension.replace(/_/g, " ")}</span>{" "}
                    {entry.statement}
                  </li>
                ))}
              </ul>
            </>
          )}

          {snapshot.pressures.length > 0 && (
            <>
              <h4 className="agent__label">What is pressing on them</h4>
              <ul className="state__knowledge">
                {snapshot.pressures.map((entry) => (
                  <li key={entry.statement}>
                    {entry.statement}
                    <span className="ctx__why">{entry.basis}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {snapshot.relationships.length > 0 && (
            <>
              <h4 className="agent__label">Who people are to them, here</h4>
              <ul className="state__knowledge">
                {snapshot.relationships.map((entry) => (
                  <li key={entry.relationshipId}>
                    <button
                      className="btn btn--ghost btn--small"
                      onClick={() => onSelectEntity(entry.withId)}
                    >
                      {entry.withName}
                    </button>
                    {entry.type}
                    {entry.status === "" ? "" : ` — ${entry.status}`}
                  </li>
                ))}
              </ul>
            </>
          )}

          {snapshot.notRecorded.length > 0 && (
            <p className="hint">
              <strong>Not recorded:</strong> {snapshot.notRecorded.join("; ")}.
            </p>
          )}

          <div className="state__toggle">
            <select
              value={dimension}
              disabled={busy}
              aria-label="Personality dimension"
              onChange={(event) => setDimension(event.target.value as PersonalityDimension)}
            >
              {PERSONALITY_DIMENSIONS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <input
              value={trait}
              placeholder="will not leave someone behind, ever"
              disabled={busy}
              aria-label="Trait"
              onChange={(event) => setTrait(event.target.value)}
            />
            <button
              className="btn btn--small"
              disabled={busy || trait.trim() === ""}
              onClick={() =>
                void run(async () => {
                  await repo.personalities.add({
                    characterId,
                    dimension,
                    statement: trait.trim(),
                  });
                  setTrait("");
                  await refreshSnapshot();
                  onChanged();
                })
              }
            >
              Confirm trait
            </button>
          </div>
        </section>
      )}

      <section className="agent__section">
        <h3>Would they do this?</h3>
        <div className="field">
          <span>Proposed action</span>
          <textarea
            rows={2}
            value={action}
            placeholder="Mara enters the house alone."
            disabled={busy}
            onChange={(event) => setAction(event.target.value)}
          />
        </div>
        <div className="agent__actions">
          <button
            className="btn btn--primary btn--small"
            disabled={busy || action.trim() === "" || snapshot === null}
            onClick={() =>
              void run(async () => {
                const analyst = await createCharacterAnalyst(secrets);
                setInstead(null);
                setTest(
                  await testBehaviour(
                    repo,
                    { characterId, sceneId, proposedAction: action.trim() },
                    { analyst },
                  ),
                );
              })
            }
          >
            {busy ? "Working…" : "Test this"}
          </button>
          <button
            className="btn btn--small"
            disabled={busy || action.trim() === "" || snapshot === null}
            onClick={() =>
              void run(async () => {
                const analyst = await createCharacterAnalyst(secrets);
                setInstead(
                  await whatWouldTheyDo(
                    repo,
                    { characterId, sceneId, proposedAction: action.trim() },
                    { analyst },
                  ),
                );
              })
            }
          >
            What would they do instead?
          </button>
        </div>
      </section>

      {test !== null && (
        <>
          {test.contradictions.filter((entry) => entry.kind === "hard").length > 0 && (
            <section className="agent__section">
              <h3>Potential contradiction</h3>
              <ul className="agent__findings">
                {test.contradictions
                  .filter((entry) => entry.kind === "hard")
                  .map((entry) => (
                    <li key={entry.statement} className="ctx--warning">
                      <span>{entry.statement}</span>
                      {entry.detail !== undefined && (
                        <span className="ctx__why">{entry.detail}</span>
                      )}
                      <span className="agent__sources">from the project</span>
                    </li>
                  ))}
              </ul>
            </section>
          )}

          <section className="agent__section">
            <h3>
              Model judgement{" "}
              {test.judgement !== undefined && (
                <span className="agent__count">{describePlausibility(test.judgement.band)}</span>
              )}
            </h3>
            {test.judgement === undefined ? (
              <p className="agent__empty">
                Nothing weighed the action against who this character is — no model is configured.
                The findings above are what the project records.
              </p>
            ) : (
              <>
                <p className="agent__summary">{test.judgement.statement}</p>
                <p className="agent__interpretation">{test.judgement.reasoning}</p>
                {test.judgement.uncertainty.length > 0 && (
                  <>
                    <h4 className="agent__label">What would change this</h4>
                    <ul className="agent__uncertainties">
                      {test.judgement.uncertainty.map((entry) => (
                        <li key={entry}>{entry}</li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="hint">
                  A reading by {test.judgement.modelId}, not a measurement. {test.counts.supporting}{" "}
                  factor(s) for, {test.counts.opposing} against — counts, not a score.
                </p>
              </>
            )}
          </section>

          {(test.supporting.length > 0 || test.opposing.length > 0) && (
            <section className="agent__section">
              <h4 className="agent__label">Factors supporting</h4>
              <ul className="agent__findings">
                {test.supporting.map((entry) => (
                  <li key={entry.statement}>
                    <span>{entry.statement}</span>
                    <span className="agent__sources">{entry.source}</span>
                  </li>
                ))}
              </ul>
              <h4 className="agent__label agent__label--inference">Factors opposing</h4>
              <ul className="agent__uncertainties">
                {test.opposing.map((entry) => (
                  <li key={entry.statement}>{entry.statement}</li>
                ))}
              </ul>
            </section>
          )}

          {test.conditions.length > 0 && (
            <section className="agent__section">
              <h3>What would make it more plausible</h3>
              <ul className="agent__findings">
                {test.conditions.map((entry) => (
                  <li key={entry.statement}>
                    <span>{entry.statement}</span>
                    {entry.rationale !== undefined && (
                      <span className="ctx__why">{entry.rationale}</span>
                    )}
                    {entry.cost !== undefined && (
                      <span className="agent__sources">Costs: {entry.cost}</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="hint">Options for you. Nothing here has been applied.</p>
            </section>
          )}

          <section className="agent__section">
            <h3>
              Relevant established factors{" "}
              <span className="agent__count">{test.established.length}</span>
            </h3>
            <ul className="state__knowledge">
              {test.established.map((entry) => (
                <li key={`${entry.source}-${entry.statement}`}>
                  {entry.statement}
                  <span className="ctx__why">{entry.source}</span>
                </li>
              ))}
            </ul>
            <p className="hint">
              {test.basis}
              {test.notChecked.length > 0 && (
                <>
                  {" "}
                  <strong>Not checked:</strong> {test.notChecked.join("; ")}.
                </>
              )}
            </p>
          </section>
        </>
      )}

      {instead !== null && (
        <section className="agent__section">
          <h3>What they would do instead</h3>
          {instead.alternatives.length === 0 ? (
            <p className="agent__empty">{instead.caveat}</p>
          ) : (
            <>
              <ul className="agent__findings">
                {instead.alternatives.map((entry) => (
                  <li key={entry.action}>
                    <span>
                      <span className="badge">{describePlausibility(entry.band)}</span>{" "}
                      {entry.action}
                    </span>
                    <span className="ctx__why">{entry.because}</span>
                  </li>
                ))}
              </ul>
              <p className="hint">{instead.caveat}</p>
            </>
          )}
        </section>
      )}

      <section className="agent__section">
        <h3>Agency audit</h3>
        <p className="hint">
          Where does this character act because the story needs them to, rather than because they
          want something?
        </p>
        <button
          className="btn btn--small"
          disabled={busy || characterId === ""}
          onClick={() =>
            void run(async () => {
              const analyst = await createCharacterAnalyst(secrets);
              setAudit(await auditAgency(repo, characterId, { analyst }));
            })
          }
        >
          Audit {name(characterId)}
        </button>

        {audit !== null && (
          <>
            {audit.findings.length === 0 ? (
              <p className="status status--ok">
                Nothing found across {audit.scenesInspected} scene(s).
              </p>
            ) : (
              <ul className="agent__findings">
                {audit.findings.map((finding) => (
                  <li key={`${finding.sceneId}-${finding.statement}`}>
                    <span>
                      <span className={`badge badge--${finding.derivation}`}>
                        {finding.derivation === "model" ? "reading" : "from the project"}
                      </span>{" "}
                      {finding.statement}
                    </span>
                    {finding.detail !== undefined && (
                      <span className="ctx__why">{finding.detail}</span>
                    )}
                    {finding.sceneId !== "" && (
                      <span className="agent__sources">
                        <button
                          className="btn btn--ghost btn--small"
                          onClick={() => onOpenScene(finding.sceneId)}
                        >
                          {finding.sceneId}
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="hint">
              {audit.caveat}
              {audit.notChecked.length > 0 && (
                <>
                  {" "}
                  <strong>Not checked:</strong> {audit.notChecked.join("; ")}.
                </>
              )}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
