#!/usr/bin/env python3
"""Regenerate the canonical Manu brand assets.

The `manu` wordmark is set in Martian Grotesk Condensed Light and converted to
outlines, so the published assets carry no live text and need no font at
runtime. See docs/BRAND.md.

Usage:

    pip install fonttools
    python3 scripts/build-brand-assets.py path/to/MartianGroteskCondensed-Light.ttf

The typeface is Martian Grotesk by Evil Martians, SIL Open Font License 1.1:
https://github.com/evilmartians/grotesk
"""

from __future__ import annotations

import pathlib
import sys

from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "desktop" / "src" / "assets" / "brand"

MANU_BLACK = "#0F0F10"
MANU_PAPER = "#F6F4F1"
MANU_MANUSCRIPT_RED = "#C53128"

# The caret carries the same stem width as the letterforms, stands a little
# above cap height and overshoots the baseline — a text cursor, at the weight
# of the writing.
CARET_WIDTH = 96
CARET_TOP = -700.0
CARET_BOTTOM = 24.0
WORDMARK_CARET_GAP = 52
ICON_CARET_GAP = 64

PROVENANCE = (
    "Wordmark set in Martian Grotesk Condensed Light (SIL Open Font License 1.1, "
    "Copyright 2021 The Martian Grotesk Project Authors) and converted to outlines. "
    "No font file is required to render this asset."
)


def load(font_path: str):
    font = TTFont(font_path)
    return font, font.getBestCmap(), font.getGlyphSet(), font["hmtx"]


def outline(text: str, cmap, glyphs, hmtx):
    """Return (path data, ink bounds, total advance) in SVG coordinates."""
    x = 0.0
    parts: list[str] = []
    bounds = None
    for ch in text:
        name = cmap[ord(ch)]
        # SVG y grows downward; the font's y grows upward.
        flip = Transform(1, 0, 0, -1, x, 0)
        pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.1f}")
        glyphs[name].draw(TransformPen(pen, flip))
        parts.append(pen.getCommands())

        measure = BoundsPen(glyphs)
        glyphs[name].draw(TransformPen(measure, flip))
        if measure.bounds:
            bounds = (
                measure.bounds
                if bounds is None
                else (
                    min(bounds[0], measure.bounds[0]),
                    min(bounds[1], measure.bounds[1]),
                    max(bounds[2], measure.bounds[2]),
                    max(bounds[3], measure.bounds[3]),
                )
            )
        x += hmtx[name][0]
    return " ".join(parts), bounds, x


def caret(x: float) -> str:
    height = CARET_BOTTOM - CARET_TOP
    return f'<rect x="{x:.1f}" y="{CARET_TOP:.1f}" width="{CARET_WIDTH}" height="{height:.1f}"/>'


def wordmark(ink: str, caret_fill: str, cmap, glyphs, hmtx) -> str:
    d, bounds, advance = outline("manu", cmap, glyphs, hmtx)
    caret_x = advance + WORDMARK_CARET_GAP
    pad = 40
    x0, y0 = bounds[0] - pad, CARET_TOP - pad
    width = (caret_x + CARET_WIDTH + pad) - x0
    height = (CARET_BOTTOM + pad) - y0
    caret_el = caret(caret_x)
    if caret_fill != ink:
        caret_el = f'<g fill="{caret_fill}">{caret_el}</g>'
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{x0:.1f} {y0:.1f} {width:.1f} {height:.1f}" role="img" aria-label="manu">\n'
        f"  <title>Manu</title>\n"
        f"  <desc>{PROVENANCE}</desc>\n"
        f'  <g fill="{ink}">\n'
        f'    <path d="{d}"/>\n'
        f"    {caret_el}\n"
        f"  </g>\n"
        f"</svg>\n"
    )


def icon(tile_fill: str | None, letter_fill: str, cmap, glyphs, hmtx) -> str:
    d, bounds, advance = outline("m", cmap, glyphs, hmtx)
    tile = 1024
    mark_width = advance + ICON_CARET_GAP + CARET_WIDTH
    mark_height = CARET_BOTTOM - CARET_TOP
    scale = 0.62 * tile / mark_width
    tx = (tile - mark_width * scale) / 2 - bounds[0] * scale
    ty = tile / 2 - (CARET_TOP + mark_height / 2) * scale
    background = (
        f'  <rect width="{tile}" height="{tile}" rx="224" fill="{tile_fill}"/>\n'
        if tile_fill
        else ""
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {tile} {tile}" '
        f'role="img" aria-label="Manu">\n'
        f"  <title>Manu</title>\n"
        f"  <desc>{PROVENANCE}</desc>\n"
        f"{background}"
        f'  <g transform="translate({tx:.1f} {ty:.1f}) scale({scale:.4f})">\n'
        f'    <path d="{d}" fill="{letter_fill}"/>\n'
        f'    <g fill="{MANU_MANUSCRIPT_RED}">{caret(advance + ICON_CARET_GAP)}</g>\n'
        f"  </g>\n"
        f"</svg>\n"
    )


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    _font, cmap, glyphs, hmtx = load(sys.argv[1])

    (OUT / "wordmark").mkdir(parents=True, exist_ok=True)
    (OUT / "icon").mkdir(parents=True, exist_ok=True)

    assets = {
        "wordmark/manu-primary.svg": wordmark(
            MANU_BLACK, MANU_MANUSCRIPT_RED, cmap, glyphs, hmtx
        ),
        "wordmark/manu-reversed.svg": wordmark(
            MANU_PAPER, MANU_MANUSCRIPT_RED, cmap, glyphs, hmtx
        ),
        "wordmark/manu-monochrome.svg": wordmark(
            "currentColor", "currentColor", cmap, glyphs, hmtx
        ),
        "icon/manu-app-icon.svg": icon(MANU_BLACK, MANU_PAPER, cmap, glyphs, hmtx),
        "icon/manu-mark.svg": icon(None, "currentColor", cmap, glyphs, hmtx),
    }
    for name, content in assets.items():
        (OUT / name).write_text(content)
        print(f"wrote {(OUT / name).relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
