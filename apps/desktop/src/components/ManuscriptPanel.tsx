import { useCallback, useEffect, useState } from "react";
import type { Chapter } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import { chapterNumberLabel } from "../lib/naming";
import { countWords } from "../lib/markdown";
import { splitFrontMatter } from "../lib/front-matter";

interface Props {
  repo: StoryRepository;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  refreshToken: number;
  onChanged: () => void;
}

interface Row {
  readonly chapter: Chapter;
  readonly words: number;
}

/**
 * The book, as a table of contents.
 *
 * This replaced the file tree as the way a writer moves around their novel. The
 * tree still exists — under Advanced, where openness belongs and where nobody
 * has to look at `CHAPTER_0007.md` to open chapter seven (docs/UX.md).
 *
 * Word counts are read from the files rather than from a record, because a
 * count that disagrees with the words is worse than no count. Chapters in a
 * novel number in the tens, so reading them is cheap; if that ever stops being
 * true the answer is a cached count with an honest staleness marker, not a
 * guess.
 */
export function ManuscriptPanel({ repo, activePath, onOpenFile, refreshToken, onChanged }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const chapters = [...(await repo.listChapters())].sort((a, b) => a.order - b.order);
    const counted = await Promise.all(
      chapters.map(async (chapter) => ({
        chapter,
        words: countWords(
          splitFrontMatter((await repo.readProjectFile(chapter.filePath)) ?? "").body,
        ),
      })),
    );
    setRows(counted);
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  async function addChapter() {
    setBusy(true);
    try {
      const created = await repo.addChapter({ title: "Untitled chapter" });
      onChanged();
      onOpenFile(created.filePath);
    } finally {
      setBusy(false);
    }
  }

  const total = (rows ?? []).reduce((sum, row) => sum + row.words, 0);

  return (
    <div className="library">
      {rows === null ? (
        <p className="placeholder">Reading the manuscript…</p>
      ) : rows.length === 0 ? (
        <div className="empty empty--panel">
          <p className="empty__title">No chapters yet</p>
          <p className="empty__body">
            A chapter is a plain file in your project folder. Make the first one and start writing.
          </p>
          <button className="btn btn--primary btn--small" onClick={() => void addChapter()}>
            New chapter
          </button>
        </div>
      ) : (
        <>
          <ol className="library__list">
            {rows.map((row, index) => (
              <li key={row.chapter.id}>
                <button
                  className={`library__row${
                    row.chapter.filePath === activePath ? " library__row--active" : ""
                  }`}
                  title={row.chapter.filePath}
                  onClick={() => onOpenFile(row.chapter.filePath)}
                >
                  {/*
                    Numbered by position, not by the `order` key. The key is
                    0-based and allows gaps, so a book whose chapters are keyed
                    0, 5, 6 still reads One, Two, Three — which is what a reader
                    would call them.
                  */}
                  <span className="library__number">{chapterNumberLabel(index)}</span>
                  <span className="library__title">{row.chapter.title}</span>
                  <span className="library__meta">
                    {row.words === 0 ? "empty" : `${row.words.toLocaleString()} words`}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="library__foot">
            <span className="library__total">
              {rows.length} {rows.length === 1 ? "chapter" : "chapters"} · {total.toLocaleString()}{" "}
              words
            </span>
            <button
              className="btn btn--ghost btn--small"
              disabled={busy}
              onClick={() => void addChapter()}
            >
              New chapter
            </button>
          </div>
        </>
      )}
    </div>
  );
}
