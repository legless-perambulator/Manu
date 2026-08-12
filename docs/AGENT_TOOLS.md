# AGENT_TOOLS

Agents operate through a **typed tool system**, not as unrestricted text generators. Tools use typed schemas; AI operations produce auditable actions.

- **Package:** `@jellytind/agent-runtime`
- **Depends on:** `@jellytind/domain`, `@jellytind/model-router`, `@jellytind/persistence`, `@jellytind/search`, `@jellytind/shared`
- **Status (Phase 7):** The tool contract, schema validation, permission model, registry, executor and **thirteen read-only project tools** are **implemented and tested**. Mutating tools are **PLANNED** and must route through the mutation layer ([VERSIONING.md](VERSIONING.md)).

## The tool contract

```ts
interface Tool<Input, Output> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolSchema<Input>;
  readonly outputSchema: ToolSchema<Output>;
  readonly permission: AgentPermission;
  handler(input: Input, context: ToolContext): Promise<Output>;
}
```

`ToolSchema<T>` extends the model router's `OutputSchema<T>` with a `jsonSchema`
description, so **one** validating contract guards both structured model output
and tool arguments, and the same object can be handed to a provider's
tool-calling API as data.

Read/write classification is **derived** from `permission` rather than declared
separately (`isReadOnly`), so a tool cannot claim to be read-only while holding
a write permission.

`ToolRegistry` registers tools by unique name and rejects duplicates and unknown
names with a typed `AgentError`. It stores tools in an erased form
(`RegisteredTool`) so differently-shaped tools share one collection; the
executor restores safety by validating every value through the schemas.

## The executor is the chokepoint

`ToolExecutor` runs every call in a fixed order:

```
resolve in registry → check permission → validate input → run handler
                    → validate output → log activity
```

A model that asks for an unregistered tool, a forbidden tool, or malformed
arguments **never reaches a handler**. Failures are _returned_, not thrown — a
failed tool call is ordinary agent business, and the model is told what went
wrong so it can try something else. Only cancellation aborts a run.

## Permissions

```ts
type AgentPermission =
  | "read_manuscript"
  | "read_canon" // read-only
  | "edit_manuscript"
  | "edit_story_state"
  | "create_entities"
  | "delete_entities"
  | "run_research"
  | "create_branches"
  | "apply_refactors"
  | "run_simulations"
  | "use_external_services";
```

A call is allowed only when **both** gates pass:

1. the tool's `permission` is in the grant's `permissions`, and
2. the tool's name is in the task's `allowedTools` (when set).

Two independent gates means widening one never silently widens the other. Phase
7 runs under `READ_ONLY_GRANT`, which carries no write permission at all, so no
configuration mistake can turn an investigation into an edit. The write
permissions above are declared now so mutating tools slot into an existing model
rather than requiring it to be retrofitted around them.

## Implemented tools (Phase 7 — all read-only)

```
list_project_files()  read_file()   read_range()   search_project()

get_project()  get_chapter()  get_scene()
get_character()  get_location()  get_plot_thread()

get_scenes_by_character()   get_scenes_by_location()   get_scenes_by_plot_thread()
```

- `get_character` returns the character _and_ every relationship they are part
  of; `get_chapter` returns the chapter _and_ its scenes — retrieval is shaped
  around the questions writers actually ask.
- The `get_scenes_by_*` tools are deterministic graph queries computed from scene
  records, not inferred from prose.
- `search_project` returns located excerpts, never whole files.

## Path safety

`read_file`, `read_range` and `list_project_files` are the only tools that accept
a raw path — the one input a model can invent freely. Both guards apply:

1. **Traversal.** `normalizeProjectPath` rejects absolute paths, drive letters,
   NUL bytes and any `..` resolving above the project root.
2. **Internals.** `.writer/` — manifest, derived indexes, revision history and
   the agent's own task log — is refused. Project metadata is exposed
   deliberately through `get_project` instead, and `.writer/` entries are
   filtered out of file listings.

Everything else addresses entities by **stable ID**, and an ID of the wrong kind
(`get_scene` given `CHAR_0001`) is rejected before any lookup.

## Tool design rules

- **Typed schemas in and out.** Both directions are validated; a schema drops
  keys it does not declare, so a model cannot smuggle extra arguments past a tool.
- **Read vs mutate separation.** Read tools are side-effect free. Mutating tools
  will route through the mutation layer, respect the agent's permissions, and
  record provenance.
- **IDs, not names.** Tools address entities by stable ID wherever practical;
  raw paths are accepted only where a writer genuinely works in files.
- **Auditable actions.** Every call — success, denial or failure — is logged to
  the activity feed. Every future _mutating_ call additionally yields a revision
  entry with agent, model, task, affected entities, before/after, reason and
  approval status.
- **Scoped.** A call must respect the calling task's `allowedTools` and the
  agent's permission set (see [AGENT_RUNTIME.md](AGENT_RUNTIME.md)).
- **Context-aware generation tools** (`draft_scene`, `continue_scene`, …) will
  obtain their context from the [Context Compiler](CONTEXT_COMPILER.md), never by
  ad-hoc dumping of the manuscript.

## Planned tools

```
create_file()   write_file()    replace_range()   move_file()
create_scene()  split_scene()   move_scene()      delete_scene()
create_checkpoint()  show_diff()  revert_change()  compare_versions()

get_character_state()     get_character_knowledge()   get_character_timeline()
get_relationship_state()  get_location_state()        get_object_state()
get_active_threads()      get_scene_context()         get_chapter_context()
get_world_rule()          get_fact()                  trace_fact()

generate_outline()   generate_scene_plan()   draft_scene()   continue_scene()

analyse_pacing()     analyse_dialogue()      analyse_prose()
analyse_character_voice()  analyse_tension() analyse_scene_purpose()

check_continuity()   check_timeline()        check_character_knowledge()
check_world_rules()  check_repetition()      check_foreshadowing()
check_unresolved_threads()

update_story_state()
```

## Extensibility

The tool surface is designed to grow into a plugin/MCP-style ecosystem so
third-party writing tools can be added without modifying core (see
[ROADMAP.md](ROADMAP.md) V6). New tools must conform to the same typed-schema,
permission and audit contract.

## Story Build tools (Phase 16)

```
run_story_build        — run the deterministic build; returns status, counts, diagnostics
get_build_diagnostics  — read a past build, filtered by severity or rule
```

Both carry `read_canon` and are read-and-run: a build is derived analysis and
changes nothing about the story. They are registered only when the project
supports building, so a fixture satisfying `ProjectAccess` without a compiler
simply does not offer them.

**There is deliberately no tool that applies a fix.** A diagnostic is a finding
about the writer's story, and acting on one is an editorial decision that stays
with a human. See [STORY_COMPILER.md](STORY_COMPILER.md).

## Story Test tools (Phase 17)

```
list_story_tests       — the writer's assertions about their own story, as stated
run_story_tests        — run them; every result, with deterministic and semantic totals
get_failed_story_tests — only the failures, with story point, expected and actual
```

All three carry `read_canon`. They are a better source than the agent's own
reading of the prose: _Elias must not know the killer's identity before chapter
37_ is an intention stated by the person who owns it, not something inferred.

Semantic tests come back as **not evaluated**, never as passing, so an agent
cannot mistake an unanswered judgement for a satisfied one.

**No tool writes a test, and none repairs a failing one.** An assertion about
what a story must be belongs to the person who made it. See
[STORY_TESTS.md](STORY_TESTS.md).
