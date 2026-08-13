import { useCallback, useEffect, useState } from "react";
import type { AuthorVoiceProfile, VoiceCategory, VoiceTendencyId } from "@jellytind/domain";
import { VOICE_CATEGORIES } from "@jellytind/domain";
import {
  checkVoiceRules,
  type StoryRepository,
  type VoiceCheckResult,
} from "@jellytind/story-repository";
import { CharacterVoiceSection } from "./CharacterVoiceSection";

interface Props {
  repo: StoryRepository;
  refreshToken: number;
  onChanged: () => void;
}

/**
 * The Voice Inspector.
 *
 * The writer must never have to wonder what Manu thinks their style is. Every
 * rule, every observation and the evidence under it is here, in the order it
 * would be handed to a model — and each observation can be confirmed, put in
 * the writer's own words, or thrown out.
 */
export function VoicePanel({ repo, refreshToken, onChanged }: Props) {
  const [profile, setProfile] = useState<AuthorVoiceProfile | null>(null);
  const [statement, setStatement] = useState("");
  const [kind, setKind] = useState<"prefer" | "avoid">("avoid");
  const [category, setCategory] = useState<VoiceCategory>("prose");
  const [pattern, setPattern] = useState("");
  const [passage, setPassage] = useState("");
  const [check, setCheck] = useState<VoiceCheckResult | null>(null);
  const [editing, setEditing] = useState<VoiceTendencyId | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setProfile(await repo.voice.load());
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  async function run(what: () => Promise<void>) {
    setBusy(true);
    try {
      await what();
      await reload();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (profile === null) return <p className="placeholder">Loading…</p>;

  const proposed = profile.tendencies.filter((t) => t.status === "proposed");
  const confirmed = profile.tendencies.filter((t) => t.status === "confirmed");
  const assessed = profile.samples.filter((s) => s.stance !== "unassessed");

  return (
    <div className="state">
      <section className="state__section">
        <h3>Your rules</h3>
        {profile.rules.length === 0 ? (
          <p className="hint">
            Nothing yet. A rule is something you would tell a copy-editor: &ldquo;avoid explaining
            dialogue subtext&rdquo;. Manu follows these exactly and never edits them.
          </p>
        ) : (
          <ul className="state__knowledge">
            {profile.rules.map((rule) => (
              <li key={rule.id} className={rule.enabled ? "" : "dl--dropped"}>
                <span className="badge">{rule.kind}</span> <strong>{rule.statement}</strong>{" "}
                <span className="ctx__why">
                  {rule.category}
                  {rule.scope !== "project" ? ` · ${rule.scope}` : ""}
                  {rule.pattern !== undefined ? " · checkable" : ""}
                </span>
                <div className="state__actions">
                  <button
                    className="btn btn--small"
                    disabled={busy}
                    onClick={() =>
                      void run(() => repo.voice.setRuleEnabled(rule.id, !rule.enabled))
                    }
                  >
                    {rule.enabled ? "Turn off" : "Turn on"}
                  </button>
                  <button
                    className="btn btn--small btn--danger"
                    disabled={busy}
                    onClick={() => void run(() => repo.voice.deleteRule(rule.id))}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="state__section">
        <h3>Add a rule</h3>
        <div className="field">
          <span>Rule</span>
          <input
            value={statement}
            placeholder="Avoid explaining dialogue subtext."
            onChange={(e) => setStatement(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="state__toggle">
          <select value={kind} onChange={(e) => setKind(e.target.value as "prefer" | "avoid")}>
            <option value="avoid">Avoid</option>
            <option value="prefer">Prefer</option>
          </select>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as VoiceCategory)}
            aria-label="Category"
          >
            {VOICE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span>Words to look for (optional)</span>
          <input
            value={pattern}
            placeholder="couldn't help but"
            onChange={(e) => setPattern(e.target.value)}
            disabled={busy}
          />
        </div>
        <p className="hint">
          A rule with words to look for can be checked exactly. Without them the rule still guides
          Manu, but no one can verify it mechanically — and Manu will say so rather than claim it
          passed.
        </p>
        <button
          className="btn btn--primary btn--small"
          disabled={busy || statement.trim() === ""}
          onClick={() =>
            void run(async () => {
              await repo.voice.addRule({
                kind,
                category,
                statement,
                ...(pattern.trim() !== "" ? { pattern: pattern.trim() } : {}),
              });
              setStatement("");
              setPattern("");
            })
          }
        >
          Add rule
        </button>
      </section>

      {proposed.length > 0 && (
        <section className="state__section">
          <h3>Observations awaiting you</h3>
          <p className="hint">
            Manu noticed these in passages you marked. They do not affect anything until you confirm
            them.
          </p>
          <ul className="state__transitions">
            {proposed.map((tendency) => (
              <li key={tendency.id} className="state__card ctx--proposed">
                <div className="state__card-head">
                  <span className="badge badge--agent">inferred</span>
                  <span className="ctx__id">{tendency.category}</span>
                </div>
                {editing === tendency.id ? (
                  <div className="field">
                    <span>In your words</span>
                    <input value={editText} onChange={(e) => setEditText(e.target.value)} />
                  </div>
                ) : (
                  <div>{tendency.statement}</div>
                )}
                <div className="ctx__why">Evidence: {tendency.evidence}</div>
                <div className="state__actions">
                  {editing === tendency.id ? (
                    <>
                      <button
                        className="btn btn--small btn--primary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await repo.voice.reviewTendency(tendency.id, "confirmed", editText);
                            setEditing(null);
                          })
                        }
                      >
                        Save and confirm
                      </button>
                      <button className="btn btn--small" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn btn--small btn--primary"
                        disabled={busy}
                        onClick={() =>
                          void run(() => repo.voice.reviewTendency(tendency.id, "confirmed"))
                        }
                      >
                        Confirm
                      </button>
                      <button
                        className="btn btn--small"
                        onClick={() => {
                          setEditing(tendency.id);
                          setEditText(tendency.statement);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn--small btn--danger"
                        disabled={busy}
                        onClick={() =>
                          void run(() => repo.voice.reviewTendency(tendency.id, "rejected"))
                        }
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="state__section">
        <h3>What Manu has learned</h3>
        {confirmed.length === 0 ? (
          <p className="hint">
            Nothing confirmed yet. Manu only uses observations you have agreed with — it will not
            act on a guess.
          </p>
        ) : (
          <ul className="state__knowledge">
            {confirmed.map((tendency) => (
              <li key={tendency.id}>
                <span className="badge badge--true">confirmed</span> {tendency.statement}{" "}
                <span className="ctx__why">
                  {tendency.category} · {tendency.evidence}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          Drawn from {assessed.length} passage(s) you assessed. Prose you have not marked is not
          treated as an example of how you want to write.
        </p>
      </section>

      <section className="state__section">
        <h3>Check a passage</h3>
        <div className="field">
          <span>Paste prose</span>
          <textarea
            rows={4}
            value={passage}
            onChange={(e) => setPassage(e.target.value)}
            placeholder="She couldn't help but smile."
          />
        </div>
        <button
          className="btn btn--small"
          disabled={passage.trim() === ""}
          onClick={() => setCheck(checkVoiceRules(passage, profile.rules))}
        >
          Check against my rules
        </button>

        {check !== null && (
          <>
            {check.hits.length === 0 ? (
              <p className="status status--ok">
                Nothing matched the rules that can be checked mechanically.
              </p>
            ) : (
              <ul className="state__knowledge">
                {check.hits.map((hit) => (
                  <li key={hit.ruleId} className="ctx--warning">
                    <strong>{hit.statement}</strong>
                    {hit.occurrences.map((occurrence) => (
                      <div key={occurrence.index} className="ctx__why">
                        …{occurrence.excerpt}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            )}
            <p className="hint">
              Checked {check.checked.length} rule(s).
              {check.notChecked.length > 0 && (
                <>
                  {" "}
                  <strong>Not checked ({check.notChecked.length}):</strong>{" "}
                  {check.notChecked.join("; ")} — these need a reading, not a search, so Manu will
                  not claim they passed.
                </>
              )}
            </p>
          </>
        )}
      </section>
      <CharacterVoiceSection repo={repo} refreshToken={refreshToken} onChanged={onChanged} />
    </div>
  );
}
