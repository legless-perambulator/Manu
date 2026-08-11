# AGENT_TOOLS

Agents operate through a **typed tool system**, not as unrestricted text generators. Tools use typed schemas; AI operations produce auditable actions.

## Status

Documentation stage. A foundational typed file/story tool set is part of V1 (see [ROADMAP.md](ROADMAP.md)).

## Why typed tools

Prefer:

```
update_character_state(character = CHAR_ELIAS, after_scene = SCENE_0042, changes = {...})
```

over an agent silently rewriting arbitrary state files. Typed tools give the harness control over what changed and allow validation before commit. Mutating tools route through the mutation layer so every change is attributable, inspectable and reversible (see [VERSIONING.md](VERSIONING.md)).

## Foundational tools

```
list_files()      read_file()       read_range()
create_file()     write_file()      replace_range()
move_file()       search_project()

get_character()   get_scene()       get_location()
get_story_state() get_plot_threads()

create_checkpoint()  show_diff()    revert_change()   compare_versions()
```

## Fiction-specific tools

```
get_character_state()     get_character_knowledge()   get_character_timeline()
get_relationship_state()  get_location_state()        get_object_state()
get_active_threads()      get_scene_context()         get_chapter_context()
get_world_rule()          get_fact()                  trace_fact()

create_scene()   split_scene()   move_scene()   delete_scene()

generate_outline()   generate_scene_plan()   draft_scene()   continue_scene()

analyse_pacing()     analyse_dialogue()      analyse_prose()
analyse_character_voice()  analyse_tension() analyse_scene_purpose()

check_continuity()   check_timeline()        check_character_knowledge()
check_world_rules()  check_repetition()      check_foreshadowing()
check_unresolved_threads()

update_story_state()
```

## Tool design rules

- **Typed schemas in and out.** Inputs and outputs are validated against schemas; malformed model output is rejected/repaired, never applied blindly (see [MODEL_ROUTER.md](MODEL_ROUTER.md)).
- **Read vs mutate separation.** Read tools are side-effect free. Mutating tools go through the mutation layer, respect the agent's permissions, and record provenance.
- **IDs, not names.** Tools address entities by stable ID.
- **Auditable actions.** Every mutating call yields a revision entry with agent, model, task, affected entities, before/after, reason and approval status.
- **Scoped.** A tool call must respect the calling task's `scope` / allowed files/entities and the agent's permission set (see [AGENT_RUNTIME.md](AGENT_RUNTIME.md)).
- **Context-aware generation tools** (`draft_scene`, `continue_scene`, …) obtain their context from the [Context Compiler](CONTEXT_COMPILER.md), never by ad-hoc dumping of the manuscript.

## Extensibility

The tool surface is designed to grow into a plugin/MCP-style ecosystem so third-party writing tools can be added without modifying core (see [ROADMAP.md](ROADMAP.md) V6). New tools must conform to the same typed-schema, permission and audit contract.
