# UX

The interface should feel more like an IDE than a chat application. Chat is a
tool inside the environment, not the dominant metaphor.

- **App:** `apps/desktop` (Tauri 2 + React 18 + Vite)
- **Status (Phase 20.5):** the workspace is **implemented and branded**. Fifteen
  panels grouped into four, a manuscript pane set as prose, a three-tab
  inspector, a command palette, a keyboard layer, two themes, and one token
  system every surface draws from. Visual language is defined in
  [BRAND.md](BRAND.md).

## Primary layout

```
┌──────────────────────────────────────────────────────────────┐
│ manu|  The Blackthorn Inheritance      Commands ⌘K  …         │
├──────────────┬────────────────────────────┬──────────────────┤
│ PROJECT STORY│                            │ Inspector        │
│ VERIFY CHANGE│                            │ Agent            │
├──────────────┤       Manuscript           │ Context          │
│ Files        │       (centre)             │                  │
│ Entities     │                            │                  │
│ Search       │                            │                  │
│ History      │                            │                  │
├──────────────┴────────────────────────────┴──────────────────┤
│ PROJ_… · schema v1      rewrite scene…            Appearance  │
└──────────────────────────────────────────────────────────────┘
```

**The manuscript is the centre and it is what survives every narrowing.** As the
window shrinks, the side columns give up width, then the inspector folds away,
then the sidebar; the prose keeps the middle throughout.

### Left — grouped panels

Fifteen panels in one flat strip is a list of features, not a workspace. They
are grouped by the question a writer is asking, in
[`lib/panels.ts`](../apps/desktop/src/lib/panels.ts) — one registry that feeds
the sidebar, the palette and the shortcuts, so a panel can never appear in one
and be missing from another.

| Group       | Panels                                                       | The question               |
| ----------- | ------------------------------------------------------------ | -------------------------- |
| **Project** | Files · Entities · Search · History                          | What is here?              |
| **Story**   | State · Knowledge · Relations · Objects · Threads · Timeline | What is true, and when?    |
| **Verify**  | Build · Tests · Debug                                        | What can be checked?       |
| **Change**  | Causality · Refactor                                         | What would a change reach? |

### Centre — the manuscript

Prose under `manuscript/` is set in a **serif at a 72-character measure with
generous leading**, with spellcheck on. Records and JSON are set in monospace.
The manuscript is the thing being made; it should not look like the tooling
around it.

Inline AI lives in a bar above the text and still runs through the
[Context Compiler](CONTEXT_COMPILER.md) — it must not become a disconnected
miniature chatbot.

### Right — Inspector · Agent · Context

Context-sensitive: the record behind the selection, the agent, and exactly what
a model would be given.

The **Agent panel is tooling, not a chat window**. There is no conversation, no
message bubbles and no personality: a field, an `Investigate` verb, a compact
step-counted activity log of which tool ran against what, and then an answer
that keeps _From the project_ separate from _Model interpretation — not project
canon_. Private model reasoning is never requested, stored or displayed.

### Bottom — status bar

Project ID, schema version, the current activity line, and the appearance
control. It is a status bar, not a terminal: long-running work reports here in
one line.

## Keyboard first

| Chord             | Does                                  |
| ----------------- | ------------------------------------- |
| `⌘K` / `Ctrl+K`   | Command palette                       |
| `⌘⇧P` / `Ctrl+⇧P` | Command palette (alias)               |
| `⌘B` / `Ctrl+B`   | Build                                 |
| `⌘⇧F` / `Ctrl+⇧F` | Search                                |
| `⌘S` / `Ctrl+S`   | Save the open file                    |
| `↑` `↓` `⏎` `Esc` | Move, run, dismiss inside the palette |

The **command palette** lists every panel, every inspector and every global
action with a line saying what it is for. It is what makes grouping the sidebar
cost nobody a click: any panel is two keystrokes and a word away.

## Accessibility

- Every interactive control is a real `<button>`, `<input>` or `<select>` and
  reachable by keyboard.
- **One focus treatment** across the app: a double ring whose inner band is the
  surface behind the control, so it stays visible on any background including
  the accent-filled primary button.
- Tabs carry `role="tab"` / `aria-selected`; the palette is a `listbox` with
  `aria-activedescendant`; errors are `role="alert"`; agent activity is
  `aria-live="polite"`.
- Icon-only controls carry an accessible name.
- `prefers-reduced-motion` is honoured.
- Body and muted text clear 4.5:1 in both themes; accent-toned _text_ uses
  `--manu-accent-text` for the same reason ([BRAND.md](BRAND.md)).
- **No meaning is carried by colour alone** — severities render a word and a
  glyph as well as a hue.

## Empty states

Every empty surface says what would be there and how to put something there —
never a bare "No data". _"Nothing open. Pick a chapter in Files to start
writing, or press ⌘K to go anywhere in the project."_

## First run

A short orienting panel on the start screen, shown once: a project is a folder
of plain files you own; Build checks continuity deterministically and needs no
model; a model proposes and nothing it writes lands without your approval. Then
it is dismissed and never returns.

There is no splash screen. The window paints the theme's ground colour before
the bundle loads, so it never opens white and snaps — restraint rather than a
brand moment on every launch.

## Human-first writing mode

The product must remain excellent when the writer wants to write manually. AI
enhances rather than obstructs. A user should be able to write an entire novel
manually while benefiting from the organisational and analytical
infrastructure — **every deterministic system runs with no model configured at
all**, and the start screen says so.

## Command palette / writing terminal

The palette covers navigation and application commands today. The
command-language for structured operations remains **PLANNED**:

```
/inspect character mara      /outline chapter 17      /draft scene SCENE_0041
/rewrite SCENE_0041 --dialogue-only   /continuity act2   /trace clue bloody_watch
/build   /debug betrayal_marcus       /refactor "make Mara the detective"
```

Non-technical users must be able to perform the same actions through graphical
controls.

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

## Story Health Dashboard (later)

A project dashboard may surface diagnostic signals (word count, chapter lengths,
POV distribution, plot-thread activity, unresolved threads, continuity warnings,
pacing estimates, dialogue percentage, reader-sim results, test status). Never
present subjective metrics as literary quality — use them as diagnostics.
