# SPECIALIST_AGENTS

Nine specialists, each a configuration rather than a persona.

- **Packages:** `@jellytind/agent-runtime` (the registry and its enforcement),
  `apps/desktop` (choosing one, and seeing what the choice changes)
- **Status (Phase 24):** **Implemented and tested.** The registry, the
  per-specialist permission grants, the recommender and the inspectable picker.
  The specialists share the investigation loop; per-specialist output schemas are
  declared but not yet enforced at runtime — see [Not yet](#not-yet).

## What a specialist is

Not a chat window with a different opening paragraph. A specialist is:

| Field           | What it decides                                             |
| --------------- | ----------------------------------------------------------- |
| `tools`         | Exactly which tools it may call. Becomes `allowedTools`.    |
| `permissions`   | What kind of action it may take at all.                     |
| `contextRecipe` | Which Context Compiler recipe it works from.                |
| `outputShape`   | The shape of what it returns.                               |
| `modelClass`    | `reasoning`, `drafting` or `fast` — resolved by the router. |
| `handsOffTo`    | Whose work begins where its own ends.                       |
| `outOfScope`    | What it deliberately does not do.                           |

A role prompt can be argued with. A tool list cannot: `grantFor(agent)` becomes
the executor's `PermissionGrant`, and `describeAvailableTools()` filters the
registry through that grant before the model is ever told what exists. The Copy
Editor does not decline to run the refactor analyser — it is never offered it,
and would be refused if it asked.

## The nine

| Specialist               | Works on                                    | Reaches                                                                             | Never                          |
| ------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------ |
| **Story Architect**      | the shape of the whole book                 | causality, thread queries, refactor **analysis**, versions, **draft chapter plans** | prose                          |
| **Scene Director**       | what a scene is doing before it is written  | scene/character/location queries, ranged reads, **draft chapter plans**             | writing the scene              |
| **Drafter**              | the prose itself                            | canon + reads, under the `scene_rewrite` recipe                                     | deciding what the scene is for |
| **Continuity Editor**    | the book against what the project knows     | the whole build/test/debug surface                                                  | judging prose quality          |
| **Character Editor**     | whether people behave like themselves       | character scenes, the debugger                                                      | prose craft                    |
| **Dialogue Editor**      | what people say and how                     | scenes, characters, ranged reads                                                    | narration, structure           |
| **Prose Editor**         | the sentence                                | the passage and its file — nothing else                                             | story or character decisions   |
| **Developmental Editor** | what is not working, as an editor would say | build, tests, threads, the file list                                                | rewriting anything             |
| **Copy Editor**          | mechanics only                              | three read tools                                                                    | anything that changes meaning  |

The Continuity Editor is the only specialist holding the whole deterministic
checking surface, and the Story Architect the only one holding
`analyse_story_refactor`. Both facts are tested rather than described.

**Analysis, never execution.** No specialist holds `apply_refactors` or
`delete_entities`. Staging and committing a structural change stays with the
writer ([STORY_REFACTOR.md](STORY_REFACTOR.md)).

**Draft plans, never approval.** The Story Architect and the Scene Director
carry `edit_plans` and the four plan tools (`inspect_scene_plan`,
`validate_scene_plan`, `create_scene_plan`, `revise_scene_plan`) — structured
plan data, not prose advice ([PLANNING.md](PLANNING.md)). The write tools touch
**draft** plans only: an approved plan is refused, and there is deliberately no
tool that approves one. Approval is the writer's alone.

## Different work, different context

A Copy Editor compiling a chapter's causal history to fix a comma would be
burning budget on material it must not act on. So the recipe varies with the
work:

```
story_architect, developmental_editor → chapter_inspection
scene_director, continuity_editor, character_editor → scene_inspection
drafter, dialogue_editor, prose_editor → scene_rewrite   (carries voice)
copy_editor → none
```

`scene_rewrite` is what carries author voice and character voice
([AUTHOR_VOICE.md](AUTHOR_VOICE.md), [CHARACTER_VOICE.md](CHARACTER_VOICE.md)),
which is why the three specialists that produce prose use it and the ones that
assess structure do not.

## One canon

Every specialist reads and writes the same Story Repository. **No specialist may
create or switch a branch**: an agent that could fork the project would be able
to build a private version of canon that the writer never sees, and reconciling
it later is exactly the problem branching exists to make visible
([VERSIONING.md](VERSIONING.md)). Alternative versions are the writer's
instrument, so `create_branch` and `switch_branch` appear in no specialist's tool
list and `create_branches` in no specialist's permissions.

## Recommending, never redirecting

`recommendSpecialist(request)` scores the writer's own words against each
specialist's vocabulary and returns the best match, or **nothing** rather than a
guess. The Agent panel offers it as a line the writer can ignore; every
specialist remains directly invocable whatever the recommendation says.

The matching is word-initial rather than substring, with a short suffix
allowance: _typos_ finds the Copy Editor, and _the timeline contradicts itself_
reaches the Continuity Editor instead of the Prose Editor via the "line" inside
"timeline".

## Seeing the difference

The picker in the Agent panel shows, for whichever specialist is selected: its
role, what it is responsible for, what is deliberately not its job, its model
class, its context recipe, the shape it returns, and — expanded — every tool it
can reach beside every tool it cannot, the second list struck through and
labelled _refused by the executor_.

That list is derived from the registry, not written by hand, so it cannot drift
away from what the runtime actually enforces. A writer who wonders why the Copy
Editor said nothing about the plot can read that it never had the tools to see
it.

## Not yet

Honest limits of this phase:

- The nine share the `InvestigationAgent` loop and its system prompt. What
  differs today is the toolbox, the permissions, the context and the model
  class — which is what makes their behaviour differ — but the loop itself is
  common.
- `outputShape` is declarative. Each specialist names a distinct shape and the
  registry enforces distinctness; **no per-shape output schema is validated at
  runtime yet**. Answers still come back through the grounded
  `AGENT_ANSWER_SCHEMA`.
- Specialists holding `edit_manuscript` cannot edit from the Agent panel: that
  registry contains no editing tool. Edits reach the manuscript only as reviewed
  proposals ([AI_EDITING.md](AI_EDITING.md)).

## Invariants

- A specialist's tool list is its grant; the executor enforces it, not a prompt.
- The model is offered only the tools its specialist holds.
- No two specialists share a tool surface or an output shape.
- No specialist may delete entities or apply a refactor.
- No specialist may create or switch a branch; there is one canon.
- Every specialist states what it does **not** do.
- A recommendation never changes who runs.

## Relationship to other subsystems

- [AGENT_RUNTIME.md](AGENT_RUNTIME.md) — the loop, tasks, and the permission
  architecture the registry plugs into.
- [AGENT_TOOLS.md](AGENT_TOOLS.md) — the tools being handed out.
- [CONTEXT_COMPILER.md](CONTEXT_COMPILER.md) — the recipes named here.
- [MODEL_ROUTER.md](MODEL_ROUTER.md) — what a model class resolves to.
