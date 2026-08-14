import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Character, Relationship, Scene } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";

interface Props {
  repo: StoryRepository;
  /** The character to open, when something elsewhere selected one. */
  selectedId: string | null;
  onSelect: (id: string) => void;
  refreshToken: number;
}

interface Sheet {
  readonly character: Character;
  readonly appearances: readonly Scene[];
  readonly pov: readonly Scene[];
  readonly relationships: readonly { readonly other: string; readonly summary: string }[];
}

/**
 * A character, as a page rather than a record.
 *
 * This is what §13 means by "opening a Character beside the manuscript". The
 * data is the same data the Story bible holds; what changes is that it is laid
 * out to be read while writing a scene — who they are, what they want, who they
 * are to other people, and where they appear — instead of as a form with every
 * schema field present whether or not it has anything in it.
 *
 * **Progressive disclosure is the rule.** A field with nothing in it is not
 * shown. An empty "Aliases: —" row teaches a writer that Manu is a database
 * with a skin on it; leaving it out teaches them that Manu shows what is there.
 */
export function CharacterSheet({ repo, selectedId, onSelect, refreshToken }: Props) {
  const [cast, setCast] = useState<readonly Character[]>([]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void repo.listCharacters().then(setCast);
  }, [repo, refreshToken]);

  // Which character is on the page: the one selected elsewhere in the
  // workbench when that is a character, otherwise the first of the cast.
  const chosen =
    selectedId !== null && selectedId.startsWith("CHAR_")
      ? selectedId
      : ((cast[0]?.id as string | undefined) ?? null);

  const load = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        const character = cast.find((entry) => (entry.id as string) === id);
        if (character === undefined) {
          setSheet(null);
          return;
        }
        // The *recorded* relationships, not their state at a story moment: a
        // sheet read while writing wants "who is this person to whom", and the
        // moment-by-moment view is what the Relationships panel is for.
        const [appearances, pov, related] = await Promise.all([
          repo.getCharacterAppearances(character.id),
          repo.getScenesByPOV(character.id),
          repo.listRelationships(),
        ]);
        setSheet({
          character,
          appearances: appearances.scenes,
          pov,
          relationships: summarise(related, cast, character.id as string),
        });
      } finally {
        setLoading(false);
      }
    },
    [repo, cast],
  );

  useEffect(() => {
    if (chosen === null) setSheet(null);
    else void load(chosen);
  }, [chosen, load, refreshToken]);

  if (cast.length === 0) {
    return (
      <div className="empty empty--panel">
        <p className="empty__title">No characters yet</p>
        <p className="empty__body">
          Add someone in the Story bible and they will appear here, with the scenes they are in and
          what they know.
        </p>
      </div>
    );
  }

  return (
    <div className="sheet">
      <label className="sheet__pick">
        <span className="visually-hidden">Character</span>
        <select
          value={chosen ?? ""}
          onChange={(event) => onSelect(event.target.value)}
          aria-label="Character"
        >
          {cast.map((entry) => (
            <option key={entry.id} value={entry.id as string}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>

      {loading && sheet === null ? (
        <p className="placeholder">Reading…</p>
      ) : sheet === null ? (
        <p className="placeholder">Pick a character.</p>
      ) : (
        <article className="sheet__body">
          <header className="sheet__head">
            <h2 className="sheet__name">{sheet.character.name}</h2>
            {sheet.character.role.trim() !== "" && (
              <p className="sheet__role">{sheet.character.role}</p>
            )}
          </header>

          {sheet.character.aliases.length > 0 && (
            <p className="sheet__aliases">Also called {sheet.character.aliases.join(", ")}</p>
          )}

          {sheet.character.description.trim() !== "" && (
            <Section title="Description">
              <p className="sheet__prose">{sheet.character.description}</p>
            </Section>
          )}

          {sheet.character.goals.length > 0 && (
            <Section title="Wants">
              <ul className="sheet__list">
                {sheet.character.goals.map((goal, index) => (
                  <li key={index}>{goal}</li>
                ))}
              </ul>
            </Section>
          )}

          {sheet.relationships.length > 0 && (
            <Section title="Relationships">
              <ul className="sheet__list">
                {sheet.relationships.map((entry) => (
                  <li key={entry.other}>
                    <strong>{entry.other}</strong>
                    {entry.summary === "" ? "" : ` — ${entry.summary}`}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="In the book">
            <p className="sheet__facts">
              {sheet.appearances.length === 0
                ? "No scenes yet."
                : `${sheet.appearances.length} ${
                    sheet.appearances.length === 1 ? "scene" : "scenes"
                  }`}
              {sheet.pov.length > 0 && `, ${sheet.pov.length} of them from their point of view`}
            </p>
            {sheet.appearances.length > 0 && (
              <ul className="sheet__scenes">
                {sheet.appearances.slice(0, 12).map((scene) => (
                  <li key={scene.id}>{scene.title}</li>
                ))}
              </ul>
            )}
          </Section>
        </article>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sheet__section">
      <h3 className="sheet__section-title">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Turn relationship records into lines a person can read.
 *
 * The record names the other party by ID; a sheet names them by name. Anything
 * that cannot be resolved to a name is dropped rather than shown as
 * `CHAR_0004`, which is the whole principle of this phase applied to one line
 * of a list.
 */
function summarise(
  related: readonly Relationship[],
  cast: readonly Character[],
  self: string,
): readonly { other: string; summary: string }[] {
  const names = new Map(cast.map((entry) => [entry.id as string, entry.name]));
  const out: { other: string; summary: string }[] = [];
  for (const entry of related) {
    const a = entry.characterAId as string;
    const b = entry.characterBId as string;
    if (a !== self && b !== self) continue;
    const name = names.get(a === self ? b : a);
    if (name === undefined) continue;
    const summary = [entry.type, entry.status].filter((part) => part.trim() !== "").join(", ");
    out.push({ other: name, summary });
  }
  return out;
}
