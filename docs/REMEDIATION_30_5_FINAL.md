# Remediation 30.5 — final summary

Phase 30.5A audited the whole product and opened 33 issues. Phases 30.5B1–B4
repaired them. This document is the closing account: what was fixed, what was
not, and whether the result can be handed to a writer.

The per-issue detail lives in `docs/REMEDIATION_30_5.md`, one section per
sub-phase. The original findings live in `docs/AUDIT_30_5A.md`. This file does
not restate them; it counts them.

---

## The four passes

| Pass   | Subject                                                   | Commit    |
| ------ | --------------------------------------------------------- | --------- |
| **B1** | Stop losing work, and create projects properly            | `4a0c35a` |
| **B2** | Providers, model connections and secure AI configuration  | `6440a46` |
| **B3** | Agent grounding, engine defects and architectural cleanup | `5a47907` |
| **B4** | Dark Manu, product polish and the alpha AppImage          | this one  |

**B1** closed the two paths by which Manu destroyed prose — the external-edit
clobber and the missing autosave — and made project creation atomic and
foldered. **B2** replaced the single hard-coded vendor with a provider registry
of six adapters, moved credentials out of project files and into the OS keychain,
and made capability claims tri-state so an unknown capability is never asserted.
**B3** turned the agent's citation promise from a prompt instruction into an
enforced invariant, found and fixed the defect the audit's own fixture had
missed, and removed the dead SQLite tier rather than pretending it worked. **B4**
made the result look and behave like one application, and packaged it.

---

## Counts

**Original audit**

| Severity  | Count  |
| --------- | ------ |
| P0        | 1      |
| P1        | 6      |
| P2        | 9      |
| P3        | 11     |
| P4        | 6      |
| **Total** | **33** |

**After remediation**

| Severity  | Original | Closed | Remaining |
| --------- | -------- | ------ | --------- |
| P0        | 1        | 1      | **0**     |
| P1        | 6        | 6      | **0**     |
| P2        | 9        | 4      | **5**     |
| P3        | 11       | 3      | **8**     |
| P4        | 6        | 2      | **4**     |
| **Total** | **33**   | **16** | **17**    |

"Closed" means FIXED, RESOLVED-by-removal, or NOT REPRODUCIBLE with evidence.
Anything MITIGATED is counted as **remaining**, because a mitigation is a smaller
version of the same defect and counting it as closed would be the exact
dishonesty this phase exists to remove.

Four issues were opened _during_ remediation and are not in the 33:

| Issue    | Origin | Status                                                   |
| -------- | ------ | -------------------------------------------------------- |
| MANU-034 | B3     | **FIXED** — the compiler defect the audit fixture missed |
| MANU-035 | B3     | **DOCUMENTED** — what specialist agents actually enforce |
| MANU-036 | B3     | **FIXED** — genre module capability honesty              |
| MANU-A   | B4     | **FIXED** — Dark Manu is the default appearance          |

---

## Remaining P0

**None.**

MANU-001 (external edits silently overwritten) was the only P0. It is fixed at
the store layer, not the UI layer: every write verifies the content stamp it read
against what is on disk and raises a typed conflict on mismatch. The audit's own
reproduction harness, which previously printed
`External edit silently clobbered by Manu? true`, now reports the refusal.

## Remaining P1

**None.**

All six are fixed and each carries a regression test:

- MANU-002 — project creation makes a folder (`projectFolderName`, shown on the
  start screen before anything is written).
- MANU-003 — creation is atomic; a failure leaves no debris.
- MANU-004 — debounced autosave, per-keystroke drafts, close guard.
- MANU-005 — six provider adapters behind a registry; the network allowlist
  admits hosted providers by name and local models on loopback.
- MANU-006 — model catalogue is discovered from the provider, not hard-coded.
- MANU-007 — agent citations are verified against an evidence ledger built from
  actual tool output; an ungrounded claim is marked, not printed as fact.

**No remaining issue was re-graded upward, with one worth naming.** MANU-019
(no export) is filed P3, but it is the single reason the data-safety answer below
is still NO. By its consequence it behaves like a P2. It is left at its original
grade here rather than quietly re-scored, and flagged instead.

---

## What is still open

**P2 — 5 remaining**

| Issue    | Status    | Why                                                                          |
| -------- | --------- | ---------------------------------------------------------------------------- |
| MANU-010 | DEFERRED  | Search matches whole tokens; a matching-quality change, not a defect         |
| MANU-011 | MITIGATED | Semantic story tests report "not evaluated" honestly; nothing evaluates them |
| MANU-014 | DEFERRED  | Credential file chmod'd after write, not before — now covered by CI          |
| MANU-015 | DEFERRED  | A symlink inside a project can escape the root                               |
| MANU-016 | DEFERRED  | One ~1.0 MB JS chunk, no code splitting                                      |

**P3 — 8 remaining**

| Issue    | Status    | Why                                                                 |
| -------- | --------- | ------------------------------------------------------------------- |
| MANU-017 | DEFERRED  | No fsync of the parent directory after rename                       |
| MANU-018 | DEFERRED  | Settings live in webview storage; clearing site data resets them    |
| MANU-019 | DEFERRED  | No export to DOCX/EPUB/PDF/plain Markdown                           |
| MANU-021 | MITIGATED | Editor buffer recovers; in-flight multi-step operations do not      |
| MANU-022 | MITIGATED | Keyring-less Linux falls back to a 0600 file, disclosed in Settings |
| MANU-023 | DEFERRED  | Cancellation plumbed but not surfaced everywhere                    |
| MANU-024 | DEFERRED  | No background-job progress surface                                  |
| MANU-026 | MITIGATED | Practical accessibility pass only; no assistive-technology testing  |

**P4 — 4 remaining**

| Issue    | Status    | Why                                                        |
| -------- | --------- | ---------------------------------------------------------- |
| MANU-028 | MITIGATED | Deb runtime deps unvalidated; the Flatpak is the safe path |
| MANU-030 | DEFERRED  | Genre World panel is a generic form (Phase 31)             |
| MANU-032 | DEFERRED  | No "report a problem" affordance                           |
| MANU-033 | MITIGATED | 77 MB AppImage / 3.8 MB Flatpak recorded, not budgeted     |

Two structural notes that are not numbered issues and should not be lost:

- **`StateStore`** is a declared port with only an in-memory implementation,
  labelled PLANNED in `ARCHITECTURE.md`. It is not dead code in the MANU-008
  sense — nothing claims it works — but it should grow an implementation or go.
- **Semantic evaluation** is the common blocker behind MANU-011, world rules and
  the Story Compiler's semantic checks. One missing piece, three symptoms.

---

## Data-safety verdict

### Would I trust the current build with the only copy of a 100,000-word novel?

**NO.**

Not because prose is at routine risk — that part changed. The two paths by which
Manu itself destroyed words are closed and proven closed: the external-edit
clobber now raises a conflict the writer resolves, and unsaved prose survives a
crash through per-keystroke drafts and a close guard that cancels the close if
the save fails. A day's writing is safe from Manu in a way it demonstrably was
not at audit time.

The objection is the word **only**. Three things stand between this build and
sole custody of a novel:

1. **Backups live inside the project folder.** `.writer/backups/` protects
   against a bad edit. It does not protect against losing, deleting or
   mis-syncing the directory, which is the failure mode "only copy" describes.
2. **There is no export** (MANU-019). There is no portable finished artefact to
   put anywhere else, so "keep a copy elsewhere" currently means copying a
   working directory rather than exporting a manuscript.
3. **The rename is not fsynced** (MANU-017). Writes are atomic against a crash;
   they are not proven durable against power loss.

None of these is a reason to keep prose out of Manu. All three are reasons to
keep prose in more than one place. A single filesystem that no tool exports from
should not hold the only copy of anything, and that is true of software much
older than this.

### Is Manu ready for real-world alpha writing tests if the user maintains an independent backup?

**YES.**

That condition removes the whole of the objection above. With the project folder
under version control or an ordinary backup tool:

- Manu's own loss paths are closed and regression-tested.
- Everything in a project is a plain file, so recovery never needs Manu — the
  backups are directories you copy back with the application shut.
- The engine half runs without a model at all, so an alpha tester can exercise
  Build, continuity, threads and the compiler with no provider connected and no
  key stored anywhere.
- Where a model is connected, it proposes and never writes; nothing reaches the
  manuscript without acceptance.
- The packaged artifact was verified as a packaged artifact — launched from an
  unrelated working directory, not from the dev tree — and contains no
  credentials and no build-machine paths.

What an alpha tester should expect to hit: no export, search that wants whole
words, no progress bar on long simulations, and semantic story tests that report
"not evaluated" rather than passing or failing. Those are the honest edges of
this build, and they are listed in `docs/ALPHA_TEST_CHECKLIST.md` under Known
limitations rather than left to be discovered.

The next action is human testing.
