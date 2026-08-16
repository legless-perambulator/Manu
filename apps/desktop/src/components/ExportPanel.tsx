import { useMemo, useState } from "react";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  STANDARD_MANUSCRIPT,
  buildProjectArchive,
  exportDocx,
  exportEpub,
  exportMarkdown,
  exportPdf,
  exportPlainText,
  leaksInternalData,
  toExportManuscript,
  type ExportManuscript,
  type ManuscriptFormatOptions,
} from "@jellytind/manuscript-io";
import { pickSaveFile, writeExternalFile } from "../lib/external-files";
import { pickDirectory } from "../lib/dialog";
import {
  loadBackupSettings,
  runExternalBackup,
  saveBackupSettings,
  type BackupSettings,
} from "../lib/backup-schedule";
import { isTauri } from "../tauri";

interface Props {
  repo: StoryRepository;
  refreshToken: number;
}

type ExportFormat = "docx" | "epub" | "pdf" | "markdown" | "text" | "archive";

const FORMATS: ReadonlyArray<{ id: ExportFormat; label: string; extension: string; hint: string }> =
  [
    { id: "docx", label: "Word document", extension: "docx", hint: "Editable, submission-ready" },
    { id: "epub", label: "Ebook", extension: "epub", hint: "EPUB 3 with navigation" },
    { id: "pdf", label: "PDF", extension: "pdf", hint: "Clean reading and proofing copy" },
    { id: "markdown", label: "Markdown", extension: "md", hint: "Portable plain structure" },
    { id: "text", label: "Plain text", extension: "txt", hint: "Just the words" },
    {
      id: "archive",
      label: "Manu project archive",
      extension: "zip",
      hint: "The complete portable project — manuscript, story data, research",
    },
  ];

/**
 * Export and publishing (Phase 40 Part C).
 *
 * Every manuscript format goes out through the same clean layer: front matter,
 * scene markers, IDs and every other internal detail are stripped before a
 * byte is written, and the panel verifies the absence rather than assuming it
 * (§33). The project archive is the exception that *keeps* internal data —
 * that is its job — and it still never carries a secret. "Back up project to…"
 * is the same archive pointed somewhere safe (§38).
 */
export function ExportPanel({ repo, refreshToken }: Props) {
  void refreshToken;
  const [format, setFormat] = useState<ExportFormat>("docx");
  const [author, setAuthor] = useState("");
  const [options, setOptions] = useState<ManuscriptFormatOptions>(STANDARD_MANUSCRIPT);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backup, setBackup] = useState<BackupSettings>(() =>
    loadBackupSettings(repo.project.id as string),
  );

  const chosen = useMemo(
    () => FORMATS.find((held) => held.id === format) ?? (FORMATS[0] as (typeof FORMATS)[number]),
    [format],
  );

  async function cleanManuscript(): Promise<ExportManuscript> {
    const chapters = [...(await repo.listChapters())].sort((a, b) => a.order - b.order);
    const raws: Array<{ title: string; raw: string }> = [];
    for (const chapter of chapters) {
      raws.push({
        title: chapter.title,
        raw: (await repo.readProjectFile(chapter.filePath)) ?? "",
      });
    }
    return toExportManuscript(
      repo.project.title,
      author.trim() === "" ? "Anonymous" : author.trim(),
      raws,
    );
  }

  async function produce(): Promise<Uint8Array> {
    if (format === "archive") {
      const paths = await repo.listProjectFiles();
      const files: Array<{ path: string; content: string }> = [];
      for (const path of paths) {
        const content = await repo.readProjectFile(path);
        if (content !== null) files.push({ path, content });
      }
      return buildProjectArchive(files);
    }
    const manuscript = await cleanManuscript();
    let bytes: Uint8Array;
    if (format === "docx") bytes = exportDocx(manuscript, options);
    else if (format === "epub") bytes = exportEpub(manuscript);
    else if (format === "pdf") bytes = exportPdf(manuscript, options);
    else if (format === "markdown") bytes = new TextEncoder().encode(exportMarkdown(manuscript));
    else bytes = new TextEncoder().encode(exportPlainText(manuscript));

    // The guarantee, checked at the door: no internal data in a manuscript.
    if (leaksInternalData(new TextDecoder().decode(bytes))) {
      throw new Error("Export blocked: internal project data would have leaked. Report this.");
    }
    return bytes;
  }

  async function exportTo(defaultName: string) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      if (!isTauri()) {
        throw new Error("Exports need the desktop application (file access).");
      }
      const path = await pickSaveFile(
        format === "archive" ? "Back up or export the project" : "Export the manuscript",
        defaultName,
        chosen.extension,
      );
      if (path === null) return;
      await writeExternalFile(path, await produce());
      setStatus(`Written to ${path}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const slug = repo.project.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

  return (
    <div className="state exportpanel">
      <section className="state__section">
        <h3>Export</h3>
        <p className="hint">
          The manuscript leaves clean: no IDs, no scene markers, no story state — only the book
          (verified on every export). The project archive is the whole portable project instead, for
          backup and transfer; it never includes API keys.
        </p>
        <div className="export__formats">
          {FORMATS.map((held) => (
            <button
              key={held.id}
              className={`export__format${format === held.id ? " is-active" : ""}`}
              onClick={() => setFormat(held.id)}
            >
              <span>{held.label}</span>
              <span className="hint">{held.hint}</span>
            </button>
          ))}
        </div>

        {format !== "archive" && (
          <>
            <label className="field">
              <span>Author name (title page and header)</span>
              <input
                value={author}
                placeholder="Your name as it should appear"
                onChange={(event) => setAuthor(event.target.value)}
              />
            </label>
            {(format === "docx" || format === "pdf") && (
              <div className="export__options">
                <label className="field">
                  <span>Typeface</span>
                  <select
                    value={options.font}
                    onChange={(event) =>
                      setOptions({ ...options, font: event.target.value as "courier" | "serif" })
                    }
                  >
                    <option value="courier">Courier (typewriter)</option>
                    <option value="serif">Serif (book)</option>
                  </select>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={options.doubleSpaced}
                    onChange={(event) =>
                      setOptions({ ...options, doubleSpaced: event.target.checked })
                    }
                  />
                  Double-spaced
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={options.chapterOnNewPage}
                    onChange={(event) =>
                      setOptions({ ...options, chapterOnNewPage: event.target.checked })
                    }
                  />
                  Chapters start a new page
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={options.includeTitlePage}
                    onChange={(event) =>
                      setOptions({ ...options, includeTitlePage: event.target.checked })
                    }
                  />
                  Title page
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={options.pageNumbers}
                    onChange={(event) =>
                      setOptions({ ...options, pageNumbers: event.target.checked })
                    }
                  />
                  Page numbers in the header
                </label>
              </div>
            )}
          </>
        )}

        <div className="mapping__actions">
          <button
            className="btn btn--primary"
            disabled={busy}
            onClick={() => void exportTo(`${slug}.${chosen.extension}`)}
          >
            {format === "archive" ? "Export project archive…" : `Export ${chosen.label}…`}
          </button>
          {format === "archive" && (
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                void exportTo(`${slug}-backup-${new Date().toISOString().slice(0, 10)}.zip`)
              }
            >
              Back up project to…
            </button>
          )}
        </div>
        {status !== null && <p className="status status--ok">{status}</p>}
        {error !== null && <p className="status status--error">{error}</p>}
      </section>

      <section className="state__section">
        <h3>Scheduled backups</h3>
        <p className="hint">
          Point backups at any folder this machine can reach — an external drive, a NAS mount, a
          cloud-sync directory. No account needed. Backups are deduplicated: nothing is written when
          nothing changed, and every backup restores through the start screen's import.
        </p>
        <p className="hint">
          Destination: {backup.destination ?? "not set — external backups are off"}
          {backup.lastRunAt !== undefined
            ? ` · last run ${new Date(backup.lastRunAt).toLocaleString()}`
            : ""}
        </p>
        <div className="mapping__actions">
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              void (async () => {
                const chosenDir = await pickDirectory("Choose a backup folder");
                if (chosenDir === null) return;
                const next = { ...backup, destination: chosenDir };
                saveBackupSettings(repo.project.id as string, next);
                setBackup(next);
              })()
            }
          >
            Choose destination…
          </button>
          <select
            value={backup.schedule}
            onChange={(event) => {
              const next = {
                ...backup,
                schedule: event.target.value as BackupSettings["schedule"],
              };
              saveBackupSettings(repo.project.id as string, next);
              setBackup(next);
            }}
          >
            <option value="manual">Manual only</option>
            <option value="on_close">On close</option>
            <option value="daily">Daily</option>
          </select>
          <button
            className="btn btn--small"
            disabled={busy || backup.destination === undefined}
            onClick={() =>
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  const outcome = await runExternalBackup(repo, { force: true });
                  setStatus(
                    outcome.result === "written"
                      ? `Backed up to ${outcome.file ?? "the destination"}.`
                      : "Nothing changed since the last backup.",
                  );
                  setBackup(loadBackupSettings(repo.project.id as string));
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            Back up now
          </button>
        </div>
      </section>
    </div>
  );
}
