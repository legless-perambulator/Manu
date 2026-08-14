# ALPHA TEST CHECKLIST

For the human tester, after Phase 30.5B2. Deliberately short.

This covers what could **not** be tested automatically — chiefly anything
crossing the Tauri IPC boundary, which needs a real running app. Everything
below the line marked _automated_ is already covered by
`pnpm check` (1167 TypeScript tests + 9 Rust tests) and does not need
re-checking by hand.

Build: `pnpm build:desktop` →
`apps/desktop/src-tauri/target/release/bundle/appimage/Manu_0.1.0-alpha_amd64.AppImage`

---

## 1. The workflow that previously failed

This is the sequence the Phase 20.5 test and the audit both broke on. Do it
first; if any step fails, stop and report.

| #   | Step                                                                       | Expected                                                                                              |
| --- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | Launch the AppImage by double-clicking it, from any folder                 | Manu opens to the start screen                                                                        |
| 2   | Type a project title with a space in it — `The Black Thorn`                | —                                                                                                     |
| 3   | Choose a folder that **already contains other files** (e.g. `~/Documents`) | —                                                                                                     |
| 4   | Look in that folder                                                        | A single new folder `The Black Thorn/` — **not** 44 loose files scattered among your own              |
| 5   | Look inside `The Black Thorn/`                                             | `.writer/`, `manuscript/`, `story/`, `characters/` and so on                                          |
| 6   | Look at Manu                                                               | You are **in the workspace**, not still on the start screen                                           |
| 7   | Open a chapter in Files and type a few sentences                           | Status by the filename reads `Unsaved`, then `Saved` about a second later. You did not press anything |
| 8   | Close the window **without saving**                                        | It closes — after saving. It should not close instantly on a failed save                              |
| 9   | Relaunch Manu                                                              | The project is under **Recent projects**. Click it                                                    |
| 10  | Open the same chapter                                                      | Your sentences are there                                                                              |

## 2. The P0 — external edits

| #   | Step                                                                    | Expected                                                                   |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | With a chapter open in Manu, open the same `.md` file in another editor | —                                                                          |
| 2   | Change it there and save                                                | —                                                                          |
| 3   | Back in Manu, type one character in that chapter and wait two seconds   | An amber **"This file changed outside Manu"** panel. **Not** a silent save |
| 4   | Expand "What is on disk now"                                            | The other editor's text                                                    |
| 5   | Click **Use the version on disk**                                       | The editor shows the external text; status returns to `Saved`              |
| 6   | Repeat steps 1–3, then click **Keep my version and overwrite**          | Your version is written                                                    |
| 7   | Open History                                                            | The overwritten external text is in the change set — it is recoverable     |

**Any silent overwrite here is a release blocker.**

## 3. Crash recovery

| #   | Step                                                                        | Expected                                                                      |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Type a sentence and, within one second, kill Manu (`pkill -9 manu-desktop`) | —                                                                             |
| 2   | Relaunch, reopen the project and the same file                              | A notice: "Recovered unsaved text from your last session", with your sentence |

## 4. Project creation edge cases

| #   | Step                                                              | Expected                                                 |
| --- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | Create a project with the same title, into the same parent, twice | Second becomes `Title 2/` — no error, no clobber         |
| 2   | Create one with punctuation: `Book #2: The Sequel`                | Folder `Book #2 The Sequel`                              |
| 3   | Create one with a non-Latin title                                 | Folder keeps the characters                              |
| 4   | Cancel the folder picker                                          | Nothing happens; no stray folders anywhere               |
| 5   | Try creating into a folder you cannot write to                    | A readable error; **nothing** left behind in that folder |

## 5. Open Project hardening

| #   | Step                                                                             | Expected                                                               |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | Open an ordinary folder that is not a Manu project                               | Readable refusal. **The folder is not modified** — check it afterwards |
| 2   | In a real project, corrupt `.writer/project.json` (type junk into it), then open | Readable refusal naming the manifest; project files untouched          |
| 3   | Set `"schemaVersion": 0` in a project manifest and open                          | Refused with "cannot upgrade" — **not** opened                         |

## 6. Backups

| #   | Step                                                                                                                 | Expected                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | Open a project, then look in `<project>/.writer/backups/`                                                            | A `BK_<timestamp>/` folder mirroring your project             |
| 2   | Confirm it contains your manuscript but no `.writer/` contents                                                       | —                                                             |
| 3   | Search for a word you know is in your manuscript                                                                     | Results do **not** include duplicate hits from inside backups |
| 4   | Recovery drill: delete a chapter's text, save, then copy the file back from the newest `BK_` folder with Manu closed | The chapter is restored                                       |

## 7. AI providers

Everything below the connection test is exercised automatically against a fake
transport; what needs a real build is the **network path**, because the packaged
capability allowlist is enforced by the Rust host and cannot be tested from
Node.

| #   | Step                                                                                 | Expected                                                                                                                |
| --- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | Open **Settings → AI providers** with nothing configured                             | Six providers offered: Anthropic, Google Gemini, OpenAI, OpenRouter, then Ollama and OpenAI-compatible marked **Local** |
| 2   | Add **Ollama** without a running server and press **Test connection**                | "Cannot reach Ollama at localhost:11434." — a sentence, not a `TypeError`                                               |
| 3   | Start Ollama locally, press **Test connection**, then **Refresh models**             | A model count, then your pulled models listed, with `tools?` and `structured output?` marked unknown                    |
| 4   | Point the address at Ollama on **another machine** (`http://<host>:11434`) and test  | It connects. This is the packaging fix — it would have failed in the previous build                                     |
| 5   | Set the address to something on an unusual port, e.g. `http://10.0.0.4:8080`         | A warning appears **before** you test, explaining the restriction is deliberate                                         |
| 6   | Add a hosted provider you have a key for, save the key, test                         | Connects. Reopen Settings — the key field says a key is stored, and never shows it                                      |
| 7   | Under **Which model does what**, set only **Default**                                | Every other purpose says "Use the default"                                                                              |
| 8   | Set **Prose and drafting** to a different connection's model, then run an AI rewrite | It uses that model                                                                                                      |
| 9   | Remove a connection                                                                  | It disappears, and any purpose pointing at it is cleared                                                                |
| 10  | If you upgraded from a build that already had an Anthropic key: open Settings        | An "Anthropic" connection is already there and **still works without re-entering the key**                              |

Two things to check by inspection, because they are the point of the phase:

- `grep -ri "sk-" ~/.config/manu` and your project folder should find **nothing**.
  Keys belong to the OS credential store.
- Nothing in the interface should suggest a ChatGPT Plus or Claude Pro
  subscription can be used. If you find such a claim, that is a bug.

---

## Already automated — no manual check needed

Provider wire formats, streaming, tool calls, structured-output rejection,
HTTP-error mapping, model discovery for all three response shapes, connection
tests, capability honesty, the legacy Anthropic settings migration, and the
consistency of the packaged capability allowlist with the shipped providers.
External-change detection and resolution, folder-name derivation (Unicode,
reserved names, punctuation, collisions), atomic-creation failure injection and
cleanup, schema version handling (0, −3, 1, 99), backup capture/prune/restore
and the copy-only guarantee, prose round-trip across restart, path traversal and
separator rejection in the Rust host, branch isolation, story state after
restart, transaction rollback.

## Known limitations in this build

Out of scope for 30.5B2 and expected — please do not file these:

- The interface is still the light Paper theme. The Dark Manu direction is a
  later wave.
- A model server on a port other than 11434 or 1234, on a machine that is not
  this one, is refused by the packaged capability allowlist. This is deliberate
  and explained in the interface (docs/MODEL_ROUTER.md — "Network scope").
- Gemini does not stream: the reply arrives complete rather than word by word.
- No cost tracking or spend limits.
- No manuscript export (MANU-019).
- No filesystem watching: an external change is detected when Manu next writes,
  not the moment it happens.
- Search matches whole words only — `Zephyr` will not find `Zephyrword`
  (MANU-010).
