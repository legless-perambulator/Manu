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

**Use the packaging script, not `tauri build` on its own:**

```bash
scripts/package-appimage.sh
```

It builds, then removes libraries Tauri's bundler over-bundles, then repacks.
The artifact lands at:

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

### Why the extra step: EGL_BAD_PARAMETER

A plain `tauri build --bundles appimage` produces an AppImage that **crashes on
launch on current distributions** — Steam Deck / SteamOS among them:

```
Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
```

`linuxdeploy` follows libwebkit2gtk's dependency graph and sweeps a lot of the
build host's base system into `usr/lib`, including **`libwayland-client`** and
**`libwayland-egl`**. AppRun puts that directory first on `LD_LIBRARY_PATH`.

WebKitGTK does not bundle libEGL — it dlopens the **host's**. On the target,
the host's Mesa then resolves _its own_ dependencies against the AppImage's
older copies, and `eglGetDisplay(EGL_DEFAULT_DISPLAY)` fails. SteamOS ships
Mesa 25; Ubuntu 24.04 ships Wayland 1.22; that pairing is the documented
trigger.

This is why `WEBKIT_DISABLE_DMABUF_RENDERER`, `WEBKIT_DISABLE_COMPOSITING_MODE`
and `GDK_BACKEND=x11` make no difference: the failure is in `PlatformDisplay`
creation, before any renderer or compositing mode is chosen. (`GDK_BACKEND=x11`
in particular is already forced by Tauri's own AppRun hook, so setting it is a
no-op.)

`libwayland-client` is on the [canonical AppImage
excludelist](https://github.com/AppImage/pkg2appimage/blob/master/excludelist)
for exactly this reason. `scripts/package-appimage.sh` removes it and the
related set named in [tauri-apps/tauri#15665](https://github.com/tauri-apps/tauri/issues/15665):
the Wayland libraries, the GLib family, GStreamer, and the base-system
libraries Mesa links (`libffi`, `libpcre2`, `libzstd`, `libelf`, `libmount`,
`libblkid`, `libselinux`) — 29 files. The upstream issue is open; no released
Tauri does this for us.

**Trade-off:** these libraries are "assumed present on the host" by AppImage
convention, so dropping them raises Manu's baseline to a host with **GLib ≥
2.80** (Ubuntu 24.04 / Fedora 40 / SteamOS 3.6 and newer). Every current
desktop distribution satisfies it; a 2023-era LTS may not.

### Notes

- The first build downloads `linuxdeploy` into `~/.cache/tauri`. It needs
  network access once; later builds do not.
- `--skip-build` reuses the compiled AppDir and only re-prunes and repacks.
- Release builds take several minutes. `cargo check --manifest-path
apps/desktop/src-tauri/Cargo.toml` is the fast way to verify the host
  compiles.
- Build artifacts are **not** committed. `target/` and `dist/` are ignored.

## Building the Flatpak

Flatpak is the more robust Linux package, and the recommended one on SteamOS.
It runs against a fixed runtime and takes the host's GPU driver through
Flatpak's `org.freedesktop.Platform.GL` extension, which is version-matched to
the host — so the shadowing failure above **cannot occur by construction**.

```bash
flatpak install -y flathub org.gnome.Platform//49 org.gnome.Sdk//49

cd apps/desktop
pnpm exec tauri build --bundles deb          # the Flatpak wraps this
cd flatpak
flatpak-builder --user --force-clean --repo=repo build-dir com.manu.app.yml
flatpak build-bundle repo Manu_0.1.0-alpha_x86_64.flatpak com.manu.app \
  --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo
```

Install and run:

```bash
flatpak install --user Manu_0.1.0-alpha_x86_64.flatpak
flatpak run com.manu.app
```

The bundle is ~4 MB because the runtime is shared; the first install pulls
`org.gnome.Platform//49` (~700 MB) if it is not already present. On a Steam
Deck it usually is, since Flathub is the default software source.

### Sandbox permissions

`apps/desktop/flatpak/com.manu.app.yml` grants exactly what Manu already did
outside a sandbox, and nothing more:

| Permission                                                 | Why                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `--socket=wayland`, `--socket=fallback-x11`, `--share=ipc` | Windowing                                                                                   |
| `--device=dri`                                             | WebKit hardware acceleration                                                                |
| `--filesystem=home`                                        | A project is a folder of plain files the writer picks; the app reads and writes it directly |
| `--share=network`                                          | Provider HTTP, still scoped to the configured endpoint by `capabilities/default.json`       |
| `--talk-name=org.freedesktop.secrets`                      | Provider API keys in the OS secure store                                                    |

Local storage, project file access and the Tauri capability
set are unchanged — the Flatpak wraps the same binary the `.deb` installs.

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
