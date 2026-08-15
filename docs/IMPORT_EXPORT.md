# IMPORT & EXPORT

Manuscript import, professional export, and the portable project archive.

- **Packages:** `@jellytind/manuscript-io` (formats and the archive), wired to
  the desktop through the import wizard, the Export panel and two audited
  Rust file commands
- **Status (Phase 40 Parts A & C):** implemented and tested. DOCX, Markdown,
  plain text and EPUB import with preview and correction; DOCX, EPUB, PDF,
  Markdown and plain-text export with a Standard Manuscript preset; the Manu
  project archive with round-trip and Backup Project To….

## Import (Part A)

Four formats import for real — DOCX, Markdown, plain text, EPUB — and land on
one `ImportedManuscript` shape, so the rest of Manu never cares which format a
book arrived in. PDF is deliberately not pretended into an editable manuscript
format: extraction quality cannot be guaranteed, so it is not offered.

**The source file is never modified** (§2). Import reads the bytes once,
creates a new project (or restores an archive), and records provenance —
file name, format, date, word count — in `.writer/import/provenance.json`.

**Preview before commit** (§3): detected title and author, every chapter with
its word count and how its boundary was found, formatting that was preserved,
and problems stated plainly ("the whole text imports as one chapter"). The
writer corrects titles and drops chapters before anything is created.

**Chapter detection is deterministic first** (§4): DOCX heading styles, then
Markdown headings, then EPUB spine sections, then textual patterns ("Chapter
Seven", "PROLOGUE", short full-capital lines). Meaningful formatting —
italics, bold, headings, paragraphs, scene breaks, block quotes — survives as
Manu's own Markdown; Word's styling clutter does not (§6).

The container work underneath is self-contained: a ZIP reader that handles
stored and deflate entries with a pluggable inflate (Node `zlib` in tests,
`DecompressionStream` in the app) and a stored-method ZIP writer, no
dependencies. EPUB import walks `container.xml` → OPF → spine, operates only
on accessible user-provided files, and includes no DRM handling (§30).

## Export (Part C)

Every manuscript export starts from the same cleaned chapters: YAML front
matter, scene markers, HTML comments and stable IDs are stripped by one shared
function, and the tests — and the Export panel itself, at write time — verify
the _absence_ of internal data rather than assuming it (§33).

| Format         | What it is                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DOCX**       | Minimal valid OOXML: heading-styled chapters, emphasis, centred scene breaks, optional title page and running header with page numbers. Editable.             |
| **EPUB**       | Valid EPUB 3: metadata, `nav.xhtml` contents, one XHTML chapter per chapter, emphasis and `<hr/>` scene breaks. `mimetype` first and stored, by construction. |
| **PDF**        | A clean proofing document set in Courier — fixed-pitch, so wrapping is exact — never the canonical manuscript (§36).                                          |
| **Markdown**   | The book as portable Markdown.                                                                                                                                |
| **Plain text** | Just the words.                                                                                                                                               |

The **Standard Manuscript preset** (§32) reads as traditional submission
formatting — Courier 12, double-spaced, chapters on fresh pages, title page,
author/title/page header — with every detail configurable, because no single
publisher's rules are universal.

## The project archive (§37–§40)

**Export Manu Project** packages the complete Story Repository — manuscript,
structured story data, research, settings, revision metadata — as one ZIP.
API credentials never enter it: they live in the system keychain, not in
project files, and an exclusion list stands guard anyway. **Back up project
to…** is the same archive pointed at a location the writer chooses — the
answer to the audit's finding that project-local backups cannot survive losing
the project directory. Nothing assumes cloud storage.

The archive round-trips: restoring builds the project in a temporary folder,
validates it as a real Manu project, and only then promotes it into place —
the same transactional shape as project creation. The §42 acceptance test
exports a mapped project, restores it, reopens it and compares every chapter
byte for byte.

## File access

Two Rust commands are the only paths outside a project folder: read one
user-chosen file (import), write one user-chosen file atomically via a sibling
temp file (export, backup). Both demand absolute dialog-chosen paths, and
imports never gain a write path to their source.

## Relationship to other subsystems

- [STORY_MAPPING.md](STORY_MAPPING.md) — what happens after import: the
  reverse-mapping pipeline that reconstructs the structured project.
- [STORY_REPOSITORY.md](STORY_REPOSITORY.md) — chapter files carry their
  record as front matter; import writes prose under it, never over it.
- [SECURITY_PRIVACY.md](SECURITY_PRIVACY.md) — why secrets cannot travel in
  an archive.
