# Release Readiness Audit

> Phase 46 §35–§36, repeating the spirit of the Phase 30.5A audit at the end
> of the build. Date: 2026-08-16. Basis: 1,637 TypeScript tests across 95
> files, 12 Rust tests, full lint/format/typecheck, production AppImage
> build, all green at the audited commit. Classifications are conservative:
> a subsystem is READY only when its failure modes are tested, not merely
> its happy path.

## 1. Data safety re-run (§1)

The Phase 30.5 remediation suite still passes in full: atomic writes leave
no temp files, project creation promotes by rename and refuses to clobber,
path traversal is blocked at the command implementations, external-edit
protection reloads safely, autosave/dirty-state/close-guard behaviour is
covered, automatic bounded backups rotate (RETAIN=10), branch operations
and refactors go through the transactional journal, and Book Build
interruption/resume has dedicated failure-recovery tests (Phase 34).
Scheduled external backups (this phase) add an off-machine copy with
content-digest dedupe, restorable through the start screen's archive
import. **No routine manuscript-loss path is known.** The honest caveat:
"known" is bounded by the suite — see the verdict.

## 2. Subsystem classification (§35)

| Subsystem                                        | Status       | Why                                                                                                     |
| ------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------- |
| Story Repository, persistence, path safety       | **READY**    | Adversarial tests, atomicity, migration gate, schema refusal                                            |
| Manuscript editor, autosave, crash recovery      | **READY**    | Remediated in 30.5, regression-tested since                                                             |
| Backups (local + scheduled external) & restore   | **READY**    | Dedupe tested at lib level; restore is the tested archive import                                        |
| Search, Story Build (deterministic), Story Tests | **READY**    | Deterministic, fixture-tested incl. broken novels                                                       |
| Versioning, branches, diffs, checkpoints         | **READY**    | Transactional; safety reviewed in 30.5                                                                  |
| Export (DOCX/EPUB/PDF/MD/TXT) + leak guard       | **READY**    | Leak check is verified at the door, not assumed                                                         |
| Import & reverse story mapping                   | **BETA**     | 150k-word scale tested; real-world DOCX variance is wide                                                |
| Model router, budgets, privacy, usage            | **BETA**     | Engine thoroughly tested; provider matrix covered by typed errors, real-world provider drift is ongoing |
| Semantic compiler, debugger, simulations         | **BETA**     | Sound architecture, quality depends on configured model                                                 |
| Chapter/Act/Book builders                        | **BETA**     | Failure injection + resume tested; long-run economics need field time                                   |
| Story Map, Timeline, visual layers               | **BETA**     | Deterministic view-model tested; UX polish ongoing                                                      |
| Terminal & command language                      | **READY**    | Closed registry, no shell, acceptance-tested                                                            |
| Universe / series projects                       | **BETA**     | Spoiler boundaries and scale tested; multi-book workflows young                                         |
| Plugin protocol                                  | **READY**    | Sandbox by construction; §25 security suite                                                             |
| Studio (custom agents & skills)                  | **BETA**     | Engine acceptance-tested; builder UX young                                                              |
| Story Intelligence autopilot                     | **ALPHA**    | Engine tested incl. failure containment; extraction quality unproven on real manuscripts                |
| Extension ecosystem & catalogue                  | **BETA**     | Manager acceptance-tested; catalogue is local/first-party only                                          |
| Application updates                              | **ALPHA**    | Client verified by tests; no published feed or served artifact yet                                      |
| Windows / macOS builds                           | **DISABLED** | Never built or tested; not claimed (§20–§21)                                                            |
| Remote crash reporting / telemetry               | **DISABLED** | Deliberately absent; diagnostics are local export only                                                  |

## 3. Performance (§10–§13)

Measured in the automated suite on CI-class hardware: reverse-mapping a
150k-word manuscript stays within its excerpt budget (Phase 40 §43);
editing one scene of a 200-scene / 150k-word project triggers analysis of
exactly that scene and the full autopilot cycle completes in well under
five seconds (Phase 44 §33 asserts both scope and time); the Story Build on
fixture novels runs in milliseconds. Background work is bounded — the
autopilot drains at most a fixed number of jobs per pass, debounced four
seconds behind saves, and pausing stops all of it (§11). Startup reaches
the editor before any advanced runtime initialises: plugin host, Studio,
extensions and autopilot all construct asynchronously after first paint
(§12). Editor stress at 100k+ words in a single document and long undo
histories remain **manual checklist items** (§25) — not claimed here.

## 4. Security review (§14–§15)

- **Tauri surface**: a closed set of Rust commands; project file access is
  path-confined and traversal-tested at the command implementations;
  external reads/writes only through user-picked absolute paths.
- **Credentials**: OS keychain via the secrets backend; never in project
  files, archives, exports, logs (redaction-tested), or diagnostics.
- **Plugins**: declarative capability bundles — no code execution, per-host
  network at three checkpoints, plugin-scoped secrets. §25 suite green.
- **Extensions**: inspected before install, credential-scan refusal,
  permission approval, deep validation of each contribution.
- **Rendering**: Markdown rendering is the audited in-house renderer; no
  raw HTML injection path from project content.
- **Residual risks (documented, §15)**: (1) the in-app HMAC first-party
  key can be extracted, so "trusted" currently proves catalogue
  consistency, not remote authorship — asymmetric signing is the release
  requirement (RELEASING.md); (2) an unsigned community extension is
  integrity-checked but of unverified authorship, and the UI says exactly
  that; (3) a malicious extension cannot reach provider credentials or
  arbitrary files by construction, but a writer can be socially engineered
  into approving broad permissions — the permission summary is the
  mitigation, not a guarantee.

## 5. Failure matrices (§26–§29)

- **Providers**: typed errors for invalid key, quota, rate limit, timeout
  and malformed responses; rate limits feed availability back into
  routing; with no model at all, every deterministic surface still works —
  the start screen says so explicitly.
- **Book Build**: failure injection at scene, chapter and act levels with
  resume; gates propagate pauses (Phase 34 tests).
- **Autopilot**: a crashing analyst is contained per analysis kind, the
  queue drains cleanly, the status line explains, and saving never routes
  through the autopilot at all (tested this phase).
- **Extensions/plugins**: broken manifests refused at the door; a failing
  plugin degrades to a visible error with View error/Disable; a failing
  catalogue leaves installed extensions working offline.

## 6. Verdicts (§36)

**«Would I trust Manu with the only copy of a 100,000-word manuscript?»**
No — and not with any other software either. The data-safety layer is
strong: atomic writes, journaling, rolling local backups, scheduled
external backups, tested crash recovery. But "the only copy" is a policy
failure regardless of tooling, this codebase has not yet survived months of
real-world daily use, and the first-run screen tells writers exactly that.

**«Would I recommend Manu for real writing work with normal backups?»**
Yes, for a technically tolerant writer on Linux: the writing core —
editor, repository, build, export, versioning — is the most-tested part of
the product, degradation without a model is graceful, and the escape hatch
(plain files, portable archives) is always open. The AI-driven layers
should be treated as the BETA/ALPHA systems they are labelled as.

**«What prevents this build from being called 1.0?»**
(1) No field mileage: the suite is broad but synthetic; a beta period with
real manuscripts is non-negotiable. (2) Asymmetric release/extension
signing and a served update feed do not exist yet. (3) Windows and macOS
are unbuilt. (4) The autopilot's extraction quality on real prose is
unmeasured. (5) Accessibility and editor stress at the top of the range
are manual-checklist items, not verified guarantees. Until those close,
this is a strong late alpha / early beta — and should be marketed as
exactly that.
