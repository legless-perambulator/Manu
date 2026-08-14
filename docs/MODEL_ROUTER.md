# MODEL_ROUTER

The product must never be permanently bound to one model provider. All model operations go through a provider-independent abstraction.

- **Packages:** `@jellytind/model-router` (interface, registries, secrets, routing), `@jellytind/provider-anthropic`, `@jellytind/provider-google`, `@jellytind/provider-openai-compatible` (adapters)
- **Depends on:** `@jellytind/shared`
- **Status:** Interface, capabilities, typed failures, model registry, provider registry, model discovery, connection testing, secret storage, mock provider, task routing, and six provider identities (Anthropic, OpenAI, Google Gemini, OpenRouter, Ollama, any OpenAI-compatible server) are **implemented and tested**. Cost accounting and privacy-routing policy are **PLANNED**.

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

`RequestOptions` carries the two per-call controls every provider must honour:
an `AbortSignal` and a client-side `timeoutMs`.

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

## Task routing (implemented, policy PLANNED)

`ModelRouter` maps a `ModelTask` (`planning`, `drafting`, `continuity`,
`copy_edit`, `metadata`, `reader_sim`, `research`, `embedding`) to a concrete
`LanguageModel`, with a fallback default. It is deterministic and side-effect
free; cost/privacy/per-agent policy layers on later without changing the
contract.

The intended eventual shape:

```
Planning     → strongest reasoning model
Drafting     → preferred prose model
Continuity   → large-context reasoning model
Copy editing → inexpensive model
Metadata     → cheap/local model
Reader sims  → inexpensive parallel models
Research     → research-capable model
Embeddings   → embedding model
```

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

Still to come: cost limits, automatic routing and privacy preferences.

## Cost and token intelligence — PLANNED

Because novel-scale agentic work can be expensive, track tokens, estimated cost,
model, operation, agent, project and workflow. `TokenUsage` is already returned
by every call and `costMetadata` already lives on descriptors; the accounting
layer that turns those into policies — _use a local model for metadata
extraction_; _use a premium model only for final prose_; _maximum £2 per chapter
build_; _ask before operations estimated above £X_ — comes later.

## Privacy routing — PLANNED

Routing respects privacy preferences — e.g. keep sensitive manuscripts on local
models / BYOK endpoints. See [SECURITY_PRIVACY.md](SECURITY_PRIVACY.md).

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
- Routing decisions, token usage and cost are recorded per operation — **PLANNED**.
