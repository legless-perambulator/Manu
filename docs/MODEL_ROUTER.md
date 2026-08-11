# MODEL_ROUTER

The product must never be permanently bound to one model provider. All model operations go through a provider-independent abstraction.

## Status

Documentation stage. A model abstraction is part of V1; task-specific routing and richer provider support arrive later.

## Provider abstraction

```typescript
interface LanguageModel {
  generate(...): ...
  stream(...): ...
  toolCall(...): ...
  structuredOutput(...): ...
}
```

No layer imports a vendor SDK directly except that provider's adapter behind this interface. Model-provider code must not leak throughout the application (see [ARCHITECTURE.md](ARCHITECTURE.md)). Claude may be used first and heavily during development, but the architecture stays provider-independent.

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

Because novel-scale agentic work can be expensive, track tokens, estimated cost, model, operation, agent, project and workflow. Support policies such as: *use a local model for metadata extraction*; *use a premium model only for final prose*; *maximum £2 per chapter build*; *ask before operations estimated above £X*. Cache reusable context and derived data where appropriate.

## Privacy routing

Routing respects privacy preferences — e.g. keep sensitive manuscripts on local models / BYOK endpoints. See [SECURITY_PRIVACY.md](SECURITY_PRIVACY.md).

## Invariants

- All model access goes through `LanguageModel`; adapters are the only vendor-specific code.
- Structured outputs are schema-validated before they affect the project.
- Routing decisions, token usage and cost are recorded per operation.
