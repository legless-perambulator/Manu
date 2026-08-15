# MODEL_ROUTER

The product must never be permanently bound to one model provider. All model operations go through a provider-independent abstraction.

- **Packages:** `@jellytind/model-router` (interface, registries, secrets, routing engine, cost accounting), `@jellytind/provider-anthropic`, `@jellytind/provider-google`, `@jellytind/provider-openai-compatible` (adapters)
- **Depends on:** `@jellytind/shared`
- **Status:** Interface, capabilities, typed failures, model registry, provider registry, model discovery, connection testing, secret storage, mock provider, six provider identities (Anthropic, OpenAI, Google Gemini, OpenRouter, Ollama, any OpenAI-compatible server), and — since Phase 36 — the **Model Router proper**: routing profiles, per-operation requirements, routing policies, the deterministic routing engine, privacy constraints, budgets, token/usage accounting and cost formatting are all **implemented and tested**.

## The interface

```typescript
interface LanguageModel {
  readonly id: string;
  readonly capabilities: ModelCapabilities;
  generateText(request: GenerateRequest, options?: RequestOptions): Promise<GenerateResult>;
  streamText(request: GenerateRequest, options?: RequestOptions): AsyncIterable<StreamEvent>;
  generateStructured<T>(request: StructuredRequest<T>, options?: RequestOptions): Promise<T>;
  runWithTools(request: ToolCallRequest, options?: RequestOptions): Promise<ToolCallResult>;
}
```

All request/response types are provider-independent (`ModelMessage`,
`GenerateResult`, `TokenUsage`, `StopReason`, `StreamEvent`, `ToolCall`, …). No
layer outside an adapter imports a vendor SDK, and no application code branches
on a particular model name.

`RequestOptions` carries the per-call controls every provider must honour: an
`AbortSignal`, a client-side `timeoutMs`, and — Phase 36 §10 — an `onUsage`
callback every adapter invokes once per billed round trip with the
provider-reported `TokenUsage` (including `cachedInputTokens` where the wire
says). This is what lets `generateStructured`, whose return value is only the
parsed object, still be counted with actual tokens rather than estimates.
`instrumentModel(model, sink)` wraps any model so every call additionally
reports to a sink without displacing the caller's own `onUsage`.

### Capabilities

Not every provider supports every capability, so support is declared rather than
assumed:

```typescript
interface ModelCapabilities {
  readonly streaming: boolean;
  readonly structuredOutput: boolean;
  readonly tools: boolean;
}
```

Callers inspect `model.capabilities` before using a capability. A model asked for
something it does not support fails with a typed `unsupported` error rather than
producing a confusing provider-level failure.

## Model registry

`ModelDescriptor` is the provider-independent metadata record:

| Field                                                            | Meaning                                       |
| ---------------------------------------------------------------- | --------------------------------------------- |
| `provider`, `modelId`, `displayName`                             | Identity and how to show it                   |
| `capabilities`                                                   | What the model can do                         |
| `contextWindow?`                                                 | Token budget, when the provider publishes one |
| `costMetadata?`                                                  | `inputPer1M`, `outputPer1M`, `currency`       |
| `supportsTools`, `supportsStructuredOutput`, `supportsStreaming` | Derived flags, convenient for UI filtering    |

`describeModel()` builds a descriptor and derives the `supports*` flags from
`capabilities` so the two can never disagree. `ModelRegistry` is a catalog keyed
by `provider:modelId` with `register` / `get` / `list` / `providers`.

**The catalog is data.** Product behaviour reads capabilities, context window and
cost from descriptors; it never hard-codes a current model name. Refreshing the
catalog as a provider's line-up changes affects what the settings UI offers and
nothing else.

## Providers

```typescript
interface ModelProvider {
  readonly name: string;
  describe(): ProviderDescriptor;
  models(): ModelDescriptor[];
  createModel(modelId: string, credentials: ProviderCredentials): LanguageModel;
  discoverModels?(credentials: ProviderCredentials): Promise<ModelDescriptor[]>;
  testConnection(credentials: ProviderCredentials): Promise<ConnectionTestResult>;
}
```

`ProviderRegistry` holds the adapters this build ships. **Registering an adapter
is the whole of adding a provider**: the settings interface is generated from
`registry.describeAll()`, so no interface code names a provider, and there is no
hard-coded provider list anywhere above the registry.

`ProviderDescriptor` is what a provider _is_, before anyone configures one:

| Field                 | Meaning                                      |
| --------------------- | -------------------------------------------- |
| `id`, `displayName`   | Identity, and how to show it                 |
| `summary`             | One line about what connecting this gets you |
| `auth`                | `api_key` or `none`                          |
| `local`               | Runs on the writer's own machine or network  |
| `configurableBaseUrl` | The writer sets the address                  |
| `defaultBaseUrl?`     | Where it lives by default                    |
| `supportsDiscovery`   | The provider can be asked what models it has |
| `credentialsUrl?`     | Where a key comes from                       |
| `connectionKind`      | Always `"api"` — see **Subscriptions** below |

`auth: "none"` is not an oversight. A local Ollama server needs no credential,
and demanding a placeholder one would be the kind of small lie that makes local
models feel second-class.

### Discovery

A frozen dropdown of model names is obsolete the day it ships. Where a provider
publishes a listing endpoint — Anthropic `/v1/models`, OpenAI and OpenRouter
`/v1/models`, Gemini `/v1beta/models`, Ollama `/api/tags` — `discoverModels()`
asks it, and the answer is cached on the connection so the list still renders
offline. A provider's built-in catalogue is the fallback, never the only source.

### Connections

A **provider** is a kind of service; a **connection** is one a writer has set
up. Somebody may run two Ollama servers — a laptop and a GPU box — and both are
Ollama. A connection carries an id, the provider id, the writer's own label, an
optional address, and the last-discovered model list. **It never carries the API
key**: that lives in the OS credential store, keyed by connection id.

### Do not guess unknown capabilities

A discovered local model reports a name and little else. Whether those
particular weights do tool calling is a property of the weights, not of the
server, and Ollama does not claim to know. So `ModelDescriptor` carries
`unknownCapabilities`, and `capabilityState()` answers `yes`, `no` or
`unknown`.

`capabilityRefusal()` refuses only a **known** `no`. Unknown is allowed
through: refusing a local model because nobody publishes a capability table for
it would make the strictness worse than useless. Where an operation genuinely
requires a capability — an agent investigation is a tool loop; every edit
arrives as a structured proposal — the refusal is raised _before_ the run, and
names the setting that fixes it.

### Subscriptions

Every connection Manu makes is an **API connection**, billed per use by the
provider. A ChatGPT Plus/Pro or Claude Pro/Max subscription is a consumer
entitlement to that vendor's own surfaces; it is not API access, and no
officially supported mechanism exists for a third-party application to
authenticate with one. Manu therefore does not reuse browser cookies, request
session tokens, impersonate official clients or call private consumer
endpoints, and the interface says plainly which kind of thing a connection is.
Local providers cost nothing and need no account at all.

### Anthropic adapter

`@jellytind/provider-anthropic` implements all four capabilities. Its
Anthropic-specific code is strictly internal:

- `wire.ts` — request/response/SSE body shapes, never exported
- `sse.ts` — Server-Sent Events framing, pure and testable
- `mapping.ts` — pure translation both ways, plus HTTP-status → `ModelError`
- `anthropic-model.ts` — the `LanguageModel` implementation
- `models.ts` — the model catalog and `AnthropicProvider`

The package exports only `AnthropicLanguageModel`, `AnthropicProvider` and the
model catalog, so no Anthropic-shaped object crosses the boundary (see
[ARCHITECTURE.md](ARCHITECTURE.md) — "Provider code must not leak"). HTTP is
performed through an injected `FetchLike`, which is what makes the adapter fully
testable with no network.

In the desktop app that injected fetch is the Tauri HTTP plugin, so provider
requests leave from the Rust host rather than the webview, and the reachable
hosts are pinned in `src-tauri/capabilities/default.json` (see **Network
scope**).

### OpenAI-compatible adapter

`@jellytind/provider-openai-compatible` is **one transport serving four provider
identities**: OpenAI, OpenRouter, Ollama and any other server speaking
`/chat/completions`. Writing that wire format four times would be four places
for the same streaming bug to live. What actually differs between them — the
address, the auth header, how models are discovered — is configuration
(`CompatibleProviderConfig`), not code.

Ollama is the instructive case. Its native API is at the root and its
OpenAI-compatible one under `/v1`, so the config keeps the writer's address as
the root — what they would type into a browser to check the server is up — and
appends `chatSuffix: "/v1"` for chat only, while discovery uses `/api/tags`.

### Google adapter

`@jellytind/provider-google` translates to and from Gemini's `generateContent`
shape. The key travels in an `x-goog-api-key` header rather than the query
string, so it cannot end up in a proxy's access log. Gemini's streaming
endpoint is a separate protocol; until that is implemented `streamText()`
yields the completed text as a single delta rather than pretending, which is
recorded in the code as a deliberate limitation.

### Mock provider

`MockLanguageModel` is a deterministic, offline implementation of the full
interface. It records the requests it receives, returns fixed text/chunks/tool
calls/structured values, can disable individual capabilities, and can inject any
`ModelErrorCode` on demand. **Tests never require a real API call**: every error
path, the structured-output guard and the streaming contract are all exercised
against the mock.

## Failure handling

Every failure is a typed `ModelError` carrying a `modelCode`:

| `modelCode`      | Cause                                             |
| ---------------- | ------------------------------------------------- |
| `network`        | The provider could not be reached                 |
| `rate_limit`     | Provider throttled the request                    |
| `auth`           | Missing, invalid or rejected credentials          |
| `invalid_output` | Output was not parseable/valid against the schema |
| `timeout`        | Client-side `timeoutMs` elapsed                   |
| `cancelled`      | The caller's `AbortSignal` fired                  |
| `unsupported`    | Capability the model does not have                |
| `provider_error` | Anything else the provider reported               |

`error.retryable` is true for `rate_limit`, `network` and `timeout`. Callers
switch on `modelCode`; no core code parses provider error strings or status
codes.

## Structured-output guard

`parseModelJson(schema, rawText)` is the reusable primitive that stands between a
model and the project: malformed JSON or a schema violation becomes a
`ModelError("invalid_output")` and the caller gets an exception instead of data.

**No model response may corrupt the project merely because it returned malformed
JSON.** Structured output is validated _before_ it reaches any store, so a
malformed response cannot mutate project state (AGENTS.md — "Structured LLM
Output"). `OutputSchema<T>` is provider- and library-independent; a Zod adapter
implements it later.

The full pipeline (also see [ARCHITECTURE.md](ARCHITECTURE.md)):

1. define schema
2. request structured response
3. validate response
4. retry/repair when appropriate — **PLANNED**
5. reject invalid mutations
6. log failure — **PLANNED**

## Streaming

`streamText()` yields provider-independent `StreamEvent`s — `text-delta` for
incremental prose and a terminal `done` carrying usage and stop reason. The
Anthropic adapter normalises its SSE frames into these, buffering across chunk
boundaries so a delta split mid-frame is never lost. This is the foundation the
editor and agent UI build on in later phases.

## API keys

Keys are credentials, not project content.

- `SecretStore` (`get` / `set` / `delete`) is the provider-independent contract.
- `secretKeyForProvider(provider)` gives the canonical key name; the desktop
  app's `secretKeyForConnection(connectionId)` produces the same
  `provider:<id>:apiKey` shape, which is what lets a pre-connections Anthropic
  setup keep working after migration without the writer re-entering anything,
  and without the migration ever reading or moving the secret itself.
- The desktop app implements it with `TauriSecretStore`, which calls Rust
  commands that use the operating system credential store (macOS Keychain,
  Windows Credential Manager, Freedesktop Secret Service).
- Where no such service exists — a headless Linux box, a container — the host
  falls back to an owner-only (`0600`) file in the application-config directory,
  and the settings UI states plainly which backend is in use rather than implying
  a guarantee the platform is not providing.
- `InMemorySecretStore` is used in tests and in browser preview, where nothing is
  persisted at all.

**No API key is ever written into a Story Repository**, its manifest, its
entities or its revision history. Nothing in the secret path touches a project
directory (AGENTS.md — "Secrets"). Keys are read at call time and not held in
application state longer than a request needs.

Connections and model-purpose assignments _are_ stored — as machine-local
preferences, not in the project — so a Story Repository stays portable and free
of machine-specific configuration. No key is written into a packaged build, an
application log, or an agent prompt.

## Settings → AI providers

`AiProviderSettings` lists the writer's **connections**, not a single global
provider. For each one it offers: a name, an address where the provider's
address is the writer's to set, an API key where one is needed, a real
connection test, a model refresh, and removal. Every provider in the picker
comes from `ProviderRegistry.describeAll()`.

Removing a connection deletes its stored key. Leaving an orphaned credential in
the OS store because a connection was deleted would be a quiet little secret
leak.

Failures are phrased for a writer: _"Cannot reach Ollama at 192.168.1.50:11434."_
The underlying `TypeError` is kept behind a "show technical detail" disclosure
rather than being the first thing anyone reads.

### Which model does what

`MODEL_PURPOSES` — `default`, `reasoning`, `drafting`, `utility`, `simulation`
— each resolve to a connection and a model id. Anything unset falls back to
`default`, so configuring one model configures all of it. Workflow routing
classes map onto purposes: `premium_reasoning → reasoning`,
`premium_prose → drafting`, `cheap_analysis → utility`, and `local_metadata`
maps to nothing at all because the project answers it.

## Network scope

The packaged application can only reach what
`src-tauri/capabilities/default.json` permits, and the audit found that list
naming exactly one host — which meant a correctly written adapter still failed
after packaging (MANU-005). It now permits:

- the four hosted providers this build ships adapters for, by name;
- `localhost` and `127.0.0.1` on any port, over http and https;
- **any** host on ports `11434` (Ollama) and `1234` (LM Studio), because a model
  server on another machine is the normal case for anyone with a GPU box and
  assuming localhost would quietly exclude them.

It deliberately does not grant general outbound access. A dedicated inference
port opened network-wide is a narrow, explicable concession; "any host on any
port" is a general-purpose exfiltration channel, and this application has no
business asking for one. `lib/network-scope.ts` mirrors the list so a writer
who types an address outside it is told _before_ the request rather than handed
a bare network failure after it, and a test asserts the mirror and the host
agree — including that every shipped provider's default address is reachable.

A server on some other port therefore needs the capability file edited and the
application rebuilt. That is a real limitation, stated rather than hidden.

## The Model Router (Phase 36)

Routing is **explicit, inspectable policy — not magic** (§1). One pure
function, `routeOperation`, maps (operation, configured models, policy,
overrides) to a decision with its reasons; because it is side-effect free, the
same call answers three questions: which model will run, what the route
preview shows before anything starts (§20), and what a routing test asserts
with no live API call (§28). `planRoutes` runs it across a whole workflow.

### Profiles (§2)

`ModelProfile` is what a configured model is _to this writer_: connection,
provider, capabilities (with `unknownCapabilities` — unknowns stay unknown),
context window and output limit where known, writer-assigned `qualityTier` /
`speedTier`, `pricing` (absent = unknown), `local`, `privacyClass`, and
`availability` (`available · rate_limited · unavailable` — a rate limit is a
temporary fact with an expiry, §15). `profileFromDescriptor` builds one from a
catalogue descriptor plus what only the configuration knows.

### Operation requirements (§3)

`OPERATION_REQUIREMENTS` is the one central declaration of what each kind of
AI work needs — the Story Architect's high reasoning and required structured
output, the Drafter's prose quality, extraction's structured output and high
cost sensitivity, simulations' parallel-friendly cheapness, research's tool
preference — never scattered through prompts. Each operation also names the
purpose that anchors it (§5) and the orchestration routing class it reports
under.

### Policies (§4) and anchors (§5)

`ROUTING_POLICIES`: **Best quality**, **Balanced**, **Economy**, **Local
first**, **Custom**. The writer's manual purpose assignments (Default /
Reasoning / Drafting / Utility / Simulation) are preserved as **anchors**: an
explicit assignment simply wins under Best quality, Balanced and Custom;
Economy and Local first may prefer elsewhere for exactly the work those
policies exist for — cheapest-capable bulk analysis, local-eligible utility
work — and the decision says so. A local model never wins a _cost_ preference
merely by being free: routing work local is Local first's explicit job, so
switching policies means what it says (§30).

### Order of authority

1. **Capability, context-size and privacy filters** (§6–§8, §17) — a model
   that cannot or may not do the work is out, whatever any preference says,
   and every exclusion is recorded with its reason. Privacy restrictions are
   never routed around; if nothing eligible remains, the decision is blocked
   and states every reason.
2. **A pin** (§22) — the writer's word for one operation. An incompatible pin
   **blocks** with the incompatibility surfaced; it is never silently ignored.
3. **The policy**, anchored as above.
4. **Availability** (§14–§15) — last, so a fallback is always the best
   eligible model that is actually up, with `fallbackFrom` on the record.

### Privacy (§17)

`PrivacyPolicy`: `local_only` (nothing leaves the machine) or `allow_cloud`
with rules — _never send manuscript prose to provider X_. Content classes
(`manuscript_prose · story_metadata · research_query`) default per operation,
honestly broad: anything that reads or writes scene text carries prose. Local
models are exempt from provider rules — the material never leaves.

### Budgets (§13)

`BudgetLimits` (monthly, per-build, per-operation approval threshold) checked
by `checkBudget` against **actual recorded spend**. A hard limit blocks —
never silently exceeded; a soft limit warns; an unknown estimate against a
hard limit warns honestly instead of pretending zero.

### The legacy `ModelRouter` class

The Phase 6 `ModelRouter` (task → model bindings with a default) remains as a
simple binding table; the engine above is the policy layer that was planned to
sit over it.

## Provider adapters

| Provider          | Package                      | Auth     | Address    | Discovery    |
| ----------------- | ---------------------------- | -------- | ---------- | ------------ |
| Anthropic         | `provider-anthropic`         | API key  | fixed      | `/v1/models` |
| OpenAI            | `provider-openai-compatible` | API key  | fixed      | `/models`    |
| Google Gemini     | `provider-google`            | API key  | fixed      | `/models`    |
| OpenRouter        | `provider-openai-compatible` | API key  | fixed      | `/models`    |
| Ollama            | `provider-openai-compatible` | none     | writer-set | `/api/tags`  |
| OpenAI-compatible | `provider-openai-compatible` | optional | writer-set | `/models`    |

Every adapter is tested against an injected `fetch`. **No test requires a real
credential or touches a network.**

## Cost and usage (Phase 36 §9–§12, §26)

Two rules hold everywhere: **actual usage is counted, never invented**, and
**unknown cost is "unknown", not zero**.

- `UsageRecord` is one call as it actually happened: operation, routing class,
  build, provider, model, provider-reported tokens (input / output / cached),
  and `cost` computed from pricing known _at the time_ — absent means unknown.
  `usageRecordFor` builds one; the desktop's routed models write them into the
  project's ledger (`.writer/usage/ledger.json`, `repo.usage`).
- Pricing enters the system only through the writer's pricing table in
  Settings → AI providers (providers do not publish machine-readable prices);
  `costMetadata` on descriptors is honoured where a catalogue carries it.
- `summariseUsage` totals calls, tokens and money per currency, keeping
  unknown-cost calls counted **beside** the money, never folded in.
  `formatApiCost`: money when known, "API cost: 0 (local model)" for local,
  "Cost unavailable" otherwise — never an invented number.
- `estimateOperationCost` + `formatCostRange` produce the §12 pre-operation
  estimate: a range that admits being one ("this is an estimate, not a
  promise"), or `null` when pricing is unknown — an estimate is never
  fabricated.
- The **Usage & costs** panel shows Today / This month / Project lifetime and
  a per-kind breakdown; build dashboards show per-class calls, tokens and cost
  where pricing is known (§11, §25). Lightweight **Good result / Poor result**
  verdicts (§18) are stored beside the model that did the work — nothing is
  trained on them and nothing reroutes behind the writer's back.

## Routing in the product (§19–§21, §27)

The desktop's `lib/routing.ts` is the single entry point (§21): it builds
profiles from the configured connections, reads the routing settings
(`policy · privacy · budgets · pins · pricing · tiers`), and
`createRoutedModel(repo, secrets, operation)` resolves a decision, constructs
the model, and instruments it so every call lands in the usage ledger. The
Chapter/Act/Book builders, the manuscript editor, diagnosis, dependency
analysis, refactor planning, skills, research and both simulators all resolve
their models through it — none of them contains routing logic of its own.
Builds started through it record `routing` — which model was chosen for which
operation and why — as provenance (§19); Settings → AI providers carries the
Model routing section (policy as the one basic choice; privacy, budgets,
pricing and pins behind the advanced disclosure) and the live plan table —
"View model plan" — showing exactly what will run before anything does (§20,
§27).

## Invariants

- All model access goes through `LanguageModel`; adapters are the only vendor-specific code.
- No product behaviour is hard-coded around a specific model name.
- Capabilities are declared, not assumed; unsupported use fails typed.
- Every failure surfaces as a typed `ModelError`.
- Structured outputs are schema-validated before they affect the project.
- API keys live in host secure storage, never in a Story Repository, a log, an
  agent prompt or a packaged build.
- Adding a provider is registering an adapter; no interface code names one.
- Capabilities nobody has stated are recorded as unknown, not guessed.
- Every connection is an API connection; no consumer subscription is implied.
- Provider abstractions are testable with no external API call.
- Routing decisions, token usage and cost are recorded per operation.
- Routing is a pure function of configuration; the preview, the run and the
  tests all get the same answer.
- A privacy restriction or a hard budget is never routed around or silently
  exceeded; an incompatible pin blocks with the reason, never quietly ignored.
- Unknown stays unknown: capabilities, pricing and tiers nobody has stated are
  never guessed, and unknown costs are counted, not zeroed.
