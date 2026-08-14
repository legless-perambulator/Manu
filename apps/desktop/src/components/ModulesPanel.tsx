import { useCallback, useEffect, useState } from "react";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  MODULES,
  TEMPLATES,
  GenreRuntime,
  type DisableImpact,
  type GenreModule,
} from "@jellytind/genre";

interface Props {
  repo: StoryRepository;
  refreshToken: number;
  onChanged: () => void;
}

/**
 * Which genre modules this project uses.
 *
 * The one screen where the framework is visible as a framework, and the one
 * place a writer can be reassured about the thing that matters: switching a
 * module off hides its panels and stops its checks, and does not touch a word
 * of what they wrote. The impact is stated before the switch, not after
 * (docs/GENRE_MODULES.md).
 */
export function ModulesPanel({ repo, refreshToken, onChanged }: Props) {
  const [enabled, setEnabled] = useState<readonly string[]>([]);
  const [template, setTemplate] = useState<string | undefined>(undefined);
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({});
  const [confirming, setConfirming] = useState<DisableImpact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const runtime = GenreRuntime.attach(repo);
    const settings = await repo.modules.read();
    setEnabled(settings.enabled);
    setTemplate(settings.template);

    const tally: Record<string, number> = {};
    for (const module of MODULES) {
      tally[module.id] = (await repo.extensions.list(module.id)).length;
    }
    setCounts(tally);
    return runtime;
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

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

  const isOn = (module: GenreModule) => enabled.includes(module.id);

  return (
    <div className="agent">
      <div className="agent__ask">
        <h3>Genre modules</h3>
        <p className="hint">
          Modules extend the story domain; they never replace it. The manuscript, the timeline, the
          knowledge model and the version history are the same underneath every one of them —
          switching a module off changes what Manu shows you, never what your project contains.
        </p>
        {template !== undefined && (
          <p className="hint">
            Created from the{" "}
            <strong>{TEMPLATES.find((t) => t.id === template)?.name ?? template}</strong> template.
            That is a note about how it started, not a type it is stuck with.
          </p>
        )}
      </div>

      {error !== null && <p className="status status--error">{error}</p>}

      {confirming !== null && (
        <section className="agent__section modules__confirm">
          <h3>Switch off {MODULES.find((m) => m.id === confirming.moduleId)?.name}?</h3>
          <ul className="state__knowledge">
            <li>
              {confirming.recordsHidden === 0
                ? "No records to hide."
                : `${confirming.recordsHidden} record(s) stop being shown. None are deleted.`}
            </li>
            {confirming.viewsHidden.length > 0 && (
              <li>Panels hidden: {confirming.viewsHidden.join(", ")}</li>
            )}
            {confirming.rulesStopped.length > 0 && (
              <li>Build checks that stop running: {confirming.rulesStopped.join(", ")}</li>
            )}
            {confirming.commandsWithdrawn.length > 0 && (
              <li>Commands withdrawn: {confirming.commandsWithdrawn.join(", ")}</li>
            )}
            {confirming.testsKept > 0 && (
              <li>
                {confirming.testsKept} story test(s) you adopted <strong>keep running</strong>. They
                are yours now.
              </li>
            )}
          </ul>
          <p className="status status--ok">
            Reversible. Switching it back on restores everything exactly as you left it.
          </p>
          <div className="agent__actions">
            <button
              className="btn btn--primary btn--small"
              disabled={busy}
              onClick={() => {
                const target = confirming.moduleId;
                setConfirming(null);
                void run((runtime) => runtime.disable(target).then(() => undefined));
              }}
            >
              Switch it off
            </button>
            <button className="btn btn--small" disabled={busy} onClick={() => setConfirming(null)}>
              Keep it
            </button>
          </div>
        </section>
      )}

      <section className="agent__section">
        <ul className="modules__list">
          {MODULES.map((module) => (
            <li
              key={module.id}
              className={isOn(module) ? "modules__item modules__item--on" : "modules__item"}
            >
              <div className="modules__head">
                <span className="modules__name">
                  {module.name}
                  {isOn(module) && <span className="badge badge--created">on</span>}
                  {/*
                    How far the module actually goes, before the writer builds a
                    book on it. A shape and a working engine should not look the
                    same in a list (MANU-036).
                  */}
                  <span className={`badge badge--${module.maturity}`}>
                    {module.maturity === "engine" ? "dedicated engine" : "records and checks"}
                  </span>
                </span>
                <button
                  className={isOn(module) ? "btn btn--small" : "btn btn--primary btn--small"}
                  disabled={busy}
                  onClick={() => {
                    if (!isOn(module)) {
                      void run((runtime) => runtime.enable(module.id));
                      return;
                    }
                    void run(async (runtime) => {
                      setConfirming(await runtime.impactOfDisabling(module.id));
                    });
                  }}
                >
                  {isOn(module) ? "Switch off" : "Switch on"}
                </button>
              </div>
              <p className="modules__summary">{module.summary}</p>
              <p className="ctx__why">{module.description}</p>

              <dl className="specialist__facts">
                {module.extensionKinds.length > 0 && (
                  <>
                    <dt>Records</dt>
                    <dd>{module.extensionKinds.map((kind) => kind.plural).join(", ")}</dd>
                  </>
                )}
                {module.rules.length > 0 && (
                  <>
                    <dt>Build checks</dt>
                    <dd>{module.rules.map((rule) => rule.name).join(", ")}</dd>
                  </>
                )}
                {module.commands.length > 0 && (
                  <>
                    <dt>Commands</dt>
                    <dd>{module.commands.map((command) => command.command).join(", ")}</dd>
                  </>
                )}
                {module.views.length > 0 && (
                  <>
                    <dt>Panels</dt>
                    <dd>{module.views.map((view) => view.label).join(", ")}</dd>
                  </>
                )}
                {(counts[module.id] ?? 0) > 0 && (
                  <>
                    <dt>In this project</dt>
                    <dd>
                      {counts[module.id]} record(s)
                      {!isOn(module) && (
                        <span className="ctx__why">kept, and waiting for you to switch it on</span>
                      )}
                    </dd>
                  </>
                )}
              </dl>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
