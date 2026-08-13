import { useCallback, useEffect, useState } from "react";
import type { ExtensionRecord, ExtensionValue } from "@jellytind/domain";
import { renderValue } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  GenreRuntime,
  moduleById,
  type ExtensionField,
  type ExtensionKind,
} from "@jellytind/genre";

interface Props {
  repo: StoryRepository;
  refreshToken: number;
  onChanged: () => void;
  onSelectEntity: (id: string) => void;
}

/**
 * Everything the enabled modules record, in one panel.
 *
 * Deliberately **one** panel rather than one per genre. Ten fantasy record
 * types, six thriller ones and two screenplay ones would be eighteen entries in
 * a sidebar that already has twenty — and the brief is explicit that the
 * workspace must not become a cluttered collection of every possible tool.
 *
 * The form is generated from the kind's declared schema, which is the payoff
 * for having declared it: a module adds a record type and gets an editor,
 * validation and a place in the build with no interface code at all
 * (docs/GENRE_MODULES.md).
 */
export function WorldPanel({ repo, refreshToken, onChanged, onSelectEntity }: Props) {
  const [kinds, setKinds] = useState<readonly ExtensionKind[]>([]);
  const [kindId, setKindId] = useState("");
  const [records, setRecords] = useState<readonly ExtensionRecord[]>([]);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [attach, setAttach] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const runtime = GenreRuntime.attach(repo);
    const available = await runtime.availableKinds();
    setKinds(available);

    const chosen = available.some((kind) => kind.id === kindId) ? kindId : (available[0]?.id ?? "");
    if (chosen !== kindId) setKindId(chosen);

    setRecords(
      (await runtime.visibleRecords()).filter((record) => chosen === "" || record.kind === chosen),
    );
    setNames(new Map((await repo.listEntitySummaries()).map((entry) => [entry.id, entry.name])));
  }, [repo, kindId]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const kind = kinds.find((entry) => entry.id === kindId);

  async function run(what: (runtime: GenreRuntime) => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await what(GenreRuntime.attach(repo));
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  /** Draft values, turned into what the record wants: lists split on commas. */
  function fieldsFrom(definition: ExtensionKind): Record<string, ExtensionValue> {
    const out: Record<string, ExtensionValue> = {};
    for (const field of definition.fields) {
      const raw = (draft[field.key] ?? "").trim();
      if (raw === "") continue;
      out[field.key] =
        field.type === "list"
          ? raw
              .split(",")
              .map((part) => part.trim())
              .filter((part) => part !== "")
          : raw;
    }
    return out;
  }

  const label = (id: string) => names.get(id) ?? id;

  if (kinds.length === 0) {
    return (
      <div className="agent">
        <p className="agent__empty">
          No genre module with records is switched on. Open <strong>Modules</strong> to add one.
        </p>
      </div>
    );
  }

  return (
    <div className="agent">
      <div className="agent__ask">
        <div className="state__toggle">
          <select
            value={kindId}
            disabled={busy}
            aria-label="Record kind"
            onChange={(event) => {
              setKindId(event.target.value);
              setDraft({});
              setName("");
              setAttach("");
            }}
          >
            {kinds.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.plural} — {moduleById(entry.moduleId).name}
              </option>
            ))}
          </select>
        </div>
        {kind !== undefined && <p className="hint">{kind.description}</p>}
      </div>

      {error !== null && <p className="status status--error">{error}</p>}

      {kind !== undefined && (
        <section className="agent__section">
          <h3>
            {kind.plural} <span className="agent__count">{records.length}</span>
          </h3>

          {records.length === 0 ? (
            <p className="agent__empty">None recorded yet.</p>
          ) : (
            <ul className="agent__findings">
              {records.map((record) => (
                <li key={record.id as string}>
                  <span>{record.name}</span>
                  {record.summary !== undefined && (
                    <span className="ctx__why">{record.summary}</span>
                  )}
                  {kind.fields
                    .filter((field) => record.fields[field.key] !== undefined)
                    .map((field) => (
                      <span key={field.key} className="ctx__why">
                        {field.label}:{" "}
                        {field.type === "entity"
                          ? label(String(record.fields[field.key]))
                          : renderValue(record.fields[field.key] ?? "")}
                      </span>
                    ))}
                  {record.attachedTo.length > 0 && (
                    <span className="agent__sources">
                      {record.attachedTo.map((id) => (
                        <button
                          key={id as string}
                          className="btn btn--ghost btn--small"
                          onClick={() => onSelectEntity(id as string)}
                        >
                          {label(id as string)}
                        </button>
                      ))}
                    </span>
                  )}
                  <span className="agent__sources">
                    <button
                      className="btn btn--ghost btn--small"
                      disabled={busy}
                      onClick={() =>
                        void run((runtime) =>
                          runtime
                            .findRecord(record.id as string)
                            .then(() =>
                              repo.extensions.remove(record.moduleId, record.id as string),
                            ),
                        )
                      }
                    >
                      Delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {kind !== undefined && (
        <section className="agent__section">
          <h3>Add a {kind.label.toLowerCase()}</h3>
          <div className="field">
            <span>Name</span>
            <input
              value={name}
              disabled={busy}
              aria-label="Name"
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          {kind.fields.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              value={draft[field.key] ?? ""}
              disabled={busy}
              onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))}
            />
          ))}

          {kind.attachesTo.length > 0 && (
            <div className="field">
              <span>Attach to ({kind.attachesTo.join(" or ")})</span>
              <input
                value={attach}
                placeholder="LOC_0001"
                disabled={busy}
                aria-label="Attach to"
                onChange={(event) => setAttach(event.target.value)}
              />
            </div>
          )}

          <button
            className="btn btn--primary btn--small"
            disabled={busy || name.trim() === ""}
            onClick={() =>
              void run(async (runtime) => {
                await runtime.addRecord({
                  kind: kind.id,
                  name: name.trim(),
                  fields: fieldsFrom(kind),
                  ...(attach.trim() === "" ? {} : { attachedTo: [attach.trim()] as never }),
                });
                setName("");
                setDraft({});
                setAttach("");
              })
            }
          >
            Add
          </button>
          <p className="hint">
            Checked against the schema {moduleById(kind.moduleId).name} declared. A field it never
            declared, a choice outside its list, or an attachment to the wrong kind of thing is
            refused by name rather than stored.
          </p>
        </section>
      )}
    </div>
  );
}

/** One input, generated from the field's declared type. */
function FieldInput({
  field,
  value,
  disabled,
  onChange,
}: {
  field: ExtensionField;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const caption = `${field.label}${field.required === true ? " *" : ""}`;

  return (
    <div className="field">
      <span>
        {caption}
        {field.description !== undefined && <span className="ctx__why">{field.description}</span>}
        {field.type === "list" && <span className="ctx__why">Separate with commas.</span>}
      </span>
      {field.type === "choice" ? (
        <select
          value={value}
          disabled={disabled}
          aria-label={field.label}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">—</option>
          {(field.choices ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.type === "long_text" ? (
        <textarea
          rows={2}
          value={value}
          disabled={disabled}
          aria-label={field.label}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          value={value}
          disabled={disabled}
          aria-label={field.label}
          placeholder={field.type === "entity" ? `${String(field.entityKind)} ID` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}
