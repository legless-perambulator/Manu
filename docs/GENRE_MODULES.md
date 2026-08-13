# GENRE_MODULES

How Manu adapts to different forms of storytelling without fragmenting into
separate applications.

- **Packages:** `@jellytind/genre` (the framework, the registry, the five
  modules, the templates), `@jellytind/domain` (the extension record),
  `@jellytind/story-repository` (`modules`, `extensions`, the `ModuleRuntime`
  port), `@jellytind/story-compiler` (the module slot on `BuildContext`)
- **Status:** **Implemented and tested** (Phase 30). The module interface with
  its ten registration slots, a closed registry, schema-checked extension
  records, module compiler rules running in the ordinary build, eight project
  templates, reversible enable/disable, and a workspace that hides what is
  switched off.

## The claim

> The same Manu core can power materially different fiction workflows through
> modular extensions rather than hard-coded genre-specific hacks.

The test for it builds **one project** — the same characters, chapters, scenes,
locations and relationships — switches on all five modules at once, and asserts
that every module's rules ran in one build against one project state, that each
module sees its own records and nobody else's, and that the core rules ran
unchanged and unaware.

A module **extends** the story domain. It never replaces it and never gets its
own copy. A mystery's scenes are scenes; a screenplay's characters are
characters; the timeline, the knowledge model, the causality graph, the version
history and the story compiler are the same ones underneath every genre.

## One entity, not forty

The obvious design is to give each genre its own entity types — a `Culture`, a
`Faction`, a `SceneHeading` — until `ENTITY_KINDS` is a union of every genre
Manu has ever supported and the ID space encodes which kinds of book are
permissible.

This does the opposite. There is **one** extension entity with one prefix:

```
ExtensionRecord {
  id: EXT_0001 · moduleId · kind · name · summary?
  fields: { [key]: string | string[] }
  attachedTo: EntityId[]
}
```

What makes a record a culture rather than a threat is a string in the record,
validated against a schema the module declared at registration. Adding a genre
adds no entity kind, no ID prefix, and no branch anywhere in the core.

Field values are strings and lists of strings, and nothing else. Not because
richer values are unimaginable, but because every consumer that has never heard
of the module — search, the entity inspector, the context renderer, a build
diagnostic — must still be able to read the record.

## What a module may register

Ten slots, splitting into two halves that matter.

**Provided outright** — data and pure functions the module contributes:

| Slot                 | What it is                                                    |
| -------------------- | ------------------------------------------------------------- |
| Entity extensions    | Record kinds with declared field schemas and attachment rules |
| Special views        | Panels, hidden entirely while the module is off               |
| Story Compiler rules | Checks that run in the ordinary build                         |
| Story Tests          | Templates a writer may adopt as their own                     |
| Metadata             | Project-level fields, e.g. a screenplay's format              |
| Commands             | Palette entries resolving to a skill or a view                |
| Templates            | The New Project offers, defined alongside the modules         |

**Named, and checked against the registries that own them** — agents, skills,
context recipes.

The distinction is not tidiness. **An agent is a permission grant**
(`docs/SPECIALIST_AGENTS.md`): a module able to mint one could hand itself tools
the writer never approved. So a module names an existing specialist and
validation refuses a name that does not resolve. The same for recipes.

Skills are the interesting case. A skill declares _its own_ owning module:

```ts
export const FAIRNESS_AUDIT = defineSkill({ …, module: "mystery" });
```

Ownership lives in one place, so there is one answer to "is this offered?" and
not two. A skill with no declared module belongs to everybody —
`/character-pass` is as useful to a screenplay as to a mystery, and gating it
would be a loss with no gain. Validation checks both directions: a module may
not claim a universal skill (which would quietly hide it from writers who never
enabled that genre), and a module must register a skill that declares it.

## Validation is the boundary

Every shipped module is validated as the registry is built, so a module naming a
renamed skill fails at import rather than as a blank panel in someone's project
three releases later. Refused: an unknown agent, skill or recipe; two modules
claiming one extension kind; a `choice` field with no choices; an `entity` field
with no entity kind; a command that runs nothing or two things; a rule that does
not declare it reads extensions (an incremental build would skip it); and a
deterministic test template.

That last one is a rule worth stating: **a module contributes a compiler rule
for anything the project can decide, and a test template only for what it
cannot.** A deterministic template would be the compiler's job done twice, and
the two would drift.

Records are validated against their kind's schema before anything is written. An
undeclared field, a choice outside its list, an entity field naming the wrong
kind of thing, or an attachment a culture is not allowed to make — each is
refused by name. This is where "extends the domain, does not replace it" stops
being a slogan: a module may add records, not arbitrary shapes.

## The build seam

`BuildContext` gained one field:

```ts
readonly modules: {
  enabled: string[]
  extensions: ExtensionRecord[]
  data: Record<string, unknown>   // keyed by module id, opaque
}
```

The compiler knows that modules exist and knows nothing about any genre. A
module's rule reads its own slot — `context.modules.data["mystery"]` — which it
filled itself via `collect`, and a rule reaching into another module's slot gets
`unknown` for its trouble.

The repository declares a narrow `ModuleRuntime` port and the framework
implements it, so the dependency runs the right way round: `@jellytind/genre`
depends on the repository, and the repository depends on an interface it wrote.
Attaching a runtime is optional — leave it off and everything works with the
core rules alone, which is exactly what a project with no modules should get.

## The five modules

**Mystery** is deliberately the odd one out: it declares **no extension kinds at
all**. Clues, suspects and deductions are a subsystem with their own store,
engine and tests (`docs/MYSTERY_ENGINE.md`). The module switches that subsystem
on — the clue board, `/fairness-audit`, and the fairness audit as part of every
build, where a premise the reader never sees becomes a build **error**. That is
the framework's real claim: a module is not obliged to express itself as records
in a bag, and where a genre deserves an engine it gets one.

**Fantasy** is schema and no more than schema — cultures, species, factions,
religions, magic systems, artefacts, genealogies, historical eras, languages and
geography. No second timeline, no second map, no parallel knowledge model. Eras
sit on the Timeline Engine's story time; geography attaches to locations the
project already has. The build reports a magic system with no recorded cost and
no limits, because a system with neither has no stakes.

**Romance** lays beats — attraction, intimacy, conflict, separation,
reconciliation, commitment — over the relationship state already being tracked
(`docs/RELATIONSHIP_STATE.md`). The build catches a reconciliation the project
never records breaking, which is deterministic: the beats are recorded, the
scenes are ordered, and either something came before it or it did not.

**Thriller** records threats, deadlines, pursuits, operational timelines,
resources and information asymmetry. Asymmetry names facts the knowledge model
already tracks rather than duplicating it. The build reports a clock that never
falls.

**Screenplay** is the domain extensions and not the tooling. Format is a
rendering problem; what belongs in the story model is that a scene happens
inside or outside, at a time of day, in a named place. A heading attaches to a
scene rather than replacing it, which is how the build catches a slug line that
has drifted from the scene it describes.

## Templates configure; they do not confer

Novel · Mystery · Fantasy · Romance · Thriller · Screenplay · Short Story ·
Blank Project.

A template is a **starting configuration**. Choosing "Mystery" does not make a
project a mystery project; it switches the mystery module on. The next morning
the writer can switch it off and fantasy on, and nothing about the manuscript,
the timeline or the revision history notices. There is no project _type_
anywhere in this codebase to be stuck with — the template is recorded as a note
about how the project started, and confers nothing.

## Disabling takes nothing away

The impact is stated before the switch, never after:

```
Switch off Fantasy?
  2 records stop being shown. None are deleted.
  Build checks that stop running: Magic without cost, Artefact without an object
  1 story test you adopted keeps running. It is yours now.
  Reversible. Switching it back on restores everything exactly as you left it.
```

`reversible: true` is a promise rather than an observation: nothing in this
codebase deletes a record when a module is disabled. The test enables, writes,
disables, re-enables, and finds every record where it was left, fields intact.

An adopted story test is the writer's own from the moment they adopt it — it
keeps running afterwards, because a module does not get to take back a promise
somebody else made about their book.

## The workspace adapts

One registry feeds the sidebar, the command palette and the keyboard shortcuts,
so a hidden panel cannot still be reachable by shortcut. A panel carries an
optional owning module and is filtered out while that module is off.

Two panels, not eighteen. Ten fantasy record kinds plus six thriller ones plus
two screenplay ones would be eighteen sidebar entries next to the twenty already
there, and the brief is explicit that the workspace must not become a cluttered
collection of every possible tool. So there is one **World** panel that browses
whatever the enabled modules record, with its form generated from the declared
schema — which is the payoff for having declared it: a module adds a record kind
and gets an editor, validation and a place in the build with no interface code
at all. And one **Modules** panel, always present, so a project is never stuck.

## Why the registry is closed

A module ships in the binary. There is no loading one from a project directory,
and that is a boundary rather than an unfinished feature: a module contributes
compiler rules — code that runs over every project on every build — and code
arriving from a downloaded file is a different product with a different threat
model (`docs/SECURITY_PRIVACY.md`).

## Invariants

- A module extends the story domain and never replaces it. No genre adds an
  entity kind, an ID prefix, or a branch in the core.
- A module may add records, not arbitrary shapes. Schemas are declared at
  registration and enforced on write.
- A module may not mint an agent, because an agent is a permission grant.
- A module contributes a rule for anything the project can decide, and a test
  template only for what it cannot.
- Disabling a module deletes nothing, and re-enabling restores everything.
- A template is a starting configuration, never a project type.
- With no runtime attached, the core behaves exactly as it did before modules
  existed.
