# ROADMAP

Versioned delivery plan. Implementation proceeds **vertically**: finish a coherent slice before starting multiple unrelated large systems. This document is the permanent map from vision to shipped capability; `MASTER_BUILD.md` is the full north-star specification.

## Status

**Phases 0 (foundation), 1 (Story Repository), 3 (fiction-domain entities), 4
(search & retrieval), 5 (revision history, checkpoints & diffs), 6
(provider-independent model layer), 7 (agent runtime & read-only tool system), 8
(Context Compiler V1), 9 (controlled AI manuscript editing), 10 (Story State V1)
11 (knowledge & belief graph), 12 (dynamic relationship state), 13 (Story
Timeline Engine), 14 (object continuity), 15 (narrative threads), 16 (Story
Compiler V1), 17 (Story Tests), 18 (Story Debugger V1), 19 (causality graph) and 20 (Story Refactor V1) complete.** AI can inspect a project through
typed tools, receive explicit attributed context — including who is where, who
knows what, and who believes something false at a named scene boundary — and
propose targeted prose edits and state changes that a human reviews before
anything becomes canon.

## Vertical-slice method

For every major capability:

1. define the domain model
2. define persistence
3. define application service
4. define UI
5. define agent tools if relevant
6. define LLM responsibility if relevant
7. define validation
8. define tests
9. implement
10. document

Do not build disconnected mock features. Every feature should progressively strengthen the same underlying fiction operating environment.

## Phase 0 — Technical foundation ✅

Establish the architecture and toolchain without building product features.

- pnpm monorepo; TypeScript strict; ESLint + Prettier; Vitest; root scripts
  (`dev`, `build`, `test`, `lint`, `typecheck`).
- Clean package boundaries: `shared`, `domain`, `persistence`, `story-repository`,
  `model-router`, `context-compiler`, `story-compiler`, `agent-runtime`, `search`,
  `providers/anthropic`.
- Domain identity foundation: branded entity IDs + generation, fully tested.
- Persistence interfaces (`ProjectStore`, `StateStore`, `RevisionStore`) with
  in-memory implementations.
- Provider-independent `LanguageModel` interface, `ModelRouter`, structured-output
  validation, and an isolated Anthropic adapter.
- Tauri + React desktop shell that compiles, launches, and bridges to Rust.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the resulting structure.

## Phase 1 — The Story Repository ✅

The persistent, authoritative project format.

- Domain: `Project`, `Chapter`, `Character`, `Location`, `PlotThread`, and the
  `ProjectManifest` with schema versioning.
- Persistence: pure path-safety, `NodeProjectStore` (atomic writes, traversal
  prevention), and a derived entity catalogue. (The SQLite index built in this
  phase was removed in Phase 30.5B3 — nothing read it; see STORY_REPOSITORY.md.)
- `StoryRepository` service: create / open / validate / save; safe file
  read/write/list/mkdir/exists; entity creation with stable, persisted IDs.
- Desktop app: create / open project flow, project explorer over the real
  repository, and a Markdown editor that saves through the repository. Filesystem
  access is mediated by root-confined Rust commands.

See [STORY_REPOSITORY.md](STORY_REPOSITORY.md).

## Phase 3 — Foundational fiction-domain entities ✅

A real story-world graph beneath the manuscript (no AI).

- Domain: `Character`, `Location`, `StoryObject`, `PlotThread`, `Fact`,
  `WorldRule`, `StoryEvent`, `Relationship`, `Scene` — with stable IDs (`RULE_`,
  `REL_` added) and status vocabularies.
- Repository: authoritative per-kind stores (Markdown+front-matter for prose
  entities, JSON collections for data entities), full CRUD, ID-stable renames,
  entity linking, and **referential integrity** (reference validation on write,
  dependency lookup, and safe delete with prevent/unlink).
- UI: context-sensitive inspector (structured character profile; scene POV /
  location / participants / threads / purpose; metadata for every kind), an
  entities browser with creation, entity linking, and delete-with-dependency
  warnings.

See [DOMAIN_MODEL.md](DOMAIN_MODEL.md) and [STORY_REPOSITORY.md](STORY_REPOSITORY.md).

## Phase 4 — Search & retrieval ✅

Deterministic retrieval before AI context selection.

- `@jellytind/search`: pure-TS lexical inverted index (Unicode tokeniser, AND
  terms + quoted phrases, ranking, excerpts, kind filters, incremental
  upsert/remove) and a `SemanticSearchProvider` abstraction for later embeddings.
- Repository: `ProjectSearch` indexes prose, entity files and collections (lazy
  build + incremental updates); `searchText`; and structured graph queries
  (`getScenesByCharacter/POV/Location/PlotThread`, `getScenesBetweenChapters`,
  `getCharacter/Object/PlotThread Appearances`).
- UI: a global Search tab (query, result-type filters, located excerpts) that
  opens files or selects entities.

See [SEARCH.md](SEARCH.md).

## Phase 5 — Revision history, checkpoints & diffs ✅

The safety layer required before unrestricted AI editing.

- Every mutation is captured as a reviewable, reversible **change set**
  (actor, operation, file before/after, entity changes, status) via a journaling
  store; failed operations roll back and record nothing.
- **Checkpoints** snapshot the whole project (auto "Draft 0" at creation).
- Line **diff** engine + a diff viewer (additions/deletions/modifications).
- **Revert** a single change set or to a checkpoint — non-destructive
  (history is append-only; the revert is itself recorded), with in-memory state
  reloaded afterwards.
- A **staging transaction** (stage → validate → present → commit/discard) ready
  for future AI operations.
- UI: a History tab (change sets + checkpoints) and a diff viewer with revert.

See [VERSIONING.md](VERSIONING.md).

## Phase 6 — Provider-independent language-model infrastructure ✅

The layer every AI feature is built on, deliberately bound to no single vendor.

- `LanguageModel` with four capabilities — `generateText`, `streamText`,
  `generateStructured`, `runWithTools` — plus a declared `ModelCapabilities`
  record, so a provider need not support everything and unsupported use fails
  typed rather than confusingly.
- **Model registry**: `ModelDescriptor` metadata (provider, model id, display
  name, capabilities, context window, cost) as data. No product behaviour is
  hard-coded around a current model name.
- **Typed failures**: one `ModelError` with a `modelCode` covering network,
  rate limit, auth, malformed output, timeout, cancellation, unsupported
  capability and provider errors.
- **Anthropic adapter**: the first functioning provider — text, SSE streaming,
  structured output and tool calling — with every wire shape private to the
  package.
- **Mock provider**: deterministic, records calls, can disable capabilities and
  inject any failure, so the whole abstraction is tested with no external API.
- **API keys** in operating-system secure storage via the desktop host, never in
  a Story Repository.
- UI: model settings (choose provider, choose model, store key, test connection).

Per-task routing policy, cost limits and privacy routing come later.

See [MODEL_ROUTER.md](MODEL_ROUTER.md).

## Phase 7 — Agent runtime & fiction-project tool system ✅

The first real agent, and the moment the core paradigm becomes demonstrable: **AI
inspects a structured fiction project through dedicated tools instead of
receiving the whole project in a prompt.**

- **Typed tool system**: name, description, input/output schemas, permission and
  handler. Every call is resolved, permission-checked, argument-validated,
  executed, output-validated and logged — a model that asks for a forbidden tool
  or malformed arguments never reaches a handler.
- **Thirteen read-only tools**: files (`list_project_files`, `read_file`,
  `read_range`, `search_project`), entities (`get_project`, `get_chapter`,
  `get_scene`, `get_character`, `get_location`, `get_plot_thread`) and
  deterministic graph queries (`get_scenes_by_character`, `…_by_location`,
  `…_by_plot_thread`).
- **Permissions architecture** with two independent gates (the agent's granted
  permissions and the task's tool allow-list). Phase 7 runs read-only; the write
  permissions are declared so mutating tools slot into an existing model.
- **Persistent `AgentTask`** (goal, status, scope, allowed tools, approval
  policy) with an enforced lifecycle, stored in `.writer/agents/` — task state
  lives in the project, not in a chat transcript.
- **Activity log** of actions — tool, argument summary, result summary,
  timestamp, status. Never model reasoning.
- **Path safety**: agent-supplied paths cannot escape the project root, and
  `.writer/` internals are refused.
- **Investigating agent**: a bounded tool loop, then one schema-validated answer
  that keeps retrieved project content separate from model interpretation.
- UI: an Agent panel (ask, live activity, grounded answer, cancel, recent tasks).

Broad autonomous manuscript rewriting is deliberately **not** enabled here.

See [AGENT_RUNTIME.md](AGENT_RUNTIME.md) and [AGENT_TOOLS.md](AGENT_TOOLS.md).

## Phase 8 — Context Compiler V1 ✅

Explicit, task-specific context assembly — so no writing operation ever has to
build a giant prompt out of random project files.

- **`ContextPackage`** with fixed, ordered sections (task, target, primaryText,
  adjacentScenes, characters, locations, plotThreads, styleRules, worldRules,
  additionalRetrievedContext).
- **Provenance on every element**: a machine-readable rule, a sentence a user
  reads (`participant in SCENE_0042`), and the chain of IDs that led there.
- **Three explicit recipes** — scene inspection, scene rewrite (which composes
  it and adds style and character-voice material), and chapter inspection (which
  takes neighbouring chapters as summaries, never as prose). There is
  deliberately no universal recipe.
- **Token budget** with an output reserve and priority bands. Nothing is
  silently truncated: elements degrade through declared steps — full, summary,
  reference, excluded — and every degradation is recorded with its cost and
  reason. Prose excerpts state inline how much was omitted. The task and target
  are always present, even when the budget cannot fit them.
- **Deterministic first**: selection follows the project's own references with a
  total ordering, so compiling twice yields an identical package. Semantic
  retrieval augments this later.
- **Package rendering** — the pure function that turns a package into the text a
  model call receives, so the inspector and the model cannot diverge.
- UI: a Context tab that compiles any recipe against any scene or chapter at a
  chosen budget and shows what was selected, why, what the budget did, and the
  exact compiled text.

See [CONTEXT_COMPILER.md](CONTEXT_COMPILER.md).

## Phase 9 — Controlled AI manuscript editing ✅

The phase where the product stops resembling a writing chatbot: the AI knows what
it is editing because the harness supplies structured story context, and every
proposed change is reviewable and reversible before it exists.

- **Three operations**: `rewrite_selection` (with the directives _rewrite,
  shorten, expand, strengthen dialogue, increase tension, remove exposition_),
  `rewrite_scene` and `continue_scene`. Autonomous chapter rewriting is
  deliberately not implemented.
- **The workflow**, using the existing subsystems rather than around them:
  identify target → compile context (Context Compiler) → invoke model (Model
  Router) → validate response → stage (StagedTransaction) → present diff →
  accept or reject → commit as one ChangeSet → audit.
- **The model never writes to a file.** Nothing is committed without an explicit
  human decision.
- **Scene markers** (`<!-- scene: SCENE_0001 -->`) give a scene's prose a
  boundary inside its chapter file — invisible in rendered Markdown, portable,
  optional, with two unambiguous fallbacks and a clear error instead of a guess.
- **Validation**: a schema for the reply, then deterministic checks for empty,
  unchanged and runaway output.
- **Hunk-level review**: accept all, reject, or tick individual hunks and take
  only those, with a preview of the file as it would be saved.
- **Audit**: AI provenance on the change set (operation, target, instruction,
  context recipe and tokens, model, task, approval, hunks taken) plus every
  outcome — including rejections — in the agent activity log.
- Each operation is a persisted `AgentTask` requiring the `edit_manuscript`
  permission, which is checked before any model is called.

See [AI_EDITING.md](AI_EDITING.md).

## Phase 10 — Story State V1 ✅

Deterministic, time-aware story state, so the model never has to re-read the
manuscript to work out who is where and who knows what.

- **State is transitions, not a snapshot.** Each change is anchored to the scene
  where it happens; the state at any point is derived by replaying them.
- **Five dimensions**, chosen for being objective enough to record without
  interpretation: character location, alive/dead status, object ownership,
  object location, canonical facts and simple character knowledge (with
  certainty and how it was learned).
- **Boundary queries**: `characterStateBeforeScene`, `objectStateAfterScene`,
  `characterKnowledgeBeforeScene`, `knows`, `establishedFactsBeforeScene`,
  `worldStateAt` — each answering at a named boundary, never "latest".
- **Provenance and confirmation** on every transition: source scene, source
  (author/agent/import), model, certainty, evidence, and a confirmation status.
  Only confirmed transitions are canon; proposals are stored and visible but
  excluded from state.
- **Validation**: a transition's subject and value must be entity kinds its kind
  allows, and every ID it names must exist — so a model cannot invent state.
- **Manual editing**: a State tab that reconstructs the world before or after any
  scene and lets the author record, correct, confirm, reject or delete
  transitions, each as a reversible change set.
- **AI extraction**: "Analyse state changes" proposes structured transitions from
  a scene with confidence and supporting evidence; unusable drafts are shown with
  the reason rather than dropped.
- **Context Compiler integration**: a `storyState` section carries the state of
  the involved characters and objects at the scene's entry boundary, with
  provenance that names the boundary.

Narrative ordering moved into `@jellytind/domain`, since the compiler, the
timeline and the Story Compiler must agree on what "the previous scene" means.

See [STORY_STATE.md](STORY_STATE.md).

## Phase 11 — Character knowledge & belief graph ✅

Time-aware information state: what is true, what a character knows, what they
believe, what they wrongly believe, how sure they are, and how they found out.

- **Facts are propositions.** `Fact.objectiveTruth` says whether a statement
  holds in the story world, so a false proposition is a first-class entity that
  characters can believe. A belief never mutates the fact it points at.
- **Five knowledge states** — `unknown`, `suspected`, `believed`, `known`,
  `disbelieved` — with `disbelieved` distinct from never having met the idea.
  Certainty is optional analytical metadata, not objective psychology.
- **Eight acquisition sources** — witnessed, told, read, inferred, remembered,
  assumed, deceived, unknown — with `sourceEntityId` naming the source, which is
  what makes transfer traceable without a separate transfer record.
- **Integrated with Story State, not bolted beside it**: knowledge is carried by
  the same scene-anchored transitions as location and possessions, so it is
  time-aware by construction. `knowledge_gained` from Phase 10 is read as the new
  shape, so existing projects migrate themselves.
- **Queries**: knowledge before/after a scene, whether a character holds a fact,
  who holds it by a given point, one character's history with one fact, a fact's
  whole timeline, and `traceAcquisition` to follow a chain back to its first-hand
  source.
- **The knowledge graph**: everyone's position on one proposition at one moment,
  including who has none — plus false beliefs in both directions and information
  asymmetries among a scene's cast.
- **Deterministic violation checks** as a reusable API: telling what you never
  held, knowing a fact before the story establishes it, contradictory
  transitions, and a scene referencing what its POV does not hold. **Deception is
  exempt** — a liar conveying what they know to be false is the point, not a bug.
- **AI extraction** extended to propose states, sources and sources' identities,
  still validated and still `proposed` until a human confirms.
- **Context Compiler** carries selected knowledge — false beliefs, asymmetries,
  and positions on the facts a scene references — never a dump of everything.
- `Scene.factIds` records the facts a scene puts on the page, the deterministic
  signal behind the reference check.

See [STORY_STATE.md](STORY_STATE.md).

## Phase 12 — Dynamic relationship state ✅

Relationships stop being labels and become time-aware state.

- **Identity survives change.** The entity holds `REL_0012` and its starting
  type, status and description; everything that evolves lives in scene-anchored
  transitions, so a pair can go from allies to enemies without anything keying
  off "the ally relationship".
- **Descriptive state first**: type, status and description are free text, and a
  writer who never touches a number has a fully working system.
- **Ten optional analytical dimensions** — trust, affection, fear, resentment,
  loyalty, dependency, suspicion, attraction, respect, power. Each change may
  carry a qualitative level, a 0–1 magnitude, or both, with the reason it moved.
  Both forms are first class and the system never invents the one it was not
  given.
- **Milestones** that are not romance-shaped: alliances, betrayals, oaths, debts
  and rescues alongside kisses and breakups.
- **Queries**: relationship before/after a scene, its full history as movements
  (`trust: high (0.72) → low (0.31)`), every relationship a character is in at a
  moment, and the changes inside a chapter.
- **Context Compiler**: relationships between characters both present in a scene,
  at the scene's **entry boundary** — never a later scene's version, with a test
  that asserts it.
- **AI extraction** extended to propose relationship changes, still validated and
  still proposed until confirmed.
- UI: a Relations tab showing the arc grouped by chapter, with a form to record
  the next change.

See [STORY_STATE.md](STORY_STATE.md).

## Phase 13 — The Story Timeline Engine ✅

The manuscript's order and the story world's order become two separate
sequences over the same material.

- **Story time at six precisions** on scenes and events — an exact instant, a
  date, a range, a position relative to another node, an ordinal marker like
  "Day 3, evening", or explicitly unknown. All optional, none privileged: a
  project that never states a calendar date is not a degraded case.
- **Temporal relations** (`before`, `after`, `during`, `overlaps`, `same_time`,
  `approximately_before`) are a complete chronology on their own, so a story with
  no clock is still fully ordered and fully checkable.
- **One timeline for scenes and events.** An event may be dramatised in a scene,
  happen off the page between two, span a range, or predate the book by decades,
  so it has story time whether or not it has a presentation position.
- **Order of precedence**: relations, then resolved absolute time, then
  manuscript position as a tie-break — with undated material staying in its
  neighbourhood and the rearrangement kept to the minimum the relations demand.
- **Character timelines**: one life in the order it was lived, the events a
  character takes part in, and where they were at a story-world instant —
  answered by replaying state in **chronological** order, which is the only way
  the answer is right in a story with flashbacks.
- **Deterministic checks**: relation loops, relations the timestamps refute,
  over-constrained nodes, bilocation, and impossible travel. **Travel times are
  declared, never assumed** — the system does not know how long London to
  Edinburgh takes, and with nothing declared no travel violation is reported.
- **Context Compiler**: the target's story time, the events the world has
  already reached, and concurrent material — with chronologically future
  material excluded unless a caller explicitly asks for it.
- UI: a Timeline tab with lanes over ranked positions, a story-order/
  manuscript-order toggle, character/location/plot-thread filtering, flashback
  marking, and click-to-inspect.

See [TIMELINE.md](TIMELINE.md).

## Phase 14 — Object continuity and location tracking ✅

Physical things become traceable, and physical contradictions become arithmetic.

- **Six object dimensions** as time-aware state: owner, holder, location,
  condition, status (`exists`/`lost`/`destroyed`/`hidden`/`unknown`) and
  visibility. Legacy `intact` and `transformed` are interpreted on read.
- **Owner is not holder.** A stolen revolver still belongs to its owner, and a
  character's inventory is what they _hold_. Collapsing the two would make theft
  and lending unrepresentable and turn every hand-off into a false conflict.
- **Placement decides where a thing is**: a held object travels with whoever
  holds it, a placed one stays where it was left, and putting something down
  ends the hold.
- **Transfers are derived, not stored.** `recordObjectTransfer` writes the
  transitions; `objectTransfers` reads them back, so there is one version of the
  truth. A stated origin the timeline contradicts is refused.
- **Nested locations** with containment honoured everywhere: someone in the
  Hidden Vault is at Blackthorn Manor, and a check that could not see that would
  report a contradiction between two true statements.
- **Character location strengthened** with arrival, departure, travel and
  deliberate unknown, so a departed character is not read as still standing
  there.
- **Six deterministic continuity checks** — impossible appearance, destroyed
  object reused, conflicting ownership, unexplained relocation, conflicting
  character location, invalid nesting — graded error versus warning, with two
  disciplines against false positives: containment is honoured, and silence is
  never treated as a claim.
- **Context Compiler** carries object state for the objects a scene uses, with
  locations spelled out through their containment path.
- UI: an Objects tab showing an object's history as a trail through the
  chapters, with the findings that name it.

See [OBJECTS_LOCATIONS.md](OBJECTS_LOCATIONS.md).

## Phase 15 — Plot threads, setups and payoffs ✅

The system understands narrative promises explicitly instead of inferring them
from prose.

- **Thread lifecycle as time-aware state**: the seven statuses move through
  scene-anchored transitions, so a thread's status at any point in the book is
  reconstructed rather than stored as "current".
- **Six interactions** — introduces, advances, complicates, references,
  escalates, resolves — most of which imply a status, so a writer records one
  thing rather than two. `references` implies nothing: a passing mention is not
  progress, and treating it as progress would hide the dormancy worth seeing.
- **Dormancy measured, never graded**: last appearance, scenes, chapters and
  words since. `dormantAfterScenes` has no default — the right number for a
  thriller is wrong for a family saga, so the system reports a gap only when a
  writer names a threshold.
- **First-class setups and payoffs** with all three cardinalities, plus
  foreshadowing metadata: subtlety, intended interpretation, true meaning,
  target thread and target reveal.
- **Six deterministic checks** — setup without payoff, payoff before setup,
  unresolved setup, dangling reference, abandoned thread, dormant thread — with
  only structural contradictions treated as errors, because an unfinished book
  is meant to be full of open promises.
- **Context Compiler**: threads at their entry state, promises outstanding, and
  payoffs landing in the scene — with author-only material flagged
  `revealsFuture` so Reader Simulation can exclude it structurally rather than
  by remembering to.
- UI: a Threads tab showing a thread's lifecycle chapter by chapter, its
  dormancy, its promises, and the findings that name it.

See [NARRATIVE_THREADS.md](NARRATIVE_THREADS.md).

## Phase 16 — Story Compiler V1 ✅

The milestone every recorded system was building towards: one command that asks
whether the story holds together.

- **`buildStory()` and a Build Story control**, producing deterministic,
  navigable diagnostics from structured state — no model involved.
- **The compiler consumes, it does not duplicate.** Almost every rule is a thin
  adapter over the check that already owns that knowledge: the entity graph,
  `checkContinuity`, `checkKnowledgeViolations`, `checkTimeline`,
  `checkNarrative`. A second implementation of continuity would be a second
  thing to drift.
- **Ten rules** across referential integrity, character continuity, knowledge,
  objects, timeline, plot threads, setups and project rules — plus a new
  dead-character check added to `checkContinuity`, beside its siblings rather
  than inside the compiler.
- **Diagnostics** with rule, severity, entities, scene, chapter, required
  evidence and a suggested action, identified by a fingerprint derived from what
  a finding is _about_ rather than how it is worded.
- **A modular rule registry**: rules are values, so the set extends by
  concatenation — by later phases now, and by plugins eventually.
- **Configuration**: rules and whole categories can be disabled, and a rule's
  severity overridden.
- **Skipped is never passed.** A disabled rule, a rule outside an incremental
  run, or a rule that threw is reported distinctly — and hard world rules the
  compiler cannot evaluate say so, rather than letting a green build imply they
  were enforced.
- **Build history and comparison**: numbered builds persisted under
  `.writer/builds/`, compared into new, resolved and persistent diagnostics. A
  build is derived analysis, so it is not a change set.
- **Incremental seam**: every rule declares what it reads, and `only` runs just
  the rules a change could affect. Real and tested; not yet driven from change
  sets.
- **Agent tools** `run_story_build` and `get_build_diagnostics`, read-and-run,
  with no auto-fix tool.
- UI: a Story Build view with passing checks, grouped findings, clickable
  navigation to scene and entity, and the diff against the previous build.

Nothing is faked: checks that cannot yet be made reliable — POV rules, voice
convergence, most world rules — are absent and documented as such.

See [STORY_COMPILER.md](STORY_COMPILER.md).

## Phase 17 — Story Tests ✅

The fiction equivalent of automated tests: a writer states what must be true at
a point in the story, and the project holds them to it.

- **Deterministic tests, fully implemented.** Ten assertions —
  knows / does not know a fact, alive, dead, at a location, object placement and
  ownership, thread status, fact truth, relationship status — each answered from
  recorded state alone.
- **Scopes are ranges.** `always`, `at`, `before`, `from`, `between`, resolved to
  the scenes they cover and checked at every one, because most narrative
  intentions are not "always true" but "true until". A chapter anchor means the
  chapter's first scene, so _before chapter 37_ means before it begins.
- **Semantic tests are declared, not faked.** `reader_suspicion`,
  `relationship_progression`, `character_disposition` and `free_form` are stored
  in a **separate type union**, reported as `not evaluated`, and never turned
  into diagnostics. An unanswered question is not a satisfied one.
- **A structured test builder**, not a language. Entity pickers driven by the
  assertion kind, scope pickers over chapters and scenes, and the test read back
  as a sentence before it is saved. A textual power-user syntax is a later layer
  over the same structures.
- **Failures say enough to act on**: expected state, actual state, the story
  point, the evidence behind it, and click-through to the scene and entities.
- **Build integration**: the suite runs during every Story Build and is
  displayed separately — `DETERMINISTIC STORY TESTS 21 / 22 passed` — with
  failures also landing as diagnostics carrying the test's own severity.
- **Tests are canon**: journaled, revertible, validated against real entities,
  and protected from entity deletion the way any other reference is.
- **Agent tools** `list_story_tests`, `run_story_tests` and
  `get_failed_story_tests` — read-and-run. No tool writes a test or repairs one.

See [STORY_TESTS.md](STORY_TESTS.md).

## Phase 18 — Story Debugger V1 ✅

Investigate before editing: a structured diagnostic workflow that answers _why
doesn't Marcus's betrayal land?_ with what the project records rather than with
generic writing advice.

- **The workflow is explicit**: problem → identify scope → retrieve evidence →
  trace the story systems → analyse → diagnose → present evidence → suggest
  interventions. Nothing rewrites manuscript content.
- **The first four steps are deterministic and model-free.** A project with no
  model configured still produces a real report — which is what makes the
  model's contribution visibly an addition to the evidence rather than the
  substance of it.
- **Four modes.** Reveal (setups, signals, thread lifecycle, who already knew,
  relationship state), character motivation (goals, knowledge entering the
  scene, prior behaviour, relationships), pacing (chapter and scene lengths,
  purposes, thread activity, distribution), continuity (start from a build
  diagnostic and trace each named entity back through the system that owns it).
- **Three kinds of claim, separated by the types**: deterministic evidence,
  measurements that are counted rather than graded, and a model diagnosis
  labelled as judgement with its confidence and its uncertainty. A report can
  exist with evidence and no diagnosis; it cannot exist with a diagnosis and no
  evidence.
- **The model must cite.** Evidence carries stable IDs, and a citation that
  resolves to nothing is reported as unsupported rather than quietly dropped.
- **The report says what it did not inspect**, and why — a silent omission
  would make it untrustworthy in exactly the cases that matter.
- **`Character.goals`** added to the domain: motivation is a question about the
  gap between what someone wants, what they know and what they do, and two of
  those three were already recorded. Unrecorded goals are reported as
  unrecorded, never as an absence of motive.
- **`/debug betrayal Marcus`**, resolved against the project's own entities,
  with unmatched words reported rather than ignored; natural language goes
  through the agent to the same structured request.
- **Agent tools** `run_story_debug`, `list_debug_reports`, `get_debug_report` —
  the investigation, not a conclusion. No tool applies an intervention.

See [STORY_DEBUGGER.md](STORY_DEBUGGER.md).

## Phase 19 — Story causality and dependency graph ✅

A manuscript records sequence. This records **consequence** — the foundation
Story Refactor is built on.

- **Eight relations** — causes, enables, motivates, reveals, requires,
  depends_on, prevents, resolves — stored as the writer phrased them and
  traversed on **one normalised arrow**, so `A requires B` and `B enables A`
  behave identically and nobody has to think backwards.
- **Nodes**: scenes, events, facts, threads, setups, objects, characters, and a
  new `Decision` entity — because a chain of scenes explains sequence while a
  chain of decisions explains consequence.
- **Registration is explicit and validated.** Both endpoints must exist and must
  be kinds that can participate; a link naming a deleted scene would silently
  poison every blast radius after it.
- **Only registered dependencies exist.** Nothing is inferred into the graph,
  and this is deliberately not an attempt to encode every causal relation in a
  novel — a warning that fires on everything is one nobody reads.
- **AI proposals are held.** `DependencyAnalyst` analyses a named run of scenes
  and stores everything as `proposed`, out of the graph until a human accepts
  it. Invented IDs and evidence-free claims are set aside _with the reason_.
- **The five queries** — dependencies, dependents, transitive dependents,
  dependency path, blast radius — all filterable by relation kind and depth.
- **Blast radius explains itself**: every affected element carries the path that
  reaches it, up to three routes each.
- **Cycles never crash.** Traversal is cycle-safe everywhere; loops are reported
  as warnings, never prevented — a writer may mean one.
- **Deletion warns first**, naming how many elements depend on the entity and
  showing the radius before the confirmation.
- **Compiler rule** `dependency_integrity`: dangling endpoints and
  self-dependencies as errors, loops and effects-before-causes as warnings,
  duplicates as notes. Confirmed edges only.
- **A graph view built for reading**: upstream, the node, downstream, in three
  columns; click to re-centre; filter by relation kind.

See [CAUSALITY.md](CAUSALITY.md).

## Phase 20 — Story Refactor V1 ✅

The operation every earlier system was building towards: a structural request
turned into an analysed, planned, staged and validated change that commits only
on approval.

- **The order is the product claim**: analyse → plan → checkpoint → stage →
  validate → present → commit or discard. Everything before `commit` is
  reversible by doing nothing.
- **Validation runs against a shadow copy** — the project in memory with the
  staged writes applied, opened as a second repository — so "commit only after
  approval" is literally true rather than "commit, then revert if it went
  badly".
- **Four bounded classes**: rename an entity, change a relationship, change a
  character attribute, move a scene between chapters. Not arbitrary change: a
  refactor engine that accepts anything produces plans nobody can review.
- **Stable IDs never move.** A refactor may change everything about a character
  except which character they are.
- **Analysis is found, not guessed**: the entity graph for references, the
  causality graph for blast radius, story-state for knowledge, the search index
  for prose, the test store for assertions. A model is never asked what is
  affected.
- **The hop that matters**: a relationship and a plot thread meet in the scenes
  both appear in, so the analysis expands from a target's scenes to what those
  scenes carry — without it, changing a relationship would report no threads.
- **Risks carry their source**, `RECORDED` or `MODEL JUDGEMENT`.
- **The model does two things**: consequences arithmetic cannot see, and
  sentence rewrites — which must quote the original **verbatim** or be rejected
  with the reason. A model that cannot quote the sentence it wants to change
  does not get to change it.
- **Specific before general**: sentence rewrites apply before blanket
  substitutions, or every quotation stops matching.
- **`manual` steps**: what the refactor will _not_ do for you, said out loud.
- **One change set, preceded by a checkpoint**, and a full audit trail under
  `.writer/refactors/`: request, analysis, plan, models, staged edits,
  diagnostics before and after, approval, revision.
- **A dedicated Refactor workspace** rather than a chat message.
- **Agent tool** `analyse_story_refactor` — analysis only. Nothing stages or
  applies a refactor on an agent's say-so.

See [STORY_REFACTOR.md](STORY_REFACTOR.md).

## V1 (remaining) — Writing IDE

Prove the core paradigm: **AI can operate reliably on a fiction project instead of merely chatting about it.**

- project creation · portable project repository
- manuscript/chapter structure · characters · locations · basic plot threads
- editor · project tree · AI panel · basic agent runtime
- typed file/story tools · Context Compiler V1 · project search
- AI edits · diffs · checkpoints · undo/revert
- model abstraction · basic local persistence

V1 does not need every advanced story system.

## V2 — Story Intelligence

The application begins understanding the structure of the story.

- scenes as entities · story state · timeline
- character knowledge · relationships · object continuity
- plot-thread lifecycle · world rules
- Story Compiler (deterministic + semantic checks) · **dependency/causality graph ✅**
- Story Refactor V1 · **Story Debugger V1 ✅**

## V3 — Agent System

- Author Agent · Architect · Scene Director · Drafter
- Continuity / Character / Dialogue / Prose / Developmental / Copy Editors
- custom agents · Writing Skills
- task orchestration · multi-agent workflows · agent permissions · model routing

## V4 — Simulation and Advanced Intelligence

- Reader Simulator · Character Simulator
- mystery auditing · Story Tests · semantic tests · reader-state persistence
- suspicion/trust graphs · character behavioural analysis
- advanced knowledge graph · advanced causality analysis

## V5 — Autonomous Production

- chapter / act / book build pipelines
- approval gates · autonomous revision passes
- resumable long-running tasks · automatic validation
- state extraction · checkpointing · `/write-book`

`/write-book` means _launch a persistent, stateful, validated, multi-stage production pipeline_ — not "ask a model for a novel."

## V6 — Ecosystem

- plugin protocol · agent sharing · skill sharing · genre modules · marketplace
- external research tools · publishing integrations · richer import/export
- series/universe support · collaboration · community extensions

## Milestone ladder (cross-cutting)

1. AI can safely and intelligently operate on a structured fiction project. _(V1)_
2. The system understands enough story structure to reason about consequences across the project. _(V2)_
3. Specialised agents can collaboratively perform professional-scale workflows. _(V3)_
4. The system can simulate readers and characters to test narrative behaviour. _(V4)_
5. The harness can reliably execute novel-scale production/revision over long periods with consistency, state, recoverability and human control. _(V5+)_

## First demonstration target

An early demo that shows why this product is different (`MASTER_BUILD.md` §66): create a mystery project, five characters, a premise, a 12-chapter outline, draft Chapter 1, establish structured state — then _"Change Marcus from Elias's brother to his childhood friend,"_ run the refactor blast-radius analysis, apply on a branch, show diffs, run a Story Build. This is a far stronger demonstration than generating prose.
