# UX

Manu's internals behave like a serious IDE. The writer should never have to.

> **Powerful machinery underneath. A calm, beautiful writing environment above.**

- **App:** `apps/desktop` (Tauri 2 + React 18 + Vite)
- **Status (Phase 30.6):** a **modular workbench** around a first-class
  manuscript editor. Semantic navigation, Focus Mode, tabbed and movable panel
  docks, workspace presets, persisted layouts, and manuscript typography the
  writer controls. Visual language is defined in [BRAND.md](BRAND.md).

---

## Two long-term product principles

These are not implementation notes. They decide arguments.

### 1. The filesystem is the machine representation, not the primary writer interface

A Manu project is a folder of plain files, and that is a promise worth keeping:
it is what makes the work portable, diffable, greppable, openable in any editor,
and recoverable with Manu shut. It is **storage**, and storage is not an
interface.

`manuscript/CHAPTER_0007.md` is where chapter seven lives. **Chapter Seven** is
what it is called. `relationships.json` is where relationships are kept; the
writer meets a **Relationships** view. No normal surface in Manu prints a path,
a file extension, an entity ID or a schema word as its primary label.

Nothing is renamed on disk to achieve this and nothing is hidden from the
writer: the **Project files** panel, under Advanced, shows the real folder as it
really is. Openness is preserved and made secondary, which is the point —
a writer should be _able_ to operate the folder, not _required_ to.

The rule is enforced rather than intended. `lib/naming.ts` defines what a
writer-facing label is, and the panel-registry tests apply it to every label in
the application. A panel called `facts.json` fails the suite.

### 2. The manuscript is the centre of Manu. Every other system is optional workspace around it

The editor is not one panel among thirty. It is the product, and the thirty are
things a writer may or may not want beside it today.

Concretely: the manuscript is the only region that is always present; it is what
survives every narrowing; the layout model reserves it a floor of 30% of the
window that no arrangement of docks may take; and **a writer who never opens the
agent, the compiler, the timeline or a character sheet should still be able to
justify using Manu for the writing environment alone.**

---

## The workbench

```
┌──────────────────────────────────────────────────────────────┐
│ manu|  The Blackthorn Inheritance          Commands ⌘K   ⋯    │
├──────────────┬────────────────────────────┬──────────────────┤
│ Manuscript   │  The Cellar Door           │ Characters       │
│ Outline      │                            │ Details          │
├──────────────┤     the manuscript         ├──────────────────┤
│ Chapter One  │                            │  Mara Blackthorn │
│ The Cellar…  │                            │  Protagonist     │
│ Chapter Two  │                            │  Wants…          │
├──────────────┴────────────────────────────┴──────────────────┤
│ 82 words   +410 this session                          main   │
└──────────────────────────────────────────────────────────────┘
```

Two docks, either side of the page. Each is an ordered **stack of tabs** with
one active; each can be closed entirely; any panel can be moved to the other
dock or closed; the divider between a dock and the manuscript is draggable.

The whole arrangement is a small data structure in
[`lib/workbench.ts`](../apps/desktop/src/lib/workbench.ts), and every change
goes through one of its verbs, so the rules hold in one place:

- a panel is in **one** dock only;
- an empty dock closes itself;
- widths are **fractions of the window, never pixels**, so a layout saved on an
  ultrawide is still a layout on a laptop;
- the manuscript keeps at least 30% of the width, whatever the docks want;
- anything read from storage is **repaired, never trusted** — a corrupt value, a
  layout from an older build, or a panel belonging to a genre module that has
  since been switched off all resolve to a workspace that works.

### Presets

Four starting arrangements, reachable from the palette or the ⋯ menu:

| Preset    | What it is for                                    |
| --------- | ------------------------------------------------- |
| **Write** | The manuscript, and nothing in the way            |
| **Plan**  | The manuscript beside the outline and the cast    |
| **AI**    | The manuscript, Manu Agent, and what it was given |
| **Edit**  | The manuscript with the checks and the changes    |

They are **starting points, not modes**. Touching anything moves the layout to
_Custom_ and the writer keeps what they made.

### Focus Mode

⌘⇧Return, or **Focus** in the editor bar. The docks and the status bar go, the
application chrome fades until the pointer finds it, and what remains is the
page. Esc leaves it, and leaving restores the previous arrangement exactly —
Focus is a flag over the layout rather than a different layout, which is what
makes "the way back" trustworthy.

### Panels are writer-facing concepts

The registry is [`lib/panels.ts`](../apps/desktop/src/lib/panels.ts), grouped by
the question a writer is asking:

| Group        | Panels                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| **Write**    | Manuscript · Outline · Notes · Research                                                                  |
| **Story**    | Characters · Story bible · State · Knowledge · Relationships · Objects · Plot threads · Timeline · World |
| **Assist**   | Details · Manu Agent · Context · Find in project                                                         |
| **Check**    | Story Build · Story tests · Diagnose · Passes · Workflows · Readers · Behaviour · Mystery · Voice        |
| **Change**   | Changes · Versions · Consequences · Restructure                                                          |
| **Advanced** | Modules · **Project files**                                                                              |

One registry feeds the docks, the palette and the shortcuts, so a panel hidden
by a disabled genre module cannot still be reachable by keyboard.

---

## The manuscript editor

### Formatting is semantic, and the file stays plain

The canonical manuscript is **Markdown**. That is not an implementation
convenience; it is what makes the rest of Manu possible. A manuscript has to
survive being diffed line by line, addressed by character offset for an AI edit,
versioned, branched, merged, read with `less` and opened in another editor
tomorrow. A rich-text document model would make every one of those approximate.

So **bold** is `**bold**`, in the file, where a diff can see it. The operations
live in [`lib/markdown.ts`](../apps/desktop/src/lib/markdown.ts) as pure
functions from (text, selection) to (text, selection):

| Chord | Does               | Chord    | Does              |
| ----- | ------------------ | -------- | ----------------- |
| `⌘B`  | Bold               | `⌘⌥1–3`  | Heading levels    |
| `⌘I`  | Italic             | `⌘⌥0`    | Body text         |
| `⇧⌘X` | Strikethrough      | `⇧⌘.`    | Block quote       |
| `⌘⏎`  | Scene break        | `⇧⌘8/7`  | Bulleted/numbered |
| `⌘F`  | Find (and replace) | `⌘Z/⇧⌘Z` | Undo / redo       |
| `⌘S`  | Save now           | `⌘⇧⏎`    | Focus Mode        |

Underline is deliberately **not** offered: it has no Markdown spelling, and
inventing one would produce a file that renders wrongly everywhere outside Manu.
Emphasis is the semantic; italic is how English typesets it.

### Reading and writing are different jobs

The writing surface is plain text with its marks visible, which is what keeps
character offsets exact for AI edits and diffs. **Read** renders the same file as
a formatted page — headings sized, emphasis set, scene breaks drawn, the measure
the writer chose. The renderer produces a closed union of node types, never
markup, so a chapter containing `<script>` renders as the characters `<script>`.

### Typography is the writer's

Six settings — typeface, size, line height, paragraph spacing, line length —
under **⋯ → How the manuscript is set**, with a live sample. Every one is
clamped, so no combination reachable through the control produces a page nobody
could read. None of it touches the file: a project opened on another machine is
byte-identical.

### Undo that survives a formatting command

A textarea's built-in undo stack is emptied by any programmatic write, and every
formatting command, every Replace and every accepted proposal is one. Manu keeps
its own bounded history: typing coalesces into runs, a run breaks at a pause and
at a paragraph, and a command is always its own step — so ⌘B then ⌘Z undoes the
bold and nothing else.

### Counting

The document's word count sits in the editor's foot; net words written this
session sit in the status bar. The session figure is measured from a baseline
per document and **can go negative**, because a morning spent cutting is work
and a counter that refuses to admit the cut is one nobody should trust.

### Selection tooling

Selecting prose reveals a bar **in the editor's chrome, never floating over the
page**: the selection's word count, four formatting controls, and one **Ask
Manu** disclosure holding the rewrite directives. Nothing there writes anything
— every AI action produces a proposal to review through the staged path in
[AI_EDITING.md](AI_EDITING.md).

### Everything the audit's P0 bought is still here

Front matter is hidden and re-attached byte for byte; selection offsets are
shifted by the hidden block so an AI edit still addresses the file; autosave,
per-keystroke drafts, the close guard and the external-change conflict screen
are unchanged. Formatting and workbench changes are layered over that work,
never through it.

---

## Human-facing story views

- **Manuscript** — the book as a table of contents: chapters in order, by title,
  with word counts read from the files. Numbered by position, because the
  ordering key allows gaps and a reader still calls them One, Two, Three.
- **Outline** — chapters and the scenes inside them. Reordering rewrites the
  chapter's `order` through the ordinary journalled mutation path; it moves a
  chapter's place in the telling and never moves, renames or touches a file.
- **Characters** — a sheet to read while writing a scene: name, role,
  description, what they want, who they are to other people, where they appear.
  **Progressive disclosure is the rule**: a field with nothing in it is not
  shown. An empty "Aliases: —" teaches a writer that Manu is a database with a
  skin on; leaving it out teaches them that Manu shows what is there.
- **Notes** and **Research** — real project folders, presented as documents.
  `cellar_door-ideas.md` is listed as _Cellar door ideas_.

---

## Keyboard first

| Chord             | Does                                  |
| ----------------- | ------------------------------------- |
| `⌘K` / `⌘⇧P`      | Command palette                       |
| `⌘⇧⏎`             | Focus Mode (Esc leaves)               |
| `⌘⇧E` / `⌘⇧I`     | Toggle the left / right dock          |
| `⌘⇧B`             | Story Build                           |
| `⌘⇧F`             | Find in project                       |
| `↑` `↓` `⏎` `Esc` | Move, run, dismiss inside the palette |

The manuscript owns the **unshifted** chords, because a writer's most frequent
action deserves the shortest one: ⌘B is bold, not Story Build.

The **command palette** is how Manu stays visually minimal without losing power.
Every panel, every preset, Focus Mode, the manuscript's appearance, the theme,
providers and closing the project are all one search away, which is what lets
the top bar hold two controls instead of eight.

---

## Chrome

**Top bar:** the wordmark, the project, and two controls — Commands and a ⋯ menu
holding presets, manuscript appearance, versions, providers, theme and close.
A row of equal-weight buttons is a menu bar that forgot it was one.

**Status bar:** word count, net words this session, the current activity line
when there is one, and the version. Nothing else. It is a status bar, not a
miniature diagnostics dashboard.

**Startup:** reopening a project restores the document that was open and the
caret's place in it, per project. A project opened for the first time lands on
its first chapter. Nobody is made to walk through project management to reach
their words.

---

## Accessibility

- Every interactive control is a real `<button>`, `<input>` or `<select>` and
  reachable by keyboard. The dock splitters are `role="separator"` and resizable
  with the arrow keys.
- **One focus treatment** across the app: a double ring whose inner band is the
  surface behind the control, so it stays visible on any background.
- Tabs carry `role="tab"` / `aria-selected`; the palette is a `listbox` with
  `aria-activedescendant`; errors are `role="alert"`; agent activity is
  `aria-live="polite"`.
- Native form controls take `accent-color`, so no browser default can put a
  fifth colour on screen.
- Icon-only controls carry an accessible name; `prefers-reduced-motion` is
  honoured.
- Body and muted text clear 4.5:1 in both themes; accent-toned _text_ uses
  `--manu-accent-text` ([BRAND.md](BRAND.md)).
- **No meaning is carried by colour alone** — severities render a word and a
  glyph as well as a hue.
- **Not yet verified with assistive technology.** No screen-reader pass has been
  performed; this is a practical audit, not a conformance claim.

---

## Empty states

Every empty surface says what would be there and how to put something there —
never a bare "No data". _"No chapters yet. A chapter is a plain file in your
project folder. Make the first one and start writing."_

## First run

One sentence on the start screen, shown once: a project is a folder of plain
files you own; Build checks continuity deterministically and needs no model; a
model proposes and nothing it writes lands without your approval.

There is no splash screen. The window paints the theme's ground colour before
the bundle loads, so it never opens white and snaps.

## Human-first writing mode

The product must remain excellent when the writer wants to write manually. AI
enhances rather than obstructs. A user should be able to write an entire novel
manually while benefiting from the organisational and analytical
infrastructure — **every deterministic system runs with no model configured at
all**, and the start screen says so.

## Not VS Code

Manu borrows IDE _concepts_ — a workspace, commands, panels, agents,
diagnostics, versioning. It does not borrow the look. There is no activity bar
of icons, no breadcrumb trail, no minimap, no terminal, no file tree in the
default arrangement. What Manu is trying to be is a **professional creative
workbench for fiction**, and the nearest visual relatives are a good writing
application and a well-set book.

## Honesty of the interface

- **No fake features.** Do not build controls implying capabilities that do not
  exist; clearly label anything unavailable during development.
- **Explain the system's understanding.** Let the user inspect _why_ the system
  believes something, with evidence and a way to correct it
  ([STORY_STATE.md](STORY_STATE.md)).
- **Approval visibility.** The user always understands what an agent is
  permitted to do ([AGENT_RUNTIME.md](AGENT_RUNTIME.md)).
- **Recorded and read are told apart**, always and visibly
  ([STORY_COMPILER.md](STORY_COMPILER.md)).

## Command palette / writing terminal

The palette covers navigation, workspace and application commands today. The
command-language for structured operations remains **PLANNED**:

```
/inspect character mara      /outline chapter 17      /draft scene SCENE_0041
/rewrite SCENE_0041 --dialogue-only   /continuity act2   /trace clue bloody_watch
/build   /debug betrayal_marcus       /refactor "make Mara the detective"
```

Non-technical users must be able to perform the same actions through graphical
controls.

## Story Health Dashboard (later)

A project dashboard may surface diagnostic signals (word count, chapter lengths,
POV distribution, plot-thread activity, unresolved threads, continuity warnings,
pacing estimates, dialogue percentage, reader-sim results, test status). Never
present subjective metrics as literary quality — use them as diagnostics.
