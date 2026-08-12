#!/usr/bin/env python3
"""Rasterise the vector Manu app icon into the PNG sizes the Tauri bundler needs.

The vector master under apps/desktop/src/assets/brand/icon/ is the source of
truth; everything in apps/desktop/src-tauri/icons/ is generated from it.

Usage:

    pip install cairosvg
    python3 scripts/generate-icons.py
"""

from __future__ import annotations

import pathlib

import cairosvg

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "apps" / "desktop" / "src" / "assets" / "brand" / "icon" / "manu-app-icon.svg"
OUT = ROOT / "apps" / "desktop" / "src-tauri" / "icons"

# Tauri's Linux bundles read these four; the @2x name is the 256px render.
SIZES = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    source = SRC.read_bytes()
    for name, size in SIZES.items():
        destination = OUT / name
        cairosvg.svg2png(
            bytestring=source,
            write_to=str(destination),
            output_width=size,
            output_height=size,
        )
        print(f"wrote {destination.relative_to(ROOT)}  {size}x{size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
