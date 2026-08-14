# RESEARCH

The research system: a persistent, sourced, project-aware knowledge layer,
kept structurally apart from fictional canon (Phase 35).

- **Packages:** `@jellytind/domain` (`ResearchItem`, `ResearchTask`,
  placeholders), `@jellytind/story-repository` (`ResearchStore`, search, gaps,
  canonisation), `@jellytind/editing` (`ResearchAgent`),
  `@jellytind/agent-runtime` (the research tools), `@jellytind/skills`
  (`/research-pass`), `@jellytind/context-compiler` (the research section)
- **Status:** **Implemented and tested.** Manual research, the Research
  agent with provenance guarantees, the library panel, research tasks and
  placeholders, builder gap policies, context integration and the explicit
  canonisation workflow. External search providers are a **port** —
  `ResearchSearchProvider` — with no built-in web search wired yet.

## Research is not canon (§1)

The mandatory distinction, held structurally:

| Claim               | Where it lives                    | Who believes it           |
| ------------------- | --------------------------------- | ------------------------- |
| **Canon fact**      | `Fact` / `WorldRule` entities     | the story                 |
| **Research fact**   | `ResearchItem.facts`, with source | nobody, until reviewed    |
| **Author note**     | `notes` — on items, in `notes/`   | the writer, privately     |
| **Model inference** | anything `proposedBy: "model"`    | labelled, never defaulted |
| **Unverified idea** | an item still `unreviewed`        | pending judgement         |

"A Victorian London–York journey took about five hours" (research) and
"Elias leaves London at 09:00 and arrives at 13:30" (canon) are related and
not identical — and no code path in Manu can turn the first into the second.
The **only** bridge is the writer's explicit **Use in story** (§15), which
creates a Fact (carrying the research source in its `source` field), a World
Rule, or a note on an existing entity through the ordinary creation paths,
and records `canonisedAs` on the research fact so the bridge is visible from
both sides. Rendered research context is headed _"REAL-WORLD REFERENCE, NOT
STORY CANON"_ so even the model is told which kind of truth it is holding.

## The item (§2–4)

`ResearchItem` (`research/library/RES_XXXX.json` — journaled, versioned and
backed up like all authored knowledge): title, type (`web · book · article ·
paper · interview · manual_note · document · image_reference · other`),
status, **summary and content both** (§13 — a generated summary never becomes
the only surviving representation), source fields (URL, title, author,
published, accessed), tags, links to entities and scenes, the writer's notes,
extracted facts, a context pin, and **provenance**: origin (`manual · agent ·
import`), retrieval method, model, task. Provenance is immutable — how
something was obtained is a fact about the past — and survives restarts
because it is simply part of the record.

Status is the author's judgement (§4): `unreviewed → reviewed / trusted /
questionable / archived`. An item created by an agent arrives `unreviewed`
whatever it claims; nothing external is ever trusted by default.

**Conflicts** (§16) stay side by side: a research fact may carry
`conflictsWithItemId`, the detail view shows both accounts, and deciding
between them is authorship. Nothing merges sources.

## Manual first (§5)

The whole library works with no model configured: create a note, paste text,
add a source reference, tag, link to story elements, and import documents
from the `research/` folder (§22 — Markdown and plain text become items with
their content; PDFs become reference items; the folder itself stays plain
files a writer can fill from outside Manu).

## The Research agent (§6–8, §24–25)

`ResearchAgent` turns a question into library items, never chat:

```
question → [provider search] → distil → file items with provenance
        → link to scope → task awaiting_review
```

- **Sources are real or absent** (§8). With a `ResearchSearchProvider`, every
  cited URL must be one the provider actually returned — an invented citation
  is stripped, counted, and logged. With no provider, the model's own
  knowledge is used honestly: _no URL survives at all_, and
  `retrievalMethod: "model_knowledge"` says exactly what the item is.
- **Privacy is minimal context** (§24). What leaves the project is the
  question plus the scope's own material — the scene's title and purpose
  lines, the named entities' names. Never the manuscript; researching one
  factual question does not upload the book. Tested by assertion on the
  outgoing prompt.
- **Permissions** (§25): the agent runs under `run_research` (declared since
  Phase 7, now in use). It can read, search and file research — the tools
  (`list_research`, `search_research`, `create_research_item`) expose exactly
  that — and cannot edit prose, canonise, or delete anything.

## Tasks, placeholders and the pass (§17–21, §27)

A `ResearchTask` (`pending → researching → awaiting_review → completed`,
or `failed`/`cancelled`) is a persistent question with a scope. They come
from three places: the writer asking directly, **"Research this"** on a scene
(§18 — the question derives from the scene's placeholders or its purpose;
findings arrive in the library, linked to the scene; prose untouched), and
inline **placeholders** (§19, §21):

```
[RESEARCH: how long a 1990s landline trace realistically takes]
```

A placeholder is explicitly not prose. `findResearchGaps` attributes every
one to its scene deterministically; **`/research-pass`** (a Writing Skill,
deterministic throughout) sweeps them, collects open tasks, groups duplicate
questions and presents the review — researching approved questions then runs
from the library, and nothing rewrites prose.

**Builders** (§20): the chapter builder detects unresolved placeholders at
prerequisites. The `researchGapPolicy` — threaded down from book and act
builds — decides: `proceed` (default) builds with the placeholders in place
and says so; `pause` stops before drafting so the research can happen first.
Nothing is ever researched automatically.

## Context integration (§12)

Research is an explicit Context Compiler source with its own section — and
never the whole library. An item travels when it is **pinned** or **linked**
to the target scene, the chapter's scenes, or an entity the target involves;
the provenance says which ("research linked to SCENE_0042"), the priority
band is `retrieved` (first out under budget pressure), archived items never
travel, and the rendering keeps the source line attached.

## The library panel (§9–11, §26)

The **Research** panel (Write group, dockable beside the manuscript): All /
Recent / Linked to selection / Archived, tag and text filters (§23 — research
search is distinct from manuscript search), the detail view (title, summary,
source with an external open, provenance in plain words, source material,
extracted facts with confidence and conflict cross-references, notes, tags,
links, **Use in story** per fact), research questions with per-task Research
and the Research pass, and the documents import. No backing file is ever
shown.

## Invariants

- No code path converts research into canon except the writer's explicit Use in story.
- Provenance is immutable, never stripped by summarisation, and survives restarts.
- A cited source is one that was actually retrieved; invented citations are refused.
- Agent-created items arrive `unreviewed`; trust is only ever the author's word.
- Conflicting sources are kept apart and cross-referenced, never merged.
- Research context is retrieved by link and pin, never as a whole library.
- External research queries carry the minimal scope, never the manuscript.
- Placeholders are not prose; builders and the pass surface them, nothing hides them.

## Not yet

- **A built-in web search provider.** `ResearchSearchProvider` is the port;
  wiring a real search/fetch service (and its network policy) is future work.
- **Semantic research retrieval** — context selection is by link and pin;
  embedding-based relevance can join when semantic search infrastructure exists.

## Relationship to other subsystems

- [CONTEXT_COMPILER.md](CONTEXT_COMPILER.md) — how research reaches a drafting context.
- [AGENT_RUNTIME.md](AGENT_RUNTIME.md) — the permission and tool machinery the agent runs under.
- [WRITING_SKILLS.md](WRITING_SKILLS.md) — the skill architecture `/research-pass` rides.
- [CHAPTER_BUILDER.md](CHAPTER_BUILDER.md) — where the gap policy takes effect.
- [STORY_STATE.md](STORY_STATE.md) — the canon the library is deliberately not part of.
- [VERSIONING.md](VERSIONING.md) — the journal every library change rides.
