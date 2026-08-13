import { useCallback, useEffect, useState } from "react";
import type { Character, CharacterVoiceExample, VoiceAttribute } from "@jellytind/domain";
import { VOICE_ATTRIBUTES, describeBand, statedAttributes } from "@jellytind/domain";
import {
  checkCharacterVoice,
  compareVoices,
  representativeLines,
  type CharacterVoiceCheck,
  type StoryRepository,
  type VoiceSimilarity,
} from "@jellytind/story-repository";

interface Props {
  repo: StoryRepository;
  refreshToken: number;
  onChanged: () => void;
}

/**
 * Character voices: how each person in the book speaks, recorded rather than
 * described.
 *
 * Everything here is deterministic and needs no model — the numbers are counts
 * of the lines the writer attached, and the panel says so plainly rather than
 * implying it has measured the character.
 */
export function CharacterVoiceSection({ repo, refreshToken, onChanged }: Props) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [examples, setExamples] = useState<CharacterVoiceExample[]>([]);
  const [attributes, setAttributes] = useState<Partial<Record<VoiceAttribute, string>>>({});
  const [attribute, setAttribute] = useState<VoiceAttribute>("directness");
  const [value, setValue] = useState("");
  const [line, setLine] = useState("");
  const [passage, setPassage] = useState("");
  const [check, setCheck] = useState<CharacterVoiceCheck | null>(null);
  const [compareTo, setCompareTo] = useState<string>("");
  const [similarity, setSimilarity] = useState<VoiceSimilarity | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const all = await repo.listCharacters();
    setCharacters(all);
    const id = selected !== "" ? selected : (all[0]?.id ?? "");
    if (id === "") return;
    if (selected === "") setSelected(id);
    setExamples(await repo.characterVoices.listExamples(id));
    const profile = await repo.characterVoices.getProfile(id);
    const next: Partial<Record<VoiceAttribute, string>> = {};
    for (const key of statedAttributes(profile?.attributes ?? {})) {
      next[key] = profile?.attributes[key]?.value ?? "";
    }
    setAttributes(next);
  }, [repo, selected]);

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

  const name = (id: string) => characters.find((c) => c.id === id)?.name ?? id;
  const stated = Object.entries(attributes).filter(([, v]) => v !== "");

  return (
    <>
      <section className="state__section">
        <h3>Character voices</h3>
        {characters.length === 0 ? (
          <p className="hint">No characters yet. Voices attach to the people who speak.</p>
        ) : (
          <div className="field">
            <span>Character</span>
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setCheck(null);
                setSimilarity(null);
              }}
            >
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {selected !== "" && (
          <>
            {stated.length === 0 ? (
              <p className="hint">
                Nothing recorded for {name(selected)} yet. Fill in only what you actually know — an
                empty field stays empty rather than becoming a default.
              </p>
            ) : (
              <ul className="state__knowledge">
                {stated.map(([key, v]) => (
                  <li key={key}>
                    <span className="ctx__id">{key.replace(/_/g, " ")}</span> {v}
                  </li>
                ))}
              </ul>
            )}

            <div className="state__toggle">
              <select
                value={attribute}
                onChange={(e) => setAttribute(e.target.value as VoiceAttribute)}
                aria-label="Attribute"
              >
                {VOICE_ATTRIBUTES.map((a) => (
                  <option key={a} value={a}>
                    {a.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <input
                value={value}
                placeholder="blunt to the point of rudeness"
                onChange={(e) => setValue(e.target.value)}
                aria-label="Value"
              />
              <button
                className="btn btn--small"
                disabled={busy || value.trim() === ""}
                onClick={() =>
                  void run(async () => {
                    await repo.characterVoices.setProfile(selected, {
                      attributes: { [attribute]: { value: value.trim() } },
                    });
                    setValue("");
                  })
                }
              >
                Set
              </button>
            </div>
          </>
        )}
      </section>

      {selected !== "" && (
        <section className="state__section">
          <h3>Lines {name(selected)} has said</h3>
          {examples.length === 0 ? (
            <p className="hint">
              No examples yet. These are what let Manu tell one voice from another — a description
              cannot do it.
            </p>
          ) : (
            <ul className="state__knowledge">
              {examples.map((example) => (
                <li key={example.id} className={example.representative ? "" : "dl--dropped"}>
                  &ldquo;{example.text}&rdquo;
                  <span className="ctx__why">
                    {example.sceneId ?? example.filePath ?? "no source recorded"}
                    {example.representative ? "" : " · counter-example"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="field">
            <span>Add a line</span>
            <input
              value={line}
              placeholder="That is not what I said."
              onChange={(e) => setLine(e.target.value)}
              disabled={busy}
            />
          </div>
          <button
            className="btn btn--small"
            disabled={busy || line.trim() === ""}
            onClick={() =>
              void run(async () => {
                await repo.characterVoices.addExample({ characterId: selected, text: line.trim() });
                setLine("");
              })
            }
          >
            Add example
          </button>
        </section>
      )}

      {selected !== "" && (
        <section className="state__section">
          <h3>Voice check</h3>
          <div className="field">
            <span>Dialogue to check against {name(selected)}</span>
            <textarea rows={3} value={passage} onChange={(e) => setPassage(e.target.value)} />
          </div>
          <button
            className="btn btn--small"
            disabled={busy || passage.trim() === ""}
            onClick={() =>
              void run(async () => {
                const profile = await repo.characterVoices.getProfile(selected);
                if (profile === null) return;
                const established = representativeLines(
                  await repo.characterVoices.listExamples(selected),
                  50,
                );
                setCheck(
                  checkCharacterVoice(
                    profile,
                    established,
                    passage.split("\n").filter((l) => l.trim() !== ""),
                    profile.attributes,
                  ),
                );
              })
            }
          >
            Check this dialogue
          </button>

          {check !== null && (
            <>
              {check.findings.length === 0 ? (
                <p className="status status--ok">
                  Nothing departs from the recorded lines. {check.basis}
                </p>
              ) : (
                <ul className="state__knowledge">
                  {check.findings.map((finding) => (
                    <li key={finding.metric} className="ctx--warning">
                      {finding.note}
                    </li>
                  ))}
                </ul>
              )}
              <p className="hint">
                {check.basis} These are counts of the recorded lines, not a verdict on the writing —
                a character may simply be having a different kind of night.
                {check.notMeasured.length > 0 && (
                  <>
                    {" "}
                    <strong>Not measured:</strong> {check.notMeasured.join("; ")}.
                  </>
                )}
              </p>
            </>
          )}
        </section>
      )}

      {characters.length > 1 && selected !== "" && (
        <section className="state__section">
          <h3>Do two characters sound the same?</h3>
          <div className="state__toggle">
            <select
              value={compareTo}
              onChange={(e) => setCompareTo(e.target.value)}
              aria-label="Compare with"
            >
              <option value="">Choose a character…</option>
              {characters
                .filter((c) => c.id !== selected)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <button
              className="btn btn--small"
              disabled={busy || compareTo === ""}
              onClick={() =>
                void run(async () => {
                  const [a, b] = await Promise.all([
                    repo.characterVoices.getProfile(selected),
                    repo.characterVoices.getProfile(compareTo),
                  ]);
                  if (a === null || b === null) return;
                  const [la, lb] = await Promise.all([
                    repo.characterVoices.listExamples(selected),
                    repo.characterVoices.listExamples(compareTo),
                  ]);
                  setSimilarity(
                    compareVoices(
                      { profile: a, lines: representativeLines(la, 50) },
                      { profile: b, lines: representativeLines(lb, 50) },
                    ),
                  );
                })
              }
            >
              Compare
            </button>
          </div>

          {similarity !== null && (
            <div className="state__card">
              <div className="state__card-head">
                <strong>
                  {name(similarity.aId)} ↔ {name(similarity.bId)}
                </strong>
                <span className="badge">{describeBand(similarity.band)}</span>
              </div>
              {similarity.sharedTendencies.length > 0 && (
                <>
                  <h4 className="agent__label">Shared tendencies</h4>
                  <ul className="state__knowledge">
                    {similarity.sharedTendencies.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </>
              )}
              {similarity.differences.length > 0 && (
                <>
                  <h4 className="agent__label">Where they differ</h4>
                  <ul className="state__knowledge">
                    {similarity.differences.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </>
              )}
              <p className="hint">
                {similarity.caveat} {similarity.basis}
                {similarity.notMeasured.length > 0 && (
                  <>
                    {" "}
                    <strong>Not measured:</strong> {similarity.notMeasured.join("; ")}.
                  </>
                )}
              </p>
            </div>
          )}
        </section>
      )}
    </>
  );
}
