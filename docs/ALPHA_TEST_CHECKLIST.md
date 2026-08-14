# ALPHA TEST CHECKLIST

For the human tester, after Phase 30.5B4. Two sections: the path that has to
work, and the engine underneath it. Deliberately short — a checklist nobody
finishes protects nothing.

Everything here needs a **real running application**. What can be tested without
one already is: `pnpm check` runs 1244 TypeScript tests and 9 Rust tests, and CI
runs the same plus a packaging build and a headless launch.

**Build**

```
pnpm run build:desktop
```

→ `apps/desktop/src-tauri/target/release/bundle/appimage/Manu_0.1.0-alpha_amd64.AppImage`

---

## Part one — the path that has to work

Stop and report if any of these fails. Everything else can wait.

| #   | Step                                                                           | Expected                                                                                  |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 1   | Launch the AppImage by double-clicking it, from any folder                     | Manu opens **dark** — near-black ground, grey panels, one small red caret in the wordmark |
| 2   | Look at the start screen                                                       | New project on the left, Open on the right, Settings top-right. No scrolling needed       |
| 3   | Type `Test Novel` and read the line under the button                           | It names the folder it will create: `Test Novel/`                                         |
| 4   | Press **Choose a folder…** and pick a folder that already contains other files | —                                                                                         |
| 5   | Look in that folder                                                            | One new folder, `Test Novel/` — **not** loose files among your own                        |
| 6   | Look at Manu                                                                   | You are in the workspace, project name in the title bar                                   |
| 7   | Files → `manuscript` → open the chapter                                        | Prose, in a serif, in a comfortable column. **No `---` or `id:` at the top**              |
| 8   | Write several paragraphs                                                       | The word by the chapter title reads `Unsaved`, then `Saved` about a second later          |
| 9   | Close the window without saving                                                | It closes — after saving                                                                  |
| 10  | Relaunch and click the project under **Open a project**                        | It opens                                                                                  |
| 11  | Open the same chapter                                                          | Your paragraphs are there                                                                 |
| 12  | Settings → add a provider → save a key → **Test connection**                   | A sentence you can act on, either way                                                     |
| 13  | Agent tab → ask something about the project, e.g. "Which scenes is Mara in?"   | An answer with sources under **From the project**, interpretation kept separate           |
| 14  | Context tab → pick a scene                                                     | What would be sent, and why each item was chosen                                          |
| 15  | Select a paragraph → run an AI rewrite                                         | A proposal, not a change                                                                  |
| 16  | Look at the diff                                                               | Before and after, hunk by hunk                                                            |
| 17  | Reject one hunk, accept another                                                | Only the accepted text lands in the chapter                                               |
| 18  | Verify → **Story Build**                                                       | Counts, then diagnostics with severity, evidence and somewhere to click                   |
| 19  | Quit and reopen                                                                | The build, the project and the prose are all still there                                  |

**Any silent loss of prose in steps 8–11 is a release blocker.**

## Part two — the engine

Worth an hour if part one passed. Not blocking.

| Area           | Try                                                                     | Expected                                                                                               |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| External edits | Open the chapter elsewhere, change it, save. Type in Manu, wait         | An amber "changed outside Manu" panel with two clearly different choices. **Never a silent overwrite** |
| Crash recovery | Type a sentence, then `pkill -9 manu-desktop` within a second           | On reopening: "Recovered unsaved text from your last session"                                          |
| Backups        | Look in `Test Novel/.writer/backups/`                                   | Timestamped folders mirroring the project                                                              |
| Versions       | Versions → create an alternative → edit prose there → switch back       | Each version keeps its own prose _and_ its own records                                                 |
| Entities       | Entities → add a character, a location, a scene                         | They appear in the Inspector with editable fields                                                      |
| Story State    | Record a state change on a scene, then ask State about an earlier scene | The earlier answer does not include the later change                                                   |
| Story Tests    | Write a deterministic test, run the build                               | Pass/fail with expected vs actual. Semantic tests say **not evaluated** — that is correct              |
| Debug          | Verify → Debug → pick a mode                                            | Deterministic evidence, then interpretation, kept visibly apart                                        |
| Refactor       | Change → Refactor → rename a character                                  | Impact → plan → staged changes → diff → apply, with nothing applied before you say so                  |
| Modules        | Story → Modules                                                         | Mystery is marked as having a dedicated engine; the rest as records and checks                         |
| Layout         | ⌘⇧E and ⌘⇧I, then Commands → "Manuscript only"                          | Side columns come and go; the editor stays usable; the choice survives a restart                       |
| Appearance     | Status bar → Paper, then Manu Dark                                      | Both are legible; the choice survives a restart                                                        |
| Compact        | Resize to roughly 1280×800                                              | Still usable; panels narrow before anything is lost                                                    |

## Known limitations

Expected in this build — please do not file these:

- **No export.** No way yet to get a finished manuscript out as DOCX, EPUB or a
  single Markdown file (MANU-019).
- **Search matches whole words.** `Zephyr` will not find `Zephyrword`
  (MANU-010).
- **Semantic story tests are recorded, never evaluated.** They say so.
- **A model server on an unusual port** is refused by the packaged
  application's network allowlist. Loopback on any port works; elsewhere on your
  network, only ports 11434 (Ollama) and 1234 (LM Studio). Deliberate — see
  docs/MODEL_ROUTER.md.
- **Gemini does not stream**; its replies arrive complete.
- **No cancellation** for some long model operations, and no progress bar for
  multi-minute runs (MANU-023, MANU-024).
- **Settings live in webview storage** (MANU-018). Clearing site data would
  reset provider configuration. Nothing in a project depends on it.
- **No file watching.** An external change is noticed when Manu next writes, not
  the moment it happens.
- Accessibility has had a practical pass but **no assistive-technology testing**
  (MANU-026).
