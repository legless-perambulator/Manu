# Releasing Manu

> Phase 46. Reproducible builds, update channels, signing requirements and
> platform status. This document describes what a release _is_; the honest
> readiness classification lives in
> [RELEASE_READINESS.md](RELEASE_READINESS.md).

## Reproducible release builds (§31)

A release is built from a clean checkout of a tagged commit:

```sh
git checkout vX.Y.Z            # the tag records the exact commit
pnpm install --frozen-lockfile # dependencies exactly as locked
pnpm run check                 # every layer: TS, lint, format, tests, Rust
pnpm run build:desktop         # Vite build + Tauri bundle (AppImage on Linux)
```

Record for every release, in the release notes:

- **version** — the tag, mirrored in `apps/desktop/package.json` and
  `tauri.conf.json`;
- **commit** — the full SHA the tag points at;
- **dependencies** — `pnpm-lock.yaml` and `Cargo.lock` at that commit are
  the dependency record; both are committed;
- **artifact hashes** — `sha256sum` of every artifact, printed beside its
  download.

CI (`.github/workflows/verify.yml`) already runs the same layers on every
push — typecheck, lint, format, the full TypeScript suite (including
migration fixtures, plugin-protocol security fixtures and extension
fixtures), `cargo fmt`/`clippy`/`test`, the production bundle, and a
headless AppImage launch under Xvfb (§30).

## Update channels (§16–§17)

Three channels: **stable** (default — nobody is forced onto development
builds), **beta**, **alpha**. The desktop's update client
(`apps/desktop/src/lib/updates.ts`) evaluates a signed channel manifest:
version comparison, https-only artifact URLs, signature verification over
the canonical digest, and honest degradation — a failed or offline check is
"could not check", never a blocked launch. Download and installation go
through the platform's own signed artifact; Manu never patches itself in
place. Publishing the manifest is `buildUpdateManifest(channels, key)` from
the release pipeline.

## Signing (§18)

- **Never commit signing secrets.** The repository contains key _ids_ and
  verification logic only. CI signing uses repository secrets; local
  signing uses the release engineer's keychain.
- Linux: AppImages are published with detached signatures + sha256 sums.
- The in-repo HMAC "first-party key" for the extension catalogue and update
  feed is a **foundation with a documented limitation**: an HMAC secret
  shipped in the app can be extracted and used to forge "trusted" labels.
  Production distribution replaces it with asymmetric signing (private key
  in build infrastructure, public key in the app). The port shapes require
  no code changes beyond the key material. Until then, "trusted" means
  "consistent with this build's catalogue", no more — see the residual-risk
  register in RELEASE_READINESS.md.

## Platforms (§19–§21)

- **Linux** — the built and tested platform. AppImage (with the audited
  excludelist pruning from Phase 20.5) and Flatpak. CI smoke-launches the
  AppImage headlessly; launching from arbitrary directories is part of the
  manual checklist (`ALPHA_TEST_CHECKLIST.md`).
- **Windows** — the Tauri configuration and scripts are platform-neutral
  and `tauri build` targets NSIS/MSI on a Windows host. **No Windows
  artifact has been built or tested; none is claimed to work.**
- **macOS** — likewise preparable via `tauri build` on a macOS host with
  notarisation credentials. **Untested; not claimed.**

## Project portability (§22–§23)

Projects contain only relative paths — the path-safety layer refuses
absolute paths and traversal in every store, and per-project app settings
(backup schedules) are keyed by project _id_, not filesystem path, so a
copied or moved folder keeps its configuration. Recent-projects entries
that no longer resolve are reported and removed on demand, and a moved
project is re-opened through the ordinary "Open project" picker.

## Issue reports (§32)

A tester opens Settings → Diagnostics & updates, writes _what happened_ and
_what they expected_, and presses **Export diagnostics** — the bundle
carries app version, OS, the redacted local log, provider metadata without
keys, and the report text. No log-file archaeology, no manuscript text, no
secrets (`lib/diagnostics.ts`, tested in `diagnostics.test.ts`).
