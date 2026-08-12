#!/usr/bin/env bash
#
# Build Manu's Linux AppImage, then remove the host infrastructure libraries
# that linuxdeploy over-bundles, and repack.
#
# WHY THIS EXISTS
# ---------------
# linuxdeploy follows the dependency graph of libwebkit2gtk and sweeps a lot of
# the build host's base system into usr/lib — including libwayland-client,
# libwayland-egl and the GLib family. AppRun then puts that directory first on
# LD_LIBRARY_PATH.
#
# WebKitGTK does not bundle libEGL: it dlopens the *host's*. On the target the
# host's Mesa then resolves its own dependencies against the AppImage's older
# copies, and eglGetDisplay(EGL_DEFAULT_DISPLAY) fails:
#
#     Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
#
# This is why WEBKIT_DISABLE_DMABUF_RENDERER and friends do not help — the
# failure is in PlatformDisplay creation, before any renderer is chosen.
#
# libwayland-client is on the canonical AppImage excludelist for exactly this
# reason. The wider set below is the one reported to work in
# https://github.com/tauri-apps/tauri/issues/15665 (open upstream; there is no
# released Tauri that does this for us).
#
# These libraries are all "assumed present on the host" by AppImage convention.
# Dropping them raises Manu's baseline to a host with GLib >= 2.80, which every
# current desktop distribution satisfies.
#
# Usage:  scripts/package-appimage.sh [--skip-build]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="$ROOT/apps/desktop/src-tauri/target/release/bundle/appimage"
CACHE="${HOME}/.cache/tauri"

# AppImages need FUSE to self-mount; extract-and-run works without it.
export APPIMAGE_EXTRACT_AND_RUN=1

if [[ "${1:-}" != "--skip-build" ]]; then
  echo "==> Building (tauri build --bundles appimage)"
  ( cd "$ROOT/apps/desktop" && pnpm exec tauri build --bundles appimage )
fi

APPDIR="$(find "$BUNDLE" -maxdepth 1 -name "*.AppDir" -type d | head -1)"
[[ -d "$APPDIR" ]] || { echo "No AppDir under $BUNDLE" >&2; exit 1; }

# Libraries the host must provide. Removing them lets the host's own copies —
# and therefore the host's own Mesa — load consistently.
PRUNE=(
  # The documented cause: on the canonical pkg2appimage excludelist because
  # bundling it breaks newer Mesa.
  'libwayland-client.so*' 'libwayland-cursor.so*' 'libwayland-egl.so*' 'libwayland-server.so*'
  # GLib family — the host's Mesa and GIO modules must agree with the host.
  'libglib-2.0.so*' 'libgio-2.0.so*' 'libgobject-2.0.so*' 'libgmodule-2.0.so*'
  # GStreamer: pulled in as a WebKit dependency, never used by Manu
  # (bundleMediaFramework is off), and shadows the host's plugin ABI.
  'libgst*.so*'
  # Base-system libraries Mesa and GLib both link.
  'libffi.so*' 'libpcre2-8.so*' 'libzstd.so*' 'libelf.so*'
  'libmount.so*' 'libblkid.so*' 'libselinux.so*'
)

echo "==> Pruning over-bundled host libraries from $(basename "$APPDIR")"
removed=0
for pattern in "${PRUNE[@]}"; do
  while IFS= read -r -d '' lib; do
    rm -f "$lib"
    echo "    removed $(basename "$lib")"
    removed=$((removed + 1))
  done < <(find "$APPDIR/usr/lib" -maxdepth 1 -name "$pattern" -print0 2>/dev/null)
done
echo "    $removed file(s) removed"

# The GStreamer plugin directory is dead weight once the libraries are gone.
rm -rf "$APPDIR/usr/lib/gstreamer-1.0"

echo "==> Verifying the graphics stack is no longer shadowed"
for must_not in libwayland-client libwayland-egl libEGL libGL libgbm libdrm libglib-2.0; do
  if find "$APPDIR/usr/lib" -maxdepth 1 -name "${must_not}*" | grep -q .; then
    echo "    STILL PRESENT: $must_not" >&2
    exit 1
  fi
done
echo "    clean"

echo "==> Repacking"
# Keep the Tauri-style filename so the artifact is recognisably the same build.
VERSION="$(python3 -c "import json;print(json.load(open('$ROOT/apps/desktop/src-tauri/tauri.conf.json'))['version'])")"
OUT_NAME="Manu_${VERSION}_amd64.AppImage"
rm -f "$BUNDLE"/*.AppImage
( cd "$BUNDLE" && OUTPUT="$OUT_NAME" "$CACHE/linuxdeploy-plugin-appimage.AppImage" --appdir "$APPDIR" >/dev/null 2>&1 )

NEW="$BUNDLE/$OUT_NAME"
[[ -f "$NEW" ]] || { echo "Repack produced no $OUT_NAME" >&2; exit 1; }
echo
echo "==> $NEW"
ls -la "$NEW"
sha256sum "$NEW"
