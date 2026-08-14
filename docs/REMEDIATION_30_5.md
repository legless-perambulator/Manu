# REMEDIATION 30.5B1 — Data safety and project creation

Remediation of the Phase 30.5A audit (`docs/AUDIT_30_5A.md`, commit `8e9b1c2`),
scoped to Wave 1 and the project-lifecycle half of Wave 2.

**Only the issues addressed in this phase are recorded here.** Providers,
branding, agent grounding and the advanced subsystems are untouched and remain
open exactly as the audit left them.

| Issue    | Original | Status        |
| -------- | -------- | ------------- |
| MANU-001 | P0       | **FIXED**     |
| MANU-002 | P1       | **FIXED**     |
| MANU-003 | P1       | **FIXED**     |
| MANU-004 | P1       | **FIXED**     |
| MANU-009 | P2       | **FIXED**     |
| MANU-012 | P2       | **FIXED**     |
| MANU-013 | P2       | **FIXED**     |
| MANU-020 | P3       | **FIXED**     |
| MANU-021 | P3       | **MITIGATED** |

Verification: **1102 TypeScript tests** (56 files, up from 1079/55) and
**9 Rust tests**, typecheck, lint and format all passing;
`pnpm check` now runs the Rust layer too.

---

## MANU-001 — External edits silently overwritten (P0) — FIXED

**Root cause.** No layer tracked what Manu had last seen on disk.
`NodeProjectStore.writeFile`, `project_fs.rs::write_atomic_impl` and
`TauriProjectStore.writeFile` all wrote unconditionally. Writes were _atomic_;
they were never _conditional_.

**Fix.** A `GuardedProjectStore` decorator
(`packages/persistence/src/guarded-store.ts`) remembers a content fingerprint
per path, re-reads before overwriting, and throws `ExternalChangeError` when the
disk no longer holds what Manu last saw. It sits closest to the disk, beneath
the journal, so nothing above it can bypass it.

Three decisions inside that are worth stating:

- **Scoped to user-owned files.** `.writer/` is excluded. Nobody hand-edits
  `id-sequences.json`, and guarding it would manufacture conflicts a writer
  could not act on. What is protected is exactly what the product invites people
  to open elsewhere.
- **First-touch capture, explicit refresh.** This was a real bug in the first
  cut of the fix, caught by the regression test: the journal reads a file to
  record its "before" content _immediately before_ the write it is recording. If
  every read refreshed the token, that internal read refreshed it a moment
  before the comparison and the guard never fired. So `readFile` records only on
  first touch, and `repo.readProjectFile` refreshes deliberately — opening a
  file in Manu means "I have seen this version".
- **Fingerprint, not mtime.** Content-based, so it works identically over the
  Node store, the Tauri host and the in-memory store, with no filesystem
  watching, no platform support and no daemon.

**Resolution paths.** `repo.fileIsCurrent`, `repo.acceptExternalChange` (take
the disk version) and `repo.overwriteProjectFile` (deliberate overwrite, which
records the external text in the change set first, so it stays recoverable from
History). The editor surfaces all three.

**Regression coverage.** `packages/story-repository/src/data-safety.test.ts` —
seven tests, on a real filesystem, including the audit's exact scenario. The
audit's own probe, re-run unchanged, now fails with `ExternalChangeError` where
it previously reported `External edit silently clobbered by Manu? true`.

**Remaining limitation.** A path Manu has never read or written is not yet
tracked, so the first write adopts whatever is there. This does not weaken the
guarantee that matters — a file open in the editor has necessarily been read.
**There is still no filesystem watching**: a conflict is detected when Manu next
writes, not the moment it happens. Proactive detection is a genuine improvement
still to make.

---

## MANU-002 — New Project scattered files into the chosen folder (P1) — FIXED

**Root cause.** `createProjectAt(root, title)` passed the picked directory
straight to `new TauriProjectStore(root)`. The title reached the manifest and
never the filesystem.

**Fix.** `apps/desktop/src/repo/session.ts` now derives a folder name from the
title and creates the project _inside_ the chosen parent. Choosing
`~/Documents/Novels` and typing "The Black Thorn" produces
`~/Documents/Novels/The Black Thorn/`.

`projectFolderName` (`packages/story-repository/src/project-folder.ts`) keeps
the name human: spaces, capitals, accents and ordinary punctuation all survive.
Only what a filesystem genuinely cannot take is replaced, and the Windows
illegal set is applied everywhere so a project made on Linux still copies onto
Windows. `availableFolderName` appends " 2", " 3" rather than colliding.

**Regression coverage.** Three tests over naming (including Unicode, reserved
Windows names, leading dots and trailing periods) plus four Rust tests
(`creation_tests`) proving the host refuses separators, traversal and clobbering.

**Verification note, stated precisely.** The two halves are tested — folder
naming in TypeScript, `prepare`/`promote`/`discard` in Rust — and the repository
half is tested on a real filesystem. **The end-to-end IPC path is not
automatically tested**, because it needs a running Tauri host. It is the first
item on the human checklist.

---

## MANU-003 — Project creation was not atomic (P1) — FIXED

**Root cause.** `scaffoldProject` wrote directories and files sequentially with
no staging and no rollback, and the manifest was written _last_ — so any earlier
failure left an unidentifiable husk in the writer's own folder.

**Fix.** Creation is now transactional from the writer's point of view:

```
validate destination
→ project_prepare  (create parent/.manu-new-XXXX, fails if it exists)
→ initialise the repository inside it
→ validateProject  (a project that cannot open must never be promoted)
→ project_promote  (rename to parent/Title, refuses to clobber)
→ remember in recent projects
→ open the workspace
```

On any failure the temporary directory is removed and the chosen folder is left
exactly as it was. `project_discard` **refuses any name without the
`.manu-new-` prefix**, so cleanup cannot become a general recursive delete —
this is the one new destructive operation in the host and it is deliberately
the narrowest thing that works.

**Regression coverage.** A failure-injection test asserting that a half-built
project does not validate (and therefore can never be promoted) and that the
parent directory afterwards contains only the writer's own file; plus the Rust
`discard_only_removes_partial_projects` test.

---

## MANU-004 — No autosave, no close guard (P1) — FIXED

**Root cause.** Manual save only. `Workspace` computed an `unsaved` list and
used it _solely_ to gate branch switching; no `onCloseRequested` handler existed.

**Fix.**

- **Debounced autosave** at 1.2 s idle in `Editor.tsx`.
- **Explicit states** — `Saved`, `Unsaved`, `Saving…`, `Save failed`,
  `Changed outside Manu` — rendered as one small muted word so normal writing is
  not noisy, and coloured only when it matters.
- **A failed save stays dirty**, and a conflict stops autosave entirely:
  continuing to write over another editor is the exact harm being prevented.
- **Window close is intercepted** via `getCurrentWindow().onCloseRequested`. Manu
  saves first and only then destroys the window; if the save fails the close is
  **cancelled** and the writer is left looking at the problem rather than at
  nothing. This needed `core:window:allow-destroy` and `core:window:allow-close`
  in the capability file.
- The editor registers a flush function with the shell, so anything destructive
  can force a save first.

**Remaining limitation.** Switching files inside the editor is protected by
autosave and the draft sidecar, not by a blocking prompt. With a 1.2 s debounce
and a synchronous draft on every keystroke, the exposure is bounded — but a
blocking guard on file switch would be stronger.

---

## MANU-021 — Crash recovery (P3) — MITIGATED

**Fix.** Autosave is the real protection. Beneath it, `lib/drafts.ts` keeps
unsaved text in local storage **synchronously on every keystroke** — no promise,
no disk, nothing that can be half-finished when the process dies. On reopening a
file, a draft that differs from disk is offered back with a visible notice.
Drafts are cleared the moment a save succeeds, so this never becomes a second
source of truth.

**Why mitigated rather than fixed.** This recovers the editor buffer, which is
where a crash costs a writer minutes. It does not checkpoint in-flight
multi-step operations (a workflow run, a refactor). Those already persist per
step and were not in scope here.

---

## MANU-020 — No backups (P3) — FIXED

**Fix.** `ProjectBackups` (`packages/story-repository/src/backups.ts`) takes
bounded local snapshots under `.writer/backups/`, captured on project open at
most once every six hours.

Four properties, each deliberate and each tested:

- **Inside `.writer/`**, which the manuscript tree, the search index and every
  entity store already ignore — a backup search could find would return every
  chapter ten times over.
- **Bounded** at ten snapshots, oldest pruned, so a novel does not quietly
  become eleven novels on disk.
- **Copy-only.** A test asserts the canonical file's mtime is unchanged by a
  capture. Taking a backup can never be the thing that breaks the project.
- **Plain files.** Recovery is copying a folder back and works with Manu shut.

`restore()` takes a snapshot of the current state first, because the commonest
way to lose work with a restore feature is restoring the wrong one.

**Recovery path (documented for the tester).** Snapshots live at
`<project>/.writer/backups/BK_<timestamp>/`, mirroring the project tree.
Copy the files back over the project with Manu closed, or call
`repo.backups.restore(id)`.

---

## MANU-009 — Older schemas opened without migration (P2) — FIXED

**Root cause.** `validateManifest` rejected _newer_ schema versions and accepted
anything at or below the current one. A project claiming version 0 opened and
was then read under version-1 assumptions — the quiet kind of corruption, where
nothing fails and the project is silently reinterpreted.

**Fix.** `packages/story-repository/src/migrations.ts` accounts for every
version: newer is refused (update Manu), current opens, older is migrated by a
**registered** step or refused. `openProject` runs this before anything reads
project content.

The registry ships **empty**, and that is the honest answer: version 1 is the
only schema Manu has ever written, so there is genuinely nothing to migrate
from, and inventing a speculative 0→1 step would be pretending to support
projects that never existed. What the registry provides is a single obvious
place for the next schema change, and an "unknown version" path that is a
refusal rather than a shrug.

**Regression coverage.** Versions 0, −3, 1 and 99 as fixtures, plus a test that
a refused folder is not mutated. Re-running the audit's own probe now reports
`refused: This project claims schema 0, which this build cannot upgrade` where
it previously reported `OPENED`.

---

## MANU-012 — No recent projects (P2) — FIXED

`apps/desktop/src/repo/recents.ts` keeps the last eight projects, newest first,
recorded on both create and open. The start screen lists them; a project that
has been moved or deleted reports why and removes itself from the list rather
than sitting there pretending. Stored per machine, never inside a project — a
project is portable and must not carry one computer's history with it.

---

## MANU-013 — Rust tests never ran in CI (P2) — FIXED

`pnpm check` now ends with `pnpm run test:rust`
(`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`). The layer that
enforces path confinement, atomic writes and now atomic project creation is no
longer the least-covered thing in the build. Nine Rust tests pass, five of them
new.

`apps/desktop/src-tauri/gen/schemas/**` was added to `.prettierignore` — it is
regenerated by `tauri build` from the capability file and is not hand-edited.

---

## What this phase did not touch

Open exactly as the audit left them, and out of scope by instruction:
MANU-005/006 (providers, model catalogue), MANU-007 (agent grounding),
MANU-008 (SQLite), MANU-010 (search prefix matching), MANU-011 (semantic tests),
MANU-014/015/016/017/018/019 and MANU-022 onward, including the Dark Manu
visual direction.

**MANU-019 (no export) is worth flagging here** even though it is out of scope,
because it bears on the data-safety verdict: there is still no way to get a
finished manuscript out of Manu in a portable format. Backups mitigate loss;
they are not the same as being able to leave.

---

## Data safety verdict

> **Would I trust the current build with the only copy of a 100,000-word novel?**

**Still NO — but for one remaining reason rather than three.**

The audit named three routine prose-loss paths. Two are closed:

1. **External-edit clobber** — closed, and proven by the audit's own probe now
   failing.
2. **No autosave / no close guard** — closed: debounced autosave, a synchronous
   draft on every keystroke, and a window-close interception that cancels the
   close if the save fails.
3. **No backup or export** — **half closed.** Bounded local backups now exist
   and are tested. Export does not (MANU-019), and backups live inside the
   project folder, so they survive a bad edit but not a lost or deleted folder.

The honest remaining objection is that "the only copy" is doing the work in that
question. Backups inside the project directory do not protect against losing the
directory, and with no export there is no portable finished artefact to keep
elsewhere. A conservative answer must therefore stay NO.

> **Would I now recommend beginning real-world alpha writing tests in Manu while
> maintaining normal independent backups?**

**YES**, with two conditions:

1. Keep the project folder under version control or an ordinary backup tool.
   That is the assumption the question already grants, and it closes the
   remaining gap.
2. Complete the manual checklist first — in particular the create-project step,
   whose end-to-end IPC path could not be automatically tested here.

That is a genuine change from the audit's position, and it rests on tested
behaviour rather than on this having been a remediation phase.

---

# REMEDIATION 30.5B2 — Providers, model connections and secure AI configuration

Continuation of the same audit, scoped to the provider half of Wave 2. Nothing
in the data-safety work above was reopened.

| Issue    | Original | Status                  |
| -------- | -------- | ----------------------- |
| MANU-005 | P1       | **FIXED**               |
| MANU-006 | P1       | **FIXED**               |
| MANU-018 | P4       | **UNCHANGED** (see end) |

---

## MANU-005 — Only one provider exists, and the network allowlist forbids others — FIXED

**Root cause.** Two independent blocks that had to be lifted together.
`buildProviders()` returned a hard-coded one-element array, and
`capabilities/default.json` scoped `http:default` to `https://api.anthropic.com/*`,
so even a correct adapter would have failed after packaging.

**Fix, part one — a registry instead of a literal.** `ProviderRegistry`
(`packages/model-router/src/provider.ts`) holds adapters;
`ProviderDescriptor` says what each one _is_. Six identities are registered:
Anthropic, OpenAI, Google Gemini, OpenRouter, Ollama, and a generic
OpenAI-compatible endpoint. The settings screen is generated from
`registry.describeAll()`, so **no interface code names a provider** and adding
one is registering an adapter.

Four of those six share one transport. OpenAI, OpenRouter, Ollama and
self-hosted servers all speak `/chat/completions`; writing that wire format four
times would have been four places for the same streaming bug to live. What
genuinely differs — address, auth, discovery path, response shape — is
configuration.

**Fix, part two — a capability strategy, not a wildcard.** The allowlist now
permits the four hosted providers by name, loopback on any port, and **any host
on ports 11434 and 1234**. That last line is the deliberate part: "do not assume
Ollama must be running on the same machine" is a real requirement — a GPU box on
the far side of the house is the normal case — but "any host on any port" is a
general-purpose outbound channel and this application has no business asking for
one. A dedicated inference port opened network-wide is a narrow, explicable
concession; a blanket grant is not.

The cost of that choice is real and is stated rather than hidden: a server on
some other port needs the capability file edited and the application rebuilt.
`lib/network-scope.ts` mirrors the host's list so a writer who types such an
address is told _before_ the request, in a sentence that says the restriction is
deliberate, instead of receiving a bare network failure afterwards. A test reads
the actual capability file and asserts three things: every shipped provider's
default address is permitted, the in-app mirror agrees with the host, and no
`*`-host entry exists on a port that is not a model-server port.

**Also fixed here:** the single global provider dropdown could not express two
Ollama servers. Configuration is now a list of **connections** — provider,
label, address, discovered models — so a laptop and a GPU box are two rows.

## MANU-006 — Model catalogue is hard-coded and stale — FIXED

**Fix.** `ModelProvider` gained optional `discoverModels()` and required
`testConnection()`. Every shipped provider implements discovery against a real
endpoint (`/v1/models`, `/models`, `/api/tags`), results are cached on the
connection so the list still renders offline, and the built-in catalogue is now
a fallback rather than the only source. The Anthropic constants were refreshed
to the Claude 5 family alongside `claude-haiku-4-5-20251001`, and a model
released after this build still gets a readable name.

**The part worth arguing about: unknown capabilities.** Discovery from a local
server returns a name and nothing else. Whether those weights do tool calling is
a property of the weights, not the server, and Ollama does not claim to know.
Both easy answers are wrong — assume `true` and it fails mysteriously at the
first tool call; assume `false` and Manu refuses a model that works. So
`ModelDescriptor.unknownCapabilities` records what nobody has stated,
`capabilityState()` answers `yes` / `no` / `unknown`, and `capabilityRefusal()`
refuses **only a known `no`**. Unknown is allowed through and shown as `?` in
the model list.

Where an operation genuinely cannot proceed without a capability — an agent
investigation _is_ a tool loop, and every edit arrives as a structured proposal
— the refusal is raised before the run and names the setting that fixes it,
rather than surfacing as an empty answer.

## Secrets

No key is stored in the connection record, a project file, the manifest,
revision history, an agent prompt or the packaged build. Keys live in the OS
credential store keyed by connection id; the desktop's
`secretKeyForConnection(id)` produces the same `provider:<id>:apiKey` string the
old code used, which is what lets a pre-existing Anthropic setup survive
migration **without this code reading or moving the secret at all** — the
migrated connection is simply given the id the old key was already filed under.
A test asserts the settings blob contains no key material, and removing a
connection deletes its stored credential rather than orphaning it.

The keychain fallback (an owner-only `0600` file in the application-config
directory, on machines with no Secret Service) is unchanged from Phase 6 and is
still disclosed in the interface. It is not project configuration, and nothing
here writes a secret into a project directory.

## Subscriptions — not implemented, deliberately

A ChatGPT Plus/Pro or Claude Pro/Max subscription is a consumer entitlement to
that vendor's own surfaces. It is not API access, and no officially supported
mechanism exists for a third-party application to authenticate with one.
Nothing here reuses browser cookies, requests session tokens, impersonates an
official client or calls a private consumer endpoint. The provider picker says
so in one sentence, where somebody would otherwise assume otherwise and lose an
evening to it.

## Tests

**No test requires a paid credential or touches a network.** Every adapter is
exercised through an injected `fetch`: wire format, streaming, tool calls,
structured-output rejection, HTTP-status → `ModelError` mapping, unreachable
hosts, discovery parsing for all three response shapes, base-URL handling, and
the header-not-query-string rule for Gemini keys. Alongside those: the provider
registry, capability honesty, the legacy settings migration, purpose fallback,
connection-id collisions and the capability-file consistency check.

## Still open

**MANU-018 — settings in webview `localStorage` — unchanged.** Connections and
purpose assignments are stored there, as the old model settings were. They are
machine-local preferences and nothing in a project depends on them; a corrupt
blob loses a model choice and no prose. Moving them to a host-side config file
is still the right fix and is still open.

**Gemini streaming** buffers: `streamText()` yields the completed text as a
single delta rather than pretending to stream, because Gemini's streaming
endpoint is a separate protocol. This is recorded in the adapter as a
limitation, not hidden.

**Cost accounting and privacy routing** remain PLANNED. `TokenUsage` is returned
by every call and `costMetadata` lives on descriptors, but nothing yet turns
those into limits.
