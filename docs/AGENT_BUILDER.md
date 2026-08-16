# Agent & Skill Builder

> Phase 43. The Studio: normal writers create sophisticated custom agents and
> reusable multi-step skills entirely through the product — no source code,
> no raw configuration files. Power users get advanced configuration in the
> same place.

## What a custom agent is

A custom agent is **a configuration in the vocabulary Manu already
enforces** — never a persona and never code. It names:

| Field        | Vocabulary it draws from                                            |
| ------------ | ------------------------------------------------------------------- |
| Permissions  | The agent-runtime's `AgentPermission` set, enforced by the executor |
| Tools        | The semantic tool catalog (below), a real allowlist                 |
| Model policy | Manu routing · Drafting/Reasoning/Utility purpose · a pinned model  |
| Context      | Writer-facing choices, each one a real Context Compiler source      |
| Output       | Notes, or proposals that stage for approval — never direct writes   |

Everything a custom agent may do, a shipped specialist could already do;
everything it may not do is refused by the same gates. Implementation lives
in `packages/agent-builder`; the desktop surface is the **Studio** panel
(`/studio`).

## Simple and advanced modes (§2–§3)

Simple mode is a concise form: name, purpose, instructions, "may use" as
semantic groups, working context as checkboxes, and what the agent hands
back. Permissions are **derived from the chosen tools**, so simple mode
cannot produce a tool/permission mismatch and never shows a schema or tool
JSON. Advanced configuration adds the per-tool allowlist, the model policy
(including pinning a configured model), a detailed context recipe, the
command alias and the storage scope.

## The tool catalog (§4, §23)

`CORE_CATALOG` groups the agent-runtime's tools semantically — Read the
story, Read the manuscript, Research, Story checks, Plans, Structure &
versions — and `toolCatalog(pluginTools)` folds in one group per enabled
plugin that contributed agent tools. Plugin tools ride behind the
`use_external_services` permission and still pass through the plugin host's
own gates. The catalog names are asserted against the runtime registries in
tests, so it cannot drift from what exists.

## Permission summary (§5)

Before saving, the Studio always shows `permissionSummary`: "This agent
can…" and — just as loudly — "This agent cannot…", derived from the actual
grant, not from the description.

## Model configuration (§6)

`routing` hands the choice to the Model Router. `class` pins the router to
the writer's purpose assignment (drafting/reasoning/utility). `pinned`
names a configured model and is validated against what is actually
configured. All three go **through** the router (`custom_agent` operation),
so custom agents obey the same budgets, privacy policy and usage accounting
as everything else.

## The test sandbox (§8)

**Test Agent** runs the definition against real project material and shows
the context it was given, the tools it would be allowed, the notes, and any
proposed mutations. The sandbox has no write port: there is no code path
from a test run to the manuscript.

## Skills as flows (§11–§19)

A Studio skill is a **flow**: inputs, an ordered sequence of closed step
kinds, bounded branching, approval gates, bounded retry, one declared
output. The step kinds are exactly:

`run_agent` · `run_tool` (read-only tools only) · `search_project` ·
`compile_context` · `run_story_build` · `run_story_tests` ·
`request_approval` · `generate_report` · `apply_staged_changes` · `branch`

There is no scripting language and no way to express one. Conditions are a
named deterministic measure (`compiler_errors`, `compiler_warnings`,
`tests_failed`, `findings`), a comparison and a number; a branch cannot nest
another branch. Retry is capped at three attempts — there is no loop
construct, so there is no infinite one. `apply_staged_changes` runs only
after an approval gate approved specific proposals, checked at validation
_and_ again at runtime.

Runs persist in `.writer/studio/runs/` from the first step: an approval gate
can wait a week, and a restart resumes from the file alone. Each run
snapshots the flow definition and records the revision of every agent it
used (§25).

## Storage, scopes and revisions (§9, §25)

`BuilderStore` works over any file store: project definitions live in
`.writer/studio/` and travel with the book; global definitions live in app
data; a universe store slots into the same class. Saving over an existing
definition bumps the revision and files the old body under `history/`;
removal renames rather than destroys.

## Sharing (§10, §26)

Export writes a package with marketplace-ready metadata — name, author,
description, version, compatibility, permissions, dependencies — and the
definition, nothing else. The definition schema has nowhere to put a
credential, and import refuses anything that looks like it carries one
(key-shaped strings, credential-named fields). No marketplace exists; these
are files.

## Commands (§20) and templates (§21)

An agent or skill with a command alias registers through the Phase 39
command registry alongside everything else. An agent alias runs the sandbox
(real analysis, nothing applied); a flow alias starts the run and waits at
its gate in the Studio. Four templates ship: Character Audit, Continuity
Pass (with a conditional branch), Dialogue Review, and Chapter Polish (with
an approval gate and staged apply).

## Validation (§24)

`validateAgent` / `validateFlow` answer before activation: missing tools,
permission mismatches in both directions, unusable model pins, unknown
agents, out-of-vocabulary conditions, nested branches, missing approval
before apply, invalid outputs — each as a sentence naming the problem.

## Acceptance (§27)

`packages/agent-builder/src/agent-builder.test.ts` runs the scenario end to
end through the public API only: the **Noir Dialogue Editor** agent and the
**Noir Dialogue Pass** flow (search → custom agent → voice comparison →
proposals → approval gate → staged apply → Story Build → report), proving
permissions are honoured, a fresh runner resumes the paused run from disk,
only accepted proposals are applied, and the exported package round-trips
with no credentials.
