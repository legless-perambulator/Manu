# MODEL_ROUTER

The product must never be permanently bound to one model provider. All model operations go through a provider-independent abstraction.

- **Packages:** `@jellytind/model-router` (interface, registry, secrets, routing), `@jellytind/provider-anthropic` (adapter)
- **Depends on:** `@jellytind/shared`
- **Status:** Interface, capabilities, typed failures, model registry, provider registration, secret storage, mock provider, task routing and the Anthropic adapter (text, streaming, structured output, tool calling) are **implemented and tested**. Additional providers, per-task routing policy, and cost/privacy policy layers are **PLANNED**.

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
  models(): ModelDescriptor[];
  createModel(modelId: string, credentials: ProviderCredentials): LanguageModel;
}
```

Registering a provider is how the product gains a new backend. The desktop app
holds a provider map and a registry built from `provider.models()`; it asks a
provider for a `LanguageModel` and then talks only to the interface.

### Anthropic adapter

`@jellytind/provider-anthropic` is the first functioning adapter and implements
all four capabilities. Its Anthropic-specific code is strictly internal:

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
hosts are pinned in `src-tauri/capabilities/default.json`.

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
- `secretKeyForProvider(provider)` gives the canonical key name.
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

The selected provider/model _is_ stored — as a machine-local preference, not in
the project — so a Story Repository stays portable and free of machine-specific
configuration.

## Settings UI

`ModelSettings` lets a writer choose a provider, choose one of its models, see
that model's capabilities/context window/cost, store or remove an API key, and
run a real connection test through the provider-independent layer. Failures are
explained from the typed `modelCode`, so the UI needs no provider-specific
knowledge.

Deliberately out of scope for now: per-task routing, per-agent model selection,
automatic routing and cost limits. This screen establishes only that the
abstraction can reach a real model.

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

## Provider adapters (over time)

- Anthropic — **implemented**
- OpenAI, Google, OpenRouter, Ollama / local models, OpenAI-compatible endpoints,
  future providers — **PLANNED**

Users should eventually support: hosted credits, bring-your-own API key, local
models, per-agent model selection, automatic routing, cost limits, and privacy
preferences.

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
- API keys live in host secure storage, never in a Story Repository.
- Provider abstractions are testable with no external API call.
- Routing decisions, token usage and cost are recorded per operation — **PLANNED**.
