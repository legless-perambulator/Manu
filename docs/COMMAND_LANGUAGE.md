# COMMAND LANGUAGE

The writing terminal and the command language behind it: concise, typed access
to Manu's real story systems.

- **Packages:** `@jellytind/command-language` (registry, parser, resolution,
  completion, help, history, chains), bound to workflows in the desktop app's
  `lib/commands.ts` and rendered by the Terminal panel
- **Status (Phase 39):** implemented and tested. A typed command registry
  shared with the command palette, entity resolution with ambiguity handling,
  contextual autocomplete, concise help, bounded history, bounded command
  chains, and a standard command set over the real workflows.

## The premise

A power user should be able to type `/inspect Mara` and be looking at Mara's
record, or `/build chapter 17` and be looking at the chapter builder primed on
chapter seventeen. **This is not a fake terminal that forwards text to an
LLM.** Every line is parsed by a purpose-built parser against a typed registry;
every command is backed by an existing structured operation; and a line that
does not parse fails with the command's usage, before anything runs.

## One registry

A command is a spec — id, aliases, arguments, options, permission, whether it
may appear in a chain — registered once in a `CommandRegistry`. The parser
validates against it, autocomplete reads it, `/help` renders it, and **the
command palette lists it** (§6): every no-argument command appears in ⌘K and
runs through exactly the same executor. There are not two action systems.

Skills register into the same registry (§12): every built-in and custom skill's
`/command` — `/character-pass`, `/dialogue-pass`, `/pacing-audit`, or a
writer's own `/murder-mystery-audit` — becomes a command on equal terms, and a
module's skill arrives and leaves with its module.

## Safe parsing, no shell

There is no shell underneath (§16). The only syntax is the command word,
whitespace, double quotes for phrases, and `--option[=value]`. `;`, `|`, `$`,
backticks and everything else a shell would interpret are ordinary text:
`/find $(rm -rf /)` searches the manuscript for that string. Command, argument
count, choice values, options and entity references are all validated before a
handler runs.

## Entity resolution

Writers type names, not IDs (§3). `Mara` resolves to `CHAR_0019` by exact,
word or prefix match, with underscores and spaces treated alike
(`missing_photograph` ≈ "Missing Photograph"). When two Maras exist the
terminal shows both candidates rather than guessing; choosing one re-runs the
line with the stable ID, which always resolves. Chapters resolve by the
1-based number a writer uses, by title, or by ID.

## Autocomplete, help, history

Completion is contextual (§4): `/tr` offers `/trace`; `/trace th` offers
`thread` because that is the spec's choice list; `/trace thread ` offers the
project's actual threads. `/help` is one line per command; `/help refactor`
adds arguments, options and — for staged commands — the reminder that nothing
applies in the terminal. History (§10) is a bounded local list with arrow-key
navigation; lines carrying an option marked `sensitive` are never stored, and
command _output_ is never stored.

## The standard command set

Every command launches a real workflow. A selection:

| Command                                 | What it really does                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| `/inspect Mara`                         | Resolves the name, selects the entity, opens its record                                |
| `/open chapter 12`                      | Opens the chapter's manuscript file                                                    |
| `/find brass key`                       | Seeds Find in project with the query                                                   |
| `/build` · `/build chapter 17`          | Opens Story Build, or the persistent chapter builder pre-selected on that chapter (§9) |
| `/debug betrayal Marcus`                | Hands the Story Debugger its own `/debug` fast path — the deterministic evidence run   |
| `/trace thread …` / `fact …`            | Selects the thread or fact in its owning panel; `clue` needs the Mystery module        |
| `/story-map Mara`                       | Opens the Story Map focused on her arc (§13: output that is a view opens as a view)    |
| `/refactor Move vault …`                | Seeds the Restructure workflow's instruction — the natural-language bridge (§7)        |
| `/branch darker-ending`                 | Opens Versions with the name ready to create                                           |
| `/character-pass Mara` etc.             | Seeds the Passes panel with the pass ready to run                                      |
| `/word-count`, `/focus`, `/new scene …` | Practical writing actions with no AI in them (§14)                                     |

## The terminal does not bypass safety

Permissions are part of the spec (§8): `read`, `open`, `workflow`, and
`stage`. A `stage` command — `/refactor` — opens the workflow that owns
analyse → preview → stage → approve and seeds its input; the terminal never
applies such a change, and `/help` says so on the command itself. Pipeline
commands (§9) launch the persistent builder UI rather than holding a build in
the terminal's own session.

## Chains, bounded

`/build then /continuity-audit then /dialogue-pass` runs a validated sequence
(§11): every step must be a registered, chainable command, the whole chain
parses before any step runs, at most eight steps, no conditionals, no loops,
no variables. An error or an ambiguity stops the chain, and a step that opens
a staged workflow ends it — approval belongs to the writer. `then` inside
prose (`/debug why Marcus then betrays Elias`) is left alone: it only
separates when the next word starts a command.

## Keyboard-first

⌘` opens the terminal from anywhere; ⌘K opens the palette, which lists the
same commands. Tab accepts a completion, arrows navigate suggestions and
history, and every workflow a command opens was already reachable by
keyboard through the palette — the terminal makes the frequent paths shorter.

## Verification

`packages/command-language/src/command-language.test.ts` covers the parser
(including shell-metacharacter safety), registry validation, resolution and
ambiguity, completion, help, history and chains.
`apps/desktop/src/lib/commands.test.ts` walks the §17 acceptance scenario —
`/inspect Mara`, `/trace thread missing_photograph`, `/debug betrayal Marcus`,
`/build chapter 17`, `/branch darker-ending`, `/refactor Move vault discovery
to Chapter 18` — asserting each launches its real corresponding workflow.
