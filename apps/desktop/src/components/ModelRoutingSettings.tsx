import { useMemo, useState } from "react";
import {
  OPERATION_REQUIREMENTS,
  ROUTED_OPERATIONS,
  ROUTING_POLICIES,
  ROUTING_POLICY_IDS,
  profileKey,
  type ModelProfile,
  type RoutedOperation,
  type RoutingPolicyId,
} from "@jellytind/model-router";
import { loadAiSettings, type AiSettings } from "../lib/connections";
import {
  loadRoutingSettings,
  modelPlanFor,
  routingProfiles,
  saveRoutingSettings,
  type RoutingSettings,
} from "../lib/routing";

/**
 * Settings → Model routing (Phase 36 §27).
 *
 * The basic decision is one choice: the routing policy. Everything else —
 * privacy rules, budgets, pricing, per-operation pins — lives behind the
 * advanced disclosure, so a writer who wants "good models, don't waste my
 * money" makes one click, and a writer who wants fine-grained control gets
 * it without a config file.
 *
 * The plan table below the controls is the live answer to "which model will
 * do what": the same pure routing decision the workflows will make, shown
 * before anything runs (§20, §28).
 */

/** Operations shown in the plan preview: one per distinct kind of work. */
const PREVIEW_OPERATIONS: readonly RoutedOperation[] = [
  "story_architecture",
  "chapter_planning",
  "scene_drafting",
  "manuscript_edit",
  "state_extraction",
  "coverage_check",
  "diagnosis",
  "reader_simulation",
  "research",
  "summarisation",
];

export function ModelRoutingSettings() {
  const [settings, setSettings] = useState<RoutingSettings>(() => loadRoutingSettings());
  const [advanced, setAdvanced] = useState(false);
  const ai = useMemo<AiSettings>(() => loadAiSettings(), []);
  const profiles = useMemo(() => routingProfiles(ai, settings), [ai, settings]);
  const plan = useMemo(
    () => modelPlanFor(PREVIEW_OPERATIONS, { ai, routing: settings }),
    [ai, settings],
  );

  const commit = (next: RoutingSettings) => {
    setSettings(next);
    saveRoutingSettings(next);
  };

  const cloudProviders = useMemo(
    () => [...new Set(profiles.filter((p) => !p.local).map((p) => p.providerId))].sort(),
    [profiles],
  );

  const prose = (providerId: string): boolean =>
    settings.privacy.rules.some(
      (rule) =>
        (rule.providerId === providerId || rule.providerId === "*") &&
        (rule.forbid.includes("manuscript_prose") || rule.forbid.includes("*")),
    );

  const toggleProse = (providerId: string) => {
    const rules = prose(providerId)
      ? settings.privacy.rules.filter(
          (rule) => !(rule.providerId === providerId && rule.forbid.includes("manuscript_prose")),
        )
      : [...settings.privacy.rules, { providerId, forbid: ["manuscript_prose" as const] }];
    commit({ ...settings, privacy: { ...settings.privacy, rules } });
  };

  return (
    <section className="routing">
      <h3>Model routing</h3>
      <p className="hint">
        How Manu chooses which configured model does which kind of work. Your assignments above are
        always respected; the policy decides everything they leave open.
      </p>

      <fieldset className="routing__policies">
        <legend>Policy</legend>
        {ROUTING_POLICY_IDS.map((id: RoutingPolicyId) => (
          <label key={id} className="routing__policy">
            <input
              type="radio"
              name="routing-policy"
              checked={settings.policyId === id}
              onChange={() => commit({ ...settings, policyId: id })}
            />
            <span>
              <strong>{ROUTING_POLICIES[id].label}</strong>
              <span className="routing__hint">{ROUTING_POLICIES[id].summary}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        className="btn btn--ghost btn--small"
        onClick={() => setAdvanced((held) => !held)}
      >
        {advanced ? "Hide advanced routing" : "Advanced routing…"}
      </button>

      {advanced && (
        <div className="routing__advanced">
          <h4>Privacy</h4>
          <label className="routing__row">
            <input
              type="checkbox"
              checked={settings.privacy.mode === "local_only"}
              onChange={(event) =>
                commit({
                  ...settings,
                  privacy: {
                    ...settings.privacy,
                    mode: event.target.checked ? "local_only" : "allow_cloud",
                  },
                })
              }
            />
            <span>
              Local only — nothing is ever sent to a cloud provider. Work that no local model can do
              is refused, with the reason stated.
            </span>
          </label>
          {settings.privacy.mode === "allow_cloud" && cloudProviders.length > 0 && (
            <div className="routing__rules">
              <p className="hint">Never send manuscript prose to:</p>
              {cloudProviders.map((providerId) => (
                <label key={providerId} className="routing__row">
                  <input
                    type="checkbox"
                    checked={prose(providerId)}
                    onChange={() => toggleProse(providerId)}
                  />
                  <span>{providerId}</span>
                </label>
              ))}
              <p className="hint">
                A restriction is never routed around — if it leaves no capable model, the operation
                is blocked and says why.
              </p>
            </div>
          )}

          <h4>Budgets</h4>
          <BudgetFields settings={settings} onChange={commit} />

          <h4>Pricing</h4>
          <p className="hint">
            Providers do not publish machine-readable prices, so Manu only knows what you enter
            here, per million tokens. Models without pricing show "cost unavailable" — never an
            invented number.
          </p>
          <PricingTable profiles={profiles} settings={settings} onChange={commit} />

          <h4>Pins</h4>
          <p className="hint">
            Pin a kind of work to one model and the policy leaves it alone. A pinned model that
            cannot do the work blocks the operation with the reason — it is never silently ignored.
          </p>
        </div>
      )}

      <h4>The plan</h4>
      <table className="routing__plan">
        <tbody>
          {plan.decisions.map((decision) => {
            const req = OPERATION_REQUIREMENTS[decision.operation];
            return (
              <tr key={decision.operation}>
                <th scope="row">{req.label}</th>
                <td>
                  {decision.selected !== undefined ? (
                    <>
                      <strong>{decision.selected.displayName}</strong>
                      <span className="routing__why"> {decision.reasons.join(" ")}</span>
                    </>
                  ) : (
                    <span className="routing__blocked">{decision.blocked}</span>
                  )}
                </td>
                {advanced && (
                  <td>
                    <select
                      aria-label={`Pin ${req.label}`}
                      value={settings.pins[decision.operation] ?? ""}
                      onChange={(event) => {
                        const pins = { ...settings.pins };
                        if (event.target.value === "") delete pins[decision.operation];
                        else pins[decision.operation] = event.target.value;
                        commit({ ...settings, pins });
                      }}
                    >
                      <option value="">Routed by policy</option>
                      {profiles.map((profile) => (
                        <option key={profileKey(profile)} value={profileKey(profile)}>
                          Pin: {profile.displayName}
                        </option>
                      ))}
                    </select>
                  </td>
                )}
              </tr>
            );
          })}
          {ROUTED_OPERATIONS.length > PREVIEW_OPERATIONS.length && (
            <tr>
              <td colSpan={advanced ? 3 : 2} className="hint">
                Related operations follow the same rules; these rows cover each kind of work once.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function BudgetFields({
  settings,
  onChange,
}: {
  settings: RoutingSettings;
  onChange: (next: RoutingSettings) => void;
}) {
  const budgets = settings.budgets;
  const patch = (changes: Partial<NonNullable<RoutingSettings["budgets"]>>) => {
    onChange({
      ...settings,
      budgets: { currency: budgets?.currency ?? "USD", ...budgets, ...changes },
    });
  };
  return (
    <div className="routing__budgets">
      <label className="field field--inline">
        <span>Currency</span>
        <input
          value={budgets?.currency ?? "USD"}
          maxLength={3}
          onChange={(event) => patch({ currency: event.target.value.toUpperCase() })}
        />
      </label>
      <label className="field field--inline">
        <span>Monthly limit</span>
        <input
          type="number"
          min={0}
          value={budgets?.projectMonthly?.amount ?? ""}
          onChange={(event) => {
            const amount = Number(event.target.value);
            if (event.target.value === "" || Number.isNaN(amount)) {
              const next = { ...budgets, currency: budgets?.currency ?? "USD" };
              delete next.projectMonthly;
              onChange({ ...settings, budgets: next });
            } else {
              patch({
                projectMonthly: { amount, hard: budgets?.projectMonthly?.hard ?? false },
              });
            }
          }}
        />
      </label>
      <label className="routing__row">
        <input
          type="checkbox"
          checked={budgets?.projectMonthly?.hard ?? false}
          disabled={budgets?.projectMonthly === undefined}
          onChange={(event) => {
            const held = budgets?.projectMonthly;
            if (held !== undefined) {
              patch({ projectMonthly: { ...held, hard: event.target.checked } });
            }
          }}
        />
        <span>Hard limit — block work that would pass it, never just warn</span>
      </label>
      <p className="hint">
        Limits are checked against actual recorded spend. Calls with unknown cost are counted and
        shown, not pretended to be free.
      </p>
    </div>
  );
}

function PricingTable({
  profiles,
  settings,
  onChange,
}: {
  profiles: readonly ModelProfile[];
  settings: RoutingSettings;
  onChange: (next: RoutingSettings) => void;
}) {
  if (profiles.length === 0) return <p className="hint">No models configured yet.</p>;
  const patch = (key: string, field: "inputPer1M" | "outputPer1M", value: string) => {
    const held = settings.pricing[key] ?? {};
    const amount = Number(value);
    const next = { ...held };
    if (value === "" || Number.isNaN(amount)) delete next[field];
    else next[field] = amount;
    const pricing = { ...settings.pricing };
    if (next.inputPer1M === undefined && next.outputPer1M === undefined) delete pricing[key];
    else pricing[key] = { currency: held.currency ?? "USD", ...next };
    onChange({ ...settings, pricing });
  };
  return (
    <table className="routing__pricing">
      <thead>
        <tr>
          <th>Model</th>
          <th>In / 1M</th>
          <th>Out / 1M</th>
        </tr>
      </thead>
      <tbody>
        {profiles.map((profile) => {
          const key = profileKey(profile);
          const held = settings.pricing[key];
          return (
            <tr key={key}>
              <th scope="row">
                {profile.displayName}
                {profile.local && <span className="hint"> (local — always 0)</span>}
              </th>
              <td>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  disabled={profile.local}
                  value={held?.inputPer1M ?? ""}
                  onChange={(event) => patch(key, "inputPer1M", event.target.value)}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  disabled={profile.local}
                  value={held?.outputPer1M ?? ""}
                  onChange={(event) => patch(key, "outputPer1M", event.target.value)}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
