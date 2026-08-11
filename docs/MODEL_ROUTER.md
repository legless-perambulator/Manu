# MODEL_ROUTER

The product must never be permanently bound to one model provider. All model operations go through a provider-independent abstraction.

- **Packages:** `@jellytind/model-router` (interface + routing), `@jellytind/provider-anthropic` (adapter)
- **Depends on:** `@jellytind/shared`
- **Status:** Interface, `ModelRouter`, structured-output validation and an EchoModel test double **implemented and tested**. The Anthropic adapter's `generate`/`generateStructured` are implemented; `stream` and tool calling are **PLANNED**. Additional providers are **PLANNED**.

## Provider abstraction (implemented)

```typescript
interface LanguageModel {
  readonly id: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
  stream(request: GenerateRequest): AsyncIterable<StreamEvent>;
  generateStructured<T>(request: StructuredRequest<T>): Promise<T>;
  generateWithTools(request: ToolCallRequest): Promise<ToolCallResult>; // PLANNED impls
}
```

All request/response types are provider-independent (`ModelMessage`,
`GenerateResult`, `TokenUsage`, `StopReason`, …). No layer imports a vendor SDK
directly. The Anthropic adapter keeps its wire shapes private (`wire.ts`) and
maps to/from them in pure, tested functions (`mapping.ts`); it exports only
`AnthropicLanguageModel`, so no Anthropic-specific object crosses the boundary
(see [ARCHITECTURE.md](ARCHITECTURE.md) — "Provider code must not leak"). Claude
may be used first and heavily, but the architecture stays provider-independent.

### Structured-output guard

`parseModelJson(schema, rawText)` is the reusable primitive that stands between a
model and the project: malformed JSON or schema violations become a
`ValidationError` rather than corrupt data (AGENTS.md — "Structured LLM
Output"). `OutputSchema<T>` is provider- and library-independent; a Zod adapter
implements it later.

### Task routing (implemented)

`ModelRouter` maps a `ModelTask` (`planning`, `drafting`, `continuity`,
`copy_edit`, `metadata`, `reader_sim`, `research`, `embedding`) to a concrete
`LanguageModel`, with a fallback default. It is deterministic and side-effect
free; cost/privacy/per-agent policy layers on later without changing the
contract.

## Provider adapters (over time)

- Anthropic
- OpenAI
- Google
- OpenRouter
- Ollama / local models
- OpenAI-compatible endpoints
- future providers

## Task-specific routing

Allow routing per task type:

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

Users should eventually support: hosted credits, bring-your-own API key, local models, per-agent model selection, automatic routing, cost limits, and privacy preferences.

## Structured output contract

When structured output is required, the router enforces the pipeline (also see [ARCHITECTURE.md](ARCHITECTURE.md)):

1. define schema
2. request structured response
3. validate response
4. retry/repair when appropriate
5. reject invalid mutations
6. log failure

**No model response may corrupt the project merely because it returned malformed JSON.** Never depend blindly on LLM output format.

## Cost and token intelligence

Because novel-scale agentic work can be expensive, track tokens, estimated cost, model, operation, agent, project and workflow. Support policies such as: _use a local model for metadata extraction_; _use a premium model only for final prose_; _maximum £2 per chapter build_; _ask before operations estimated above £X_. Cache reusable context and derived data where appropriate.

## Privacy routing

Routing respects privacy preferences — e.g. keep sensitive manuscripts on local models / BYOK endpoints. See [SECURITY_PRIVACY.md](SECURITY_PRIVACY.md).

## Invariants

- All model access goes through `LanguageModel`; adapters are the only vendor-specific code.
- Structured outputs are schema-validated before they affect the project.
- Routing decisions, token usage and cost are recorded per operation.
