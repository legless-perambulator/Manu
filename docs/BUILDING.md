# BUILDING

How to run Manu from source, and how to produce the distributable Linux
AppImage.

## Prerequisites

- **Node ≥ 20** and **pnpm 10**
- **Rust toolchain** (stable) for anything that touches the desktop shell
- Tauri's Linux system dependencies — on Debian/Ubuntu:

  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
                   librsvg2-dev build-essential curl file libssl-dev
  ```

## Everyday commands

```bash
pnpm install        # install workspace dependencies
pnpm check          # typecheck + lint + format:check + test — run before committing
pnpm test           # unit tests (Vitest)
pnpm dev            # frontend only, in a browser
pnpm dev:desktop    # the real desktop app (needs a display)
```

`pnpm dev` runs the interface without the Tauri bridge. Creating and opening
projects needs the filesystem, so those controls are disabled and say so; every
other surface renders.

### The preview harness

`apps/desktop/preview.html` mounts the real workspace against an in-memory
project, so layout, theming and the command palette can be looked at in a plain
browser:

```bash
pnpm dev   # then open http://localhost:1420/preview.html
```

It accepts `?theme=dark|light` and `?palette=1` so a screenshotting browser can
drive it. It is **not** part of the shipped application — the Tauri bundle's
only entry point is `index.html`, and `preview.html` is not an input to the
production build.

## Brand assets

The vector masters under `apps/desktop/src/assets/brand/` are the source of
truth; everything else is generated from them.

```bash
# Icons: SVG -> the PNG sizes the Tauri bundler needs
pip install cairosvg
python3 scripts/generate-icons.py

# Wordmark: re-outline it from Martian Grotesk Condensed Light
pip install fonttools
curl -LO https://raw.githubusercontent.com/evilmartians/grotesk/main/fonts/ttf/MartianGroteskCondensed-Light.ttf
python3 scripts/build-brand-assets.py MartianGroteskCondensed-Light.ttf
```

Regenerating the wordmark is rarely needed: the committed SVGs are already
outlined and carry no live text. See [BRAND.md](BRAND.md).

## Building the Linux AppImage

```bash
cd apps/desktop
pnpm exec tauri build --bundles appimage
```

This runs `pnpm build` (Vite → `apps/desktop/dist`), compiles the Rust host in
release mode, and bundles the two together. The artifact lands at:

```
apps/desktop/src-tauri/target/release/bundle/appimage/Manu_0.1.0-alpha_amd64.AppImage
```

Then:

```bash
chmod +x Manu_0.1.0-alpha_amd64.AppImage
./Manu_0.1.0-alpha_amd64.AppImage
```

The AppImage is **standalone**: the frontend is compiled into the binary, so it
needs no dev server, no Node, and no checkout. It carries no source paths.

### Notes

- The first build downloads `linuxdeploy` into `~/.cache/tauri`. It needs
  network access once; later builds do not.
- `--bundles appimage,deb` also produces a `.deb` under
  `target/release/bundle/deb/`.
- Release builds take several minutes. `cargo check --manifest-path
apps/desktop/src-tauri/Cargo.toml` is the fast way to verify the host
  compiles.
- Build artifacts are **not** committed. `target/` and `dist/` are ignored.

### What is and is not in the bundle

The AppImage contains the release binary, the compiled frontend, the icons and
the desktop entry — nothing else. Specifically:

- **No API keys and no credentials.** Provider keys live in the OS secure store
  at runtime (`com.manu.app`), are entered by the person using the application,
  and are never read at build time. See [SECURITY_PRIVACY.md](SECURITY_PRIVACY.md).
- **No test fixtures, no sample manuscripts, no private material.** Fixtures
  live in `packages/*/src/**/*.test.ts` and never reach the frontend bundle.
- **No development tooling.** The preview harness, the Vite dev server and the
  test runner are not inputs to the production build.
- **No developer-machine paths.** Nothing in the application resolves a path
  from the source tree; projects are opened from a folder the user chooses.

Filesystem access is confined to the opened project root by the host commands in
`src-tauri/src/project_fs.rs`, and outbound HTTP is scoped to the configured
provider endpoint in `src-tauri/capabilities/default.json`.

## Version and identity

| Field        | Value          | Where                           |
| ------------ | -------------- | ------------------------------- |
| Product name | `Manu`         | `src-tauri/tauri.conf.json`     |
| Version      | `0.1.0-alpha`  | `tauri.conf.json`, `Cargo.toml` |
| Identifier   | `com.manu.app` | `tauri.conf.json`               |
| Window title | `Manu`         | `tauri.conf.json`               |
| Keyring      | `com.manu.app` | `src-tauri/src/secrets.rs`      |

Keep the version in `tauri.conf.json` and `src-tauri/Cargo.toml` in step; the
AppImage filename is derived from the former.
