# MANU FULL PRODUCT AUDIT — Phase 30.5A

**Overall Alpha Readiness: LIMITED**

| Severity | Count |
| -------- | ----- |
| P0       | 1     |
| P1       | 6     |
| P2       | 9     |
| P3       | 11    |
| P4       | 6     |

Audited at commit `022130c` (Phase 30 complete). Audit-only: no product code was
changed. Two temporary diagnostic harnesses were created, executed and deleted;
the working tree is clean.

---

## What was and was not actually exercised

This matters more than any single finding, because the honest scope of an audit
is part of its result.

**Genuinely executed:**

- Full toolchain: install, typecheck, lint, format check, 1079 tests.
- A real production `tauri build` → AppImage + deb, from clean.
- **The built AppImage was launched headlessly under Xvfb from an unrelated
  working directory and screenshotted.** It runs. This is the real artefact, not
  `npm run dev`.
- Real-filesystem behaviour via `NodeProjectStore` + `StoryRepository`: project
  creation, atomicity, corruption, restart, branching, search, story state,
  compiler rules against planted defects.

**Not exercised, and therefore not claimed either way:**

- Interactive GUI flows (clicking through New Project → workspace → editing).
  There is no input-injection tooling here; I have one static frame.
- Any live provider call. No API key, and the network is proxied.
- Read-only-directory failure. **The container runs as UID 0**, so `chmod 0500`
  is bypassed and my read-only test result is meaningless. Reported as untested,
  not as a pass.
- macOS/Windows behaviour, keychain behaviour on a real desktop session.
- Multi-hour/large-manuscript performance (no fixture of that size exists).

Findings below are marked **VERIFIED** (executed), **READ** (established by
source inspection), or **UNTESTED**.

---

## Executive conclusions

**1. The engine is real; the application around it is thin.** This is the
single most important sentence in the audit. The story-intelligence packages are
genuinely implemented, genuinely deterministic and genuinely tested — branching
isolates structured state as well as prose, story state replays identically
after restart, the compiler caught 4 of 5 planted defects, transaction rollback
leaks nothing. That is a real achievement and unusual at this stage. But the
_product_ wrapped around it has holes that would lose a writer's work in the
first hour.

**2. There is one P0, and it is a manuscript-loss path.** Manu silently
overwrites external edits to its own files, with no file watching, no mtime
check and no conflict detection — in a product whose central promise is "a
folder of plain files you own". Combined with no autosave and no close guard,
there are three independent ways to lose prose.

**3. Project creation does the wrong thing on disk.** Picking
`~/Documents/Novels` and typing "The Black Thorn" does **not** create
`Novels/The Black Thorn/`. It scatters 44 files and directories directly into
`Novels/`. I verified it will do this into a folder containing the user's tax
return and photos. Only one project can ever exist per folder.

**4. Provider support is one provider, hard-coded, with a stale catalogue.**
"Provider-independent" is true of the _architecture_ and false of the _product_:
exactly one adapter exists (Anthropic), offering three superseded model IDs, with
no discovery mechanism, and the Tauri capability allowlist scopes network access
to `api.anthropic.com` alone — so no other provider could reach the network even
if an adapter existed.

**5. The SQLite derived index is dead code.** It is built and unit-tested, and
the desktop app never constructs one. Search works by scanning files.

**6. The current interface is the opposite of the stated visual direction.** The
default theme resolves to Paper on any desktop reporting `prefers-color-scheme:
light`, and the primary call-to-action is a full-width solid Manuscript Red
block. The brief asks for a dark editorial studio with restrained red.

**7. Agent grounding is prompt-only.** The answer _shape_ is validated;
the cited `sources` are never checked against IDs the tools actually returned.

---

## Feature matrix

Status vocabulary as specified. "Functional" means verified to do the thing, not
that an interface exists.

| System                            | Claimed        | Implemented     | Functional                           | Persisted | UI Complete           | Tested                      | Status                        |
| --------------------------------- | -------------- | --------------- | ------------------------------------ | --------- | --------------------- | --------------------------- | ----------------------------- |
| Story Repository (files)          | Y              | Y               | Y                                    | Y         | Y                     | Y                           | **COMPLETE**                  |
| SQLite derived index              | Y              | Y               | **N — never constructed**            | N         | N/A                   | Y                           | **SCAFFOLDED**                |
| Migrations                        | Y              | Partial         | **N — v0 opens unmigrated**          | N/A       | N                     | Partial                     | **SCAFFOLDED**                |
| Project creation                  | Y              | Y               | **Wrong on-disk shape**              | Y         | Partial               | Partial                     | **FUNCTIONAL BUT INCOMPLETE** |
| Open / validate project           | Y              | Y               | Y                                    | Y         | Y                     | Y                           | **COMPLETE**                  |
| Manuscript editing                | Y              | Y               | Y                                    | Y         | **No autosave/guard** | Partial                     | **FUNCTIONAL BUT INCOMPLETE** |
| External-edit safety              | Y (implied)    | **N**           | **N**                                | N         | N                     | N                           | **NOT IMPLEMENTED**           |
| Entities + graph integrity        | Y              | Y               | Y                                    | Y         | Y                     | Y                           | **COMPLETE**                  |
| Search                            | Y              | Y               | Y (no prefix match)                  | Y         | Y                     | Y                           | **FUNCTIONAL BUT INCOMPLETE** |
| Versioning / checkpoints / diff   | Y              | Y               | Y                                    | Y         | Y                     | Y                           | **COMPLETE**                  |
| Branching                         | Y              | Y               | **Y — full isolation verified**      | Y         | Y                     | Y                           | **COMPLETE**                  |
| Model router (abstraction)        | Y              | Y               | Y                                    | Y         | Y                     | Y                           | **COMPLETE**                  |
| Anthropic provider                | Y              | Y               | UNTESTED live                        | Y         | Y                     | Y (mocked)                  | **FUNCTIONAL BUT INCOMPLETE** |
| Any other provider                | Y (docs imply) | **N**           | **N**                                | N         | N                     | N                           | **NOT IMPLEMENTED**           |
| Model discovery                   | Y              | **N**           | **N**                                | N         | N                     | N                           | **NOT IMPLEMENTED**           |
| Secret storage                    | Y              | Y               | Y                                    | Y         | Y                     | **N (Rust untested in CI)** | **FUNCTIONAL BUT INCOMPLETE** |
| Agent runtime + tools             | Y              | Y               | Y                                    | Y         | Y                     | Y                           | **FUNCTIONAL BUT INCOMPLETE** |
| Agent grounding enforcement       | Y              | **Prompt-only** | **N**                                | N/A       | N                     | N                           | **PARTIALLY WIRED**           |
| Context Compiler                  | Y              | Y               | Y                                    | N/A       | Y                     | Y                           | **COMPLETE**                  |
| AI editing (propose/review/apply) | Y              | Y               | Y                                    | Y         | Y                     | Y (mocked)                  | **COMPLETE**                  |
| Story State                       | Y              | Y               | **Y — restart-identical**            | Y         | Y                     | Y                           | **COMPLETE**                  |
| Knowledge / belief                | Y              | Y               | Y                                    | Y         | Y                     | Y                           | **COMPLETE**                  |
| Relationships                     | Y              | Y               | Y                                    | Y         | Y                     | Y                           | **COMPLETE**                  |
| Timeline / chronology             | Y              | Y               | Y                                    | Y         | Y                     | Y                           | **COMPLETE**                  |
| Objects / locations               | Y              | Y               | Y                                    | Y         | Y                     | Y                           | **COMPLETE**                  |
| Plot threads / setups             | Y              | Y               | Y                                    | Y         | Y                     | Y                           | **COMPLETE**                  |
| Story Compiler                    | Y              | Y               | **Y — 12 rules, 4/5 planted caught** | Y         | Y                     | Y                           | **COMPLETE**                  |
| Story Tests (deterministic)       | Y              | Y               | Y                                    | Y         | Y                     | Y                           | **COMPLETE**                  |
| Story Tests (semantic)            | Y              | Shape only      | **Never evaluated**                  | Y         | Y                     | Y                           | **SCAFFOLDED**                |
| Story Debugger                    | Y              | Y               | Y                                    | Y         | Y                     | Y                           | **FUNCTIONAL BUT INCOMPLETE** |
| Causality / blast radius          | Y              | Y               | Y                                    | Y         | Y                     | Y                           | **COMPLETE**                  |
| Story Refactor                    | Y              | Y               | UNTESTED end-to-end in UI            | Y         | Y                     | Y                           | **FUNCTIONAL BUT INCOMPLETE** |
| Author Voice                      | Y              | Y               | Y                                    | Y         | Y                     | Y                           | **COMPLETE**                  |
| Character Voice                   | Y              | Y               | Y                                    | Y         | Y                     | Y                           | **COMPLETE**                  |
| Specialist agents                 | Y              | Y               | Y (grants enforced)                  | Y         | Y                     | Y                           | **COMPLETE**                  |
| Writing Skills                    | Y              | Y               | Y (34 ops, resumable)                | Y         | Y                     | Y                           | **COMPLETE**                  |
| Orchestration                     | Y              | Y               | Y                                    | Y         | Y                     | Y                           | **COMPLETE**                  |
| Reader Simulator                  | Y              | Y               | Needs live model                     | Y         | Y                     | Y                           | **FUNCTIONAL BUT INCOMPLETE** |
| Character Simulator               | Y              | Y               | Deterministic half only              | Y         | Y                     | Y                           | **FUNCTIONAL BUT INCOMPLETE** |
| Mystery Engine                    | Y              | Y               | Y                                    | Y         | Y                     | Y                           | **COMPLETE**                  |
| Genre Modules                     | Y              | Y               | **Y — verified in AppImage**         | Y         | Y                     | Y                           | **COMPLETE**                  |
| Onboarding / recents              | Y (implied)    | **N**           | **N**                                | N         | N                     | N                           | **NOT IMPLEMENTED**           |
| AppImage packaging                | Y              | Y               | **Y — launches verified**            | Y         | N/A                   | **N**                       | **FUNCTIONAL BUT INCOMPLETE** |

---

## Issue register

### P0

#### MANU-001 — External edits to project files are silently overwritten

- **Symptom:** A writer edits `manuscript/CHAPTER_0001.md` in another editor.
  Manu later writes the file and the external edit is gone. No warning, no
  conflict, no backup.
- **Reproduction (VERIFIED):** Create project → write chapter via Manu → modify
  the same file externally → write via Manu again → external content is gone.
  Harness output: `External edit silently clobbered by Manu? true`.
- **Expected:** Detect that the file changed underneath (mtime/hash), refuse or
  offer a merge, and never destroy unseen content.
- **Actual:** Last writer wins, silently.
- **Root cause:** No file watching and no read-before-write validation anywhere
  in the stack. `ProjectStore.writeFile` is unconditional at every layer:
  `NodeProjectStore.writeFile`, `project_fs.rs::write_atomic_impl`, and
  `TauriProjectStore.writeFile` all write whatever they are given. Atomicity is
  implemented (temp + rename); _concurrency_ is not. The repository holds no
  version stamp per file to compare against.
- **Affected:** `packages/persistence/src/node/node-project-store.ts`,
  `apps/desktop/src-tauri/src/project_fs.rs`,
  `apps/desktop/src/repo/tauri-project-store.ts`,
  `packages/story-repository/src/journaled-store.ts`.
- **Data risk:** **CRITICAL — silent, unrecoverable manuscript loss.** This is
  the direct contradiction of the product's central promise ("a folder of plain
  files you own"), because owning the files is precisely what invites people to
  open them elsewhere.
- **Remediation direction:** Record a content hash or mtime per file at read;
  verify before write; on mismatch raise a typed conflict the UI must resolve.
  A file watcher is the fuller answer but the write-side check is the safety net.
- **Dependencies:** None. Fix first.

### P1

#### MANU-002 — New Project does not create a project folder

- **Symptom:** Selecting `~/Documents/Novels` and entering "The Black Thorn"
  writes the repository directly into `Novels/`, not `Novels/The Black Thorn/`.
- **Reproduction (VERIFIED):** Harness `[A5]` — 44 entries created in the picked
  directory; `Created a 'The Black Thorn/' subfolder? false`.
- **Expected:** Create `<picked>/<title>/` and place the repository inside it.
- **Actual:** The picked directory _becomes_ the project root. Verified that this
  happens even when the directory already contains unrelated user files
  (`tax-return-2025.pdf`, `Photos/`) — they are left in place but now sit inside
  a Manu project.
- **Root cause:** `createProjectAt(root, title)` in `apps/desktop/src/repo/session.ts`
  passes the picked path straight to `new TauriProjectStore(root)` and
  `StoryRepository.createProject({ rootPath: root })`. The title is used only for
  the manifest. No directory is derived from it.
- **Affected:** `apps/desktop/src/repo/session.ts`,
  `apps/desktop/src/components/StartScreen.tsx`.
- **Data risk:** No loss, but severe hygiene damage and confusion; a second
  project into the same parent fails with `already_exists`.
- **Remediation direction:** Derive a sanitised folder name from the title,
  create it, refuse if non-empty, and pass _that_ as root. Needs a name-collision
  and illegal-character policy.
- **Dependencies:** Interacts with MANU-003 (atomicity).

#### MANU-003 — Project creation is not atomic; failure leaves debris

- **Symptom:** A failure part-way through creation leaves an unopenable husk.
- **Reproduction (VERIFIED):** Inject a failure on the 4th write. Result: 25
  directories and 3 files on disk, no manifest. Reopening gives
  `No project manifest found`.
- **Expected:** Either a complete project or nothing.
- **Actual:** Partial scaffold, no cleanup, no user guidance. Re-creating over it
  does succeed, which is the only mitigation.
- **Root cause:** `scaffoldProject` writes directories and files sequentially with
  no staging directory and no rollback; the manifest is written _last_
  (`story-repository.ts` `createProject`), so any earlier failure leaves an
  unidentifiable folder.
- **Affected:** `packages/story-repository/src/scaffold.ts`,
  `packages/story-repository/src/story-repository.ts`.
- **Data risk:** Moderate on its own; **severe combined with MANU-002**, because
  the debris lands in the user's own directory with no way to tell which of the
  44 entries were Manu's.
- **Remediation direction:** Build into a temp directory and rename into place,
  or write the manifest first and clean up on failure.
- **Dependencies:** MANU-002.

#### MANU-004 — No autosave and no close guard: unsaved prose is lost

- **Symptom:** Closing the window with unsaved editor content loses it.
- **Root cause (READ):** `Editor.tsx` is explicitly manual-save (`dirty` state, a
  Save button, a keyboard shortcut). `Workspace.tsx` computes an `unsaved` list
  but uses it **only** to gate branch switching (line ~728). There is no
  `onCloseRequested` handler registered on the Tauri window and no
  `beforeunload` listener anywhere in the app.
- **Affected:** `apps/desktop/src/components/Editor.tsx`,
  `apps/desktop/src/components/Workspace.tsx`,
  `apps/desktop/src-tauri/src/lib.rs`.
- **Data risk:** **HIGH — routine manuscript loss.** A writer who types for
  twenty minutes and closes the window loses twenty minutes.
- **Remediation direction:** Debounced autosave to the journaled store, plus a
  Tauri `onCloseRequested` guard. Autosave is the real fix; the dialog is the
  backstop.
- **Dependencies:** None.

#### MANU-005 — Only one provider exists, and the network allowlist forbids others

- **Symptom:** "Provider-independent" is architecturally true and practically
  false.
- **Root cause (READ):** `apps/desktop/src/lib/models.ts` `buildProviders()`
  returns `[anthropic]` — a hard-coded single-element array. Independently,
  `apps/desktop/src-tauri/capabilities/default.json` scopes `http:default` to
  `https://api.anthropic.com/*`, so **any** other endpoint — OpenAI, Gemini,
  OpenRouter, a local Ollama on `127.0.0.1:11434`, or a custom `baseUrl` — is
  refused by the Tauri capability layer before a request is made. The provider
  interface already accepts `baseUrl`, so this is a packaging-layer block on
  code that is otherwise ready.
- **Affected:** `apps/desktop/src/lib/models.ts`,
  `apps/desktop/src-tauri/capabilities/default.json`.
- **Data risk:** None. Adoption and cost risk only.
- **Remediation direction:** See the Provider Report below. Requires both new
  adapters _and_ a capability strategy for user-configured hosts.
- **Dependencies:** MANU-006.

#### MANU-006 — Model catalogue is hard-coded and stale

- **Symptom:** The settings UI offers three superseded models and cannot learn
  about new ones.
- **Actual (READ):** `packages/providers/anthropic/src/models.ts` offers exactly
  `claude-sonnet-4-5`, `claude-opus-4-1`, `claude-haiku-4-5`. The current
  generation is the Claude 5 family (`claude-opus-5`, `claude-sonnet-5`,
  `claude-fable-5`) alongside `claude-haiku-4-5-20251001`. There is no
  `listModels` call anywhere; refreshing the list requires shipping a build.
- **Root cause:** Catalogue-as-constant with no discovery path on the
  `ModelProvider` interface.
- **Affected:** `packages/providers/anthropic/src/models.ts`,
  `packages/model-router/src/*`.
- **Data risk:** None. Users are steered to older, more expensive models.
- **Remediation direction:** Add optional `discoverModels()` to `ModelProvider`,
  cache results, and keep the static list as an offline fallback. Refresh the
  constants regardless — that part is a one-line-per-model change.

#### MANU-007 — Agent citations are never verified against retrieved data

- **Symptom:** The agent can cite `SCENE_0099` for a statement it invented, and
  the UI renders it as a sourced finding.
- **Root cause (READ):** `packages/agent-runtime/src/answer.ts` validates
  `sources` as "an array of strings" (`asStringArray`) and nothing more. The
  instruction "Do not invent IDs. Every finding must come from a tool result you
  actually received" is prompt text. Nothing compares cited IDs against the set
  of IDs the executor actually returned during the run.
- **Affected:** `packages/agent-runtime/src/answer.ts`,
  `packages/agent-runtime/src/investigator.ts`.
- **Data risk:** No corruption, but it directly undermines the canon/inference
  boundary the product is built on — a fabricated citation is _more_ damaging
  than an uncited guess because it looks verified.
- **Remediation direction:** Have the executor accumulate every entity ID and
  file path returned by tool calls; reject or flag findings whose sources are not
  in that set. This is cheap and turns a prompt promise into an invariant.

### P2

#### MANU-008 — SQLite derived index is never created

- **VERIFIED:** no `.db`/`.sqlite` file exists in a created project.
  `StoryRepository` accepts `options.index` and `session.ts` never passes one.
  The whole `packages/persistence/src/sql` + `node/sqlite.ts` layer, plus the
  index-maintenance code in the repository, is unreachable in production.
- **Impact:** Search and structured queries scan files. Fine at fixture size,
  a likely bottleneck on a real novel. Also: docs describe SQLite as part of the
  architecture, so this is a documentation-vs-reality gap.

#### MANU-009 — Older schema versions open without migration

- **VERIFIED:** a manifest edited to `schemaVersion: 0` **opens successfully**.
  Newer (`99`) is correctly refused with a good message. There is no migration
  registry being applied on open.
- **Impact:** The moment a real schema change ships, old projects will open and
  be interpreted under the wrong assumptions rather than migrated or refused.

#### MANU-010 — Search has no prefix or substring matching

- **VERIFIED:** content `ZEPHYRWORD`; query `ZEPHYRWORD` → 1 hit; query `ZEPHYR`
  → **0 hits**. Case-insensitivity works; index correctly invalidates after edit
  and after restart (no staleness).
- **Impact:** Writers type fragments. A search that only matches whole tokens
  will read as broken.
- _(Note: my special-character probe searched for a string that was not present,
  so it proves nothing and is not reported as a defect.)_

#### MANU-011 — Semantic Story Tests are permanently "not evaluated"

- The assertion shapes exist, the UI lets you write them, and nothing ever
  evaluates them. This is honestly reported as "not evaluated" at runtime, which
  is good practice — but the UI still invites writers to create tests that can
  never pass or fail.

#### MANU-012 — No recent-projects list

- **VERIFIED (screenshot + READ):** the start screen offers New and Open only.
  Every launch requires navigating a native directory picker to the project.
  There is no persisted recents list anywhere in the app.

#### MANU-013 — Rust host code is never tested by the verification pipeline

- `pnpm check` = typecheck + lint + format + vitest. **`cargo test` is not run**,
  and `pnpm build` does not build the Tauri app either. The tests inside
  `project_fs.rs` (path traversal, atomic write) exist and are good, and would
  not catch a regression because nothing runs them.

#### MANU-014 — Credential file is written non-atomically and chmod'd after

- `secrets.rs::write_fallback` does `fs::write` then `set_permissions(0o600)`.
  Between the two the file exists at the process umask (commonly 0644). A crash
  mid-write also truncates the credential store. Keys, not manuscripts, so P2.

#### MANU-015 — Symlinks inside a project can escape the root

- `safe_join` rejects `..` lexically and checks `starts_with(root)` on the
  _unresolved_ path. A symlink inside the project pointing outside it is
  followed. Requires a project from an untrusted source, hence P2 not P1, but the
  path-confinement guarantee is weaker than documented.

#### MANU-016 — Single 941 KB JS bundle, no code splitting

- Build warns explicitly. Affects cold start; every panel for every phase is in
  one chunk.

### P3

- **MANU-017** — Atomic write does not fsync the parent directory after rename;
  the rename may not survive power loss.
- **MANU-018** — Model/routing/theme settings live in webview `localStorage`;
  clearing site data silently resets provider configuration, and settings are not
  portable or backed up.
- **MANU-019** — No export (no compiled manuscript output to DOCX/EPUB/PDF/plain
  Markdown book). For a fiction IDE this is a conspicuous absence.
- **MANU-020** — No backup or snapshot-to-elsewhere; checkpoints live inside the
  same folder that a mistake would damage.
- **MANU-021** — No crash recovery: no journal replay of in-flight editor state.
- **MANU-022** — Keychain fallback to a plaintext file is silent-by-default in
  the sense that it requires the user to read the settings label; on headless or
  keyring-less Linux the API key is plaintext on disk.
- **MANU-023** — No cancellation UI for long model operations in several panels;
  `AbortSignal` is plumbed in the router but not consistently surfaced.
- **MANU-024** — No progress/background-job surface for multi-minute operations
  (Reader Simulator over 20 chapters).
- **MANU-025** — Window `minWidth: 900` is workable on a Steam Deck (1280×800)
  but the workspace is a three-region layout designed for far more width;
  compact-mode behaviour is unverified.
- **MANU-026** — Accessibility unverified: keyboard-only navigation, focus order
  and screen-reader labelling were not exercised (no interactive harness).
- **MANU-027** — First-run intro is dismissed permanently via `localStorage` with
  no way to see it again.

### P4

- **MANU-028** — Deb bundle declares `libwebkit2gtk-4.1-0` and `libgtk-3-0` only;
  runtime deps not otherwise validated.
- **MANU-029** — `AT-SPI` and `libEGL DRI3` warnings on launch (environmental
  here, but will appear in user logs).
- **MANU-030** — Genre "World" panel is a generic schema-driven form; fantasy's
  ten record kinds deserve purpose-built views (already flagged at Phase 30).
- **MANU-031** — `agentById` throws a raw `Error` rather than a typed `AppError`,
  inconsistent with the codebase's error discipline.
- **MANU-032** — No telemetry-free "report a problem" affordance.
- **MANU-033** — Bundle identifier `com.manu.app` is fine, but the AppImage is
  80 MB with no size budget tracked.

---

## UX journey report

**New user → first project.** The AppImage launches (verified). First-run
orientation is genuinely good: three sentences that explain plain files,
deterministic Build, and that AI proposes rather than writes. The template picker
renders correctly with all eight options.

Then the first action goes wrong. "Choose a folder and create" opens a directory
picker, and whatever the writer picks _becomes_ the project. Most people will
pick `Documents` or `Novels` and get 44 entries dumped there (MANU-002). Nothing
warns them. There is no "create a folder for me" affordance and no preview of
what will be created where.

**Returning.** There is no recents list (MANU-012). Every launch is a native
file-dialog navigation to a folder whose name the writer chose but Manu never
created.

**Writing.** The editor is manual-save. There is a dirty dot and a Save button.
Close the window and unsaved work is gone (MANU-004). Open the file in another
editor — the thing the "plain files you own" promise actively encourages — and
Manu will overwrite it (MANU-001).

**AI.** Configuration requires an Anthropic API key specifically; there is no
other option, and the model list offers a previous generation (MANU-005/006).
A writer with a Claude Pro subscription cannot use it (see Provider Report).

**Story intelligence.** This is where the product becomes genuinely impressive
and where the journey stops feeling unfinished. Build, tests, state queries,
branching and the genre modules all work. The gap is discoverability rather than
function: twenty-two panels across four groups, and nothing sequences the writer
from "I have prose" to "I should record state so Build can check it". The
relationship between recording structure and getting value from it is never
taught, and recording it is entirely manual.

**Where the journey breaks, in order:** project creation (immediately),
save/close safety (within minutes), provider choice (at AI setup), and structure
entry (the moment the writer wonders why Build reports nothing).

---

## Provider report

**Actually supported:** Anthropic, one adapter, via the Tauri HTTP plugin so
requests leave from Rust rather than the webview. Streaming (SSE), structured
output and tool calling are all implemented and unit-tested against fake
transports. Not verified live — no key available.

**Not implemented at all:** OpenAI, Google/Gemini, OpenRouter, Ollama, any
OpenAI-compatible endpoint, any local inference server.

**Two independent blockers, and both must be fixed:**

1. `buildProviders()` returns a hard-coded single-element array.
2. The Tauri capability allowlist permits `https://api.anthropic.com/*` only. A
   second adapter would compile, ship, and fail at runtime.

**Model discovery:** none. The catalogue is a constant. Current entries
(`claude-sonnet-4-5`, `claude-opus-4-1`, `claude-haiku-4-5`) are a generation
behind the Claude 5 family.

**Credentials:** OS keychain via the `keyring` crate, with a 0600 file fallback,
and the active backend is reported to the UI rather than assumed — that last
detail is good practice and worth keeping.

**Subscription authentication — what is contractually supportable.** Being
precise, because this is a place where wishful thinking causes real harm:

- **Anthropic (Claude Pro/Max):** there is **no officially supported mechanism**
  for a third-party desktop application to authenticate against a consumer Claude
  subscription and use it for arbitrary API traffic. Claude Pro/Max entitles a
  person to use Anthropic's own surfaces. Third-party programmatic access is via
  the Anthropic API with an API key, billed separately.
- **OpenAI (ChatGPT Plus/Pro):** the same. Plus/Pro is a consumer entitlement;
  third-party applications use the OpenAI API with an API key.
- **What would be legitimate:** an official OAuth flow, _if and when_ a provider
  publishes one for third-party apps. None is available to build against today.
- **What must not be built:** reusing session cookies, driving a headless
  browser against a consumer web app, or any reverse-engineered token flow. These
  break provider terms, break without warning, and put the user's account at
  risk. **Do not implement these.**

The honest product answer is: API keys for hosted providers, plus first-class
local models (Ollama / OpenAI-compatible), which is the genuinely
subscription-free path and the one most under-served today.

**To become genuinely provider-flexible, the minimum is:**

1. A capability strategy for user-configured hosts — a broader allowlist with a
   user-consent step, since a fixed allowlist and "bring your own endpoint" are
   fundamentally in tension.
2. An OpenAI-compatible adapter, which covers OpenAI, OpenRouter, most local
   servers and many hosted vendors in one implementation.
3. An Ollama adapter (or the OpenAI-compatible one pointed at `localhost`) with
   configurable host and health check.
4. `discoverModels()` on `ModelProvider`, cached, with the static list as
   fallback.
5. Per-provider capability metadata that is _honest_ about tool-calling and
   structured-output differences — local models frequently lack both, and the
   Skills/agent layers assume they exist.

---

## Data safety report

> **Would I trust the current build with the only copy of a 100,000-word novel?**

# NO.

**Reason.** Three independent, routine paths lose prose, and none of them
requires anything unusual to happen:

1. **MANU-001** — opening the manuscript in any other editor and then letting
   Manu write leads to silent, unrecoverable loss. The product's own promise
   ("plain files you own") is what encourages the behaviour that triggers it.
2. **MANU-004** — no autosave and no close guard: ordinary window-closing loses
   whatever is unsaved.
3. **MANU-020 / MANU-019** — there is no backup and no export. Checkpoints live
   inside the very folder that a mistake damages, and there is no way to get the
   manuscript out into a portable finished form.

What is genuinely reassuring, and should be said plainly: writes are atomic at
both the Node and Rust layers, transaction rollback leaks nothing (verified),
branching isolates correctly (verified), story state replays identically after
restart (verified), corrupt and future-version manifests are refused with clear
messages rather than "repaired", and a refused open leaves the prose untouched
(verified). The foundations are sound. It is the surrounding product behaviour
that is unsafe.

With MANU-001, MANU-004 and a backup/export path fixed, this verdict would
plausibly flip. Until then: **only ever as a second copy, alongside git or
another backup.**

---

## Architectural debt report

- **Dead subsystem in production.** The SQLite index (MANU-008) is fully built,
  fully tested, and unreachable. Either wire it or delete it; leaving it is how
  documentation and reality drift.
- **Prompt-as-invariant.** Agent citation grounding (MANU-007) is enforced by
  asking the model nicely. This is the one place the codebase's otherwise strong
  "structure it, don't prompt it" discipline lapses.
- **Packaging coupled to provider identity.** A network allowlist naming one
  vendor (MANU-005) means the "provider-independent" abstraction cannot actually
  be exercised. The abstraction is good; the deployment contradicts it.
- **Machine state in `localStorage`.** Model, routing and theme settings
  (MANU-018) live in webview storage — invisible, unportable, unbackupable, and
  clearable by an unrelated action.
- **Non-transactional project creation** (MANU-003), in a codebase that
  otherwise takes transactions seriously.
- **Verification pipeline stops at the TypeScript boundary** (MANU-013). The
  security-critical layer — path confinement, atomic writes, credential storage —
  is the least covered by CI.
- **No file-ownership model.** Nothing anywhere tracks "Manu last saw this file
  in state X", which is the root of MANU-001 and would also be the foundation for
  file watching, conflict resolution and crash recovery.

---

## Test coverage gaps

Existing tests are strong on domain logic (1079 passing, 0 skipped, 0 flaky
observed) and weak exactly where the product meets the world.

Not protected today, and needing regression tests during remediation:

1. **Concurrent/external file modification** — the MANU-001 scenario. No test
   anywhere writes a file behind the repository's back.
2. **Project creation on a real filesystem** — creation is tested against
   `InMemoryProjectStore`; the on-disk shape, the folder-naming question and
   partial-failure cleanup are untested.
3. **Rust host** — `cargo test` in CI (MANU-013), plus symlink-escape cases
   (MANU-015) and credential-file permission timing (MANU-014).
4. **Migration** — an old-schema fixture that must be migrated or refused
   (MANU-009). There is currently no fixture at any version but the current one.
5. **AppImage smoke test** — the launch-under-Xvfb check performed in this audit
   should be automated; it catches an entire class of "works in dev" failures.
6. **Agent citation grounding** — a test where a scripted model fabricates a
   source ID and the runtime must reject it.
7. **Search behaviour** — prefix, substring, punctuation, and post-restart
   freshness as explicit cases.
8. **Large-manuscript performance** — a 100k-word fixture with open/search/build
   timings as a guard against N+1 regressions.
9. **Editor lifecycle** — dirty state, autosave, close-with-unsaved.

---

## Remediation order

Waves are ordered so that each one makes the next safe to attempt.

**Wave 1 — Stop losing work.**
MANU-001 (external-edit clobber), MANU-004 (autosave + close guard),
MANU-021 (crash recovery). Nothing else matters until a writer's words are safe.

**Wave 2 — Project lifecycle integrity.**
MANU-002 (create the project folder), MANU-003 (atomic creation),
MANU-012 (recent projects), MANU-009 (migrations), MANU-018 (settings out of
`localStorage`), MANU-020 (backup) and MANU-019 (export).

**Wave 3 — Provider infrastructure.**
MANU-005 (capability strategy + adapter registry), MANU-006 (discovery + refresh
the catalogue), then the OpenAI-compatible and Ollama adapters. MANU-023
(cancellation) belongs here since it is exercised by real calls.

**Wave 4 — Core workflow integration.**
MANU-007 (verify citations), MANU-008 (wire or remove SQLite),
MANU-010 (search matching), MANU-024 (background-job progress).

**Wave 5 — Advanced feature correctness.**
MANU-011 (semantic tests — evaluate them or stop offering them),
MANU-030 (module views), plus live-provider verification of the Reader and
Character Simulators, which this audit could not perform.

**Wave 6 — UX and brand.**
The Dark Manu direction (see below), MANU-025 (compact layout),
MANU-026 (accessibility), MANU-027 (re-showable intro), MANU-016 (code
splitting).

**Wave 7 — Packaging and alpha hardening.**
MANU-013 (`cargo test` + AppImage smoke test in CI), MANU-014, MANU-015,
MANU-017, MANU-028, MANU-031.

---

## Appendix — Dark Manu visual direction: where the current build conflicts

Assessed against the screenshot of the running AppImage, not against source.

1. **The default is Paper, not Manu Black.** Theme default is `system`;
   `@media (prefers-color-scheme: light)` applies the Paper palette. Most
   desktops report light, so most users see the cream document look — precisely
   the "paper-coloured document application" the direction rejects. The dark
   palette exists, is complete and is well-built; it simply is not what people
   will get.
2. **Manuscript Red is not restrained.** The primary CTA is a full-width solid
   red block — the single most prominent element on the first screen. The
   selected template pill is also solid red. The direction asks for red as a
   signature accent for focus, selection and brand moments.
3. **Graphite is not doing tonal work.** In the light theme the panel surfaces
   are near-white variants; there is no graphite tier establishing hierarchy.
4. **The overall impression is "document app", not "writing studio".** Serif-ish
   editorial body text on cream, centred narrow column, light chrome.

What is already right and should be preserved: the token architecture is
properly layered (primitives → semantics → per-theme overrides), the dark palette
handles the "Manuscript Red is unreadable as text on black" problem correctly
with a lightened accent-text tint, and error red is deliberately differentiated
from brand red. The remediation is a default change and an accent-usage audit,
not a rebuild.

---

_End of audit. No remediation performed._
