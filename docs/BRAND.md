# BRAND

The canonical brand reference for **Manu**. Anything that draws a colour, sets
the name or places the mark follows this document; the tokens it describes live
in [`apps/desktop/src/tokens.css`](../apps/desktop/src/tokens.css), which is the
single source of truth in code.

## The name

**Manu.** Always capitalised in prose, always lowercase in the wordmark.

> _manus_ → **hand** → _manuscript_, written by hand → _amanuensis_, the one who
> writes at another's dictation.
>
> **You are the author. Manu is the hand.**

That is the whole positioning, and it is a constraint as much as a slogan: Manu
does not decide, propose taste, or take the pen. It holds the manuscript steady,
remembers everything, and does what it is asked. Every piece of interface copy
should be readable in that light.

## The wordmark

Lowercase `manu`, set in **Martian Grotesk Condensed Light**, followed by a
vertical bar in Manuscript Red — a text caret, at the stem weight of the
letterforms.

```
manu|
```

The caret is the mark's only ornament and carries the idea: the point where
writing happens, in the colour of an editor's pen.

### Assets

Canonical assets live under
[`apps/desktop/src/assets/brand/`](../apps/desktop/src/assets/brand/):

| File                           | Use                                                 |
| ------------------------------ | --------------------------------------------------- |
| `wordmark/manu-primary.svg`    | Manu Black letterforms, for light backgrounds       |
| `wordmark/manu-reversed.svg`   | Paper letterforms, for dark backgrounds             |
| `wordmark/manu-monochrome.svg` | `currentColor`, for single-ink contexts             |
| `icon/manu-app-icon.svg`       | The application icon: `m` and caret on a black tile |
| `icon/manu-mark.svg`           | The same mark with no tile                          |
| `OFL.txt`                      | The typeface licence                                |

In the application the wordmark is drawn by
[`components/Wordmark.tsx`](../apps/desktop/src/components/Wordmark.tsx), which
carries the same outlines inline so the letters take the surrounding ink colour
while the caret keeps Manuscript Red.

The PNG icons under `src-tauri/icons/` are **generated**, never edited by hand:

```bash
pip install cairosvg && python3 scripts/generate-icons.py
```

### Typography and licensing

Martian Grotesk is by [Evil Martians](https://github.com/evilmartians/grotesk)
and is distributed under the **SIL Open Font License 1.1**
(Copyright 2021 The Martian Grotesk Project Authors). The licence text ships
next to the assets.

**No font file is bundled with Manu.** The wordmark's letterforms were converted
to outlines by [`scripts/build-brand-assets.py`](../scripts/build-brand-assets.py),
so the assets are pure vector paths and render identically everywhere with
nothing downloaded and nothing installed. The interface itself uses the reader's
own system stack (`--manu-font-ui`, `--manu-font-mono`,
`--manu-font-manuscript`).

### What the wordmark is not

- **OnlySans is not an approved Manu brand font.** It is not part of the brand
  specification, must not be introduced into this project, and must not be used
  to set the wordmark, the interface, or any brand material.
- The wordmark is never re-set in Inter, Arial, Helvetica, a system sans, a
  generic condensed face, or any visually similar substitute. If the canonical
  asset cannot be used for a genuine technical reason, a fallback typeface is a
  **temporary** measure to be recorded and removed — never the final logo.
- The wordmark is not restyled: no gradient, no outline, no shadow, no rotation,
  no re-spacing, no recolouring of the letterforms away from ink, no changing the
  caret's colour.
- `manu` is not capitalised in the mark, and the caret is not dropped.

## The palette

Four colours, exactly. No substitutes, no near-misses.

| Name               | Value     | Role                                              |
| ------------------ | --------- | ------------------------------------------------- |
| **Manu Black**     | `#0F0F10` | The ground in dark, the ink in light              |
| **Paper**          | `#F6F4F1` | The ground in light, the ink in dark              |
| **Graphite**       | `#6B6B6B` | Subordinate text, rules, things not being read    |
| **Manuscript Red** | `#C53128` | The hand: the caret, selection, the current thing |

Everything else in the interface is a **tint or shade of those four**, defined
once in `tokens.css` so that surfaces can be told apart on a screen. They are
not additional brand colours and may not be quoted as such.

### Token layers

```
primitives          --manu-black · --manu-paper · --manu-graphite · --manu-manuscript-red
derived neutrals    --manu-bg · --manu-surface[-raised|-sunken] · --manu-ink[-muted|-subtle|-inverse]
                    --manu-border[-strong]
semantics           --manu-accent[-strong|-text|-on|-wash] · --manu-focus · --manu-selection
                    --manu-success · --manu-warning · --manu-error · --manu-info (+ -wash)
                    --manu-scrim
```

Components use **semantic** tokens only. A component that needs a colour the
semantics do not offer needs a new semantic token, not a hex value.

`--manu-accent-text` exists because Manuscript Red at `#C53128` does not carry
enough contrast to be read as small text on Manu Black. Fills, borders and
indicators use the true red; accent-coloured _text_ uses a tint of the same hue
that clears 4.5:1 in both themes.

### Two themes

Dark (Manu Black ground) is the default; light (Paper ground) is a first-class
alternative, and "system" — following the desktop — is what a fresh install
uses. The writer's choice is remembered under `manu.theme`.

## Colour never carries meaning alone

Two rules, and they are the reason the palette is arranged the way it is.

**1. The brand accent never carries diagnostic meaning.** Manuscript Red marks
Manu's own hand — the caret, text selection, the focused control, the current
tab, the item you are on, work an agent did. It never means "this is broken". A
writer must be able to tell a button from a failure.

**2. No diagnostic meaning depends on colour alone.** `--manu-error` is a
distinctly lighter and pinker red than Manuscript Red in dark, and a distinctly
deeper and cooler one in light, so the two never read as the same mark — but the
separation does not rest on that. Every severity is rendered with the word and a
glyph as well as a hue:

```
!  ERROR      ▲  WARNING      i  INFO      ✓  PASSED
```

That is the `.severity` class in `styles.css`. A build diagnostic, a test
result, or a validation failure that reaches the screen without its word and
glyph is a bug, not a style choice.

## Voice

- Plain, specific, unexcited. The interface says what it did and what it found.
- Prefer the concrete noun to the abstraction: "2 plot threads rest on what is
  changing", not "potential downstream impact detected".
- Distinguish what is recorded from what a model read into it, always and
  visibly ([STORY_COMPILER.md](STORY_COMPILER.md)).
- Never claim work that was not done. "Skipped" is not "passed"; silence is not
  a claim.
- No exclamation marks, no congratulation, no personality. Manu is not a
  character in the writer's book.
- The application is not a marketing page. Product claims belong in the README.

## Known gaps

- The internal package scope is still `@jellytind/*`. It is not user-visible —
  it appears in no window, string, bundle name or artifact — and renaming every
  package would touch every import in the repository for a cosmetic result.
  Deferred deliberately; see AGENTS.md on not rewriting stable architecture for
  cosmetic reasons.
