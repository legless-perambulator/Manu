import { useCallback, useEffect, useState } from "react";
import type { Chapter, Scene } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import { chapterNumberLabel } from "../lib/naming";

interface Props {
  repo: StoryRepository;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onSelectEntity: (id: string) => void;
  refreshToken: number;
  onChanged: () => void;
}

interface ChapterRow {
  readonly chapter: Chapter;
  readonly scenes: readonly Scene[];
}

/**
 * The shape of the book.
 *
 * Chapters, the scenes inside them, and the order they are told in. The audit's
 * complaint was that a writer had to manage manuscript order by looking at file
 * names; here they move a chapter with a button and Manu rewrites the `order`
 * key through the ordinary mutation path — journalled, undoable from History,
 * exactly like any other change (docs/VERSIONING.md).
 *
 * Reordering moves the chapter's *place in the telling*. It does not move,
 * rename or touch any file: the file stays where it is and the record says
 * where it sits, which is why this is safe to offer.
 */
export function OutlinePanel({
  repo,
  activePath,
  onOpenFile,
  onSelectEntity,
  refreshToken,
  onChanged,
}: Props) {
  const [rows, setRows] = useState<ChapterRow[] | null>(null);
  const [loose, setLoose] = useState<readonly Scene[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [chapters, scenes] = await Promise.all([repo.listChapters(), repo.listScenes()]);
    const ordered = [...chapters].sort((a, b) => a.order - b.order);
    setRows(
      ordered.map((chapter) => ({
        chapter,
        scenes: scenes.filter((scene) => scene.chapterId === chapter.id),
      })),
    );
    setLoose(scenes.filter((scene) => scene.chapterId === undefined));
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  /**
   * Swap a chapter with its neighbour.
   *
   * Both records are written, because `order` is a key and leaving two chapters
   * claiming the same place would be a silent corruption of the book's
   * sequence. If the second write fails the first is still journalled and
   * visible in History, which is the honest failure mode.
   */
  async function move(index: number, by: -1 | 1) {
    const list = rows ?? [];
    const here = list[index]?.chapter;
    const there = list[index + by]?.chapter;
    if (here === undefined || there === undefined) return;
    setBusy(true);
    try {
      await repo.updateEntity<Chapter>(here.id as string, { order: there.order });
      await repo.updateEntity<Chapter>(there.id as string, { order: here.order });
      onChanged();
      await reload();
    } finally {
      setBusy(false);
    }
  }

  if (rows === null) return <p className="placeholder">Reading the outline…</p>;

  if (rows.length === 0) {
    return (
      <div className="empty empty--panel">
        <p className="empty__title">Nothing to outline yet</p>
        <p className="empty__body">
          Chapters and scenes appear here as you make them. The outline is read from the book — it
          is not a second thing to keep up to date.
        </p>
      </div>
    );
  }

  return (
    <div className="outline">
      {rows.map((row, index) => (
        <section className="outline__chapter" key={row.chapter.id}>
          <div className="outline__head">
            <button
              className={`outline__title${
                row.chapter.filePath === activePath ? " outline__title--active" : ""
              }`}
              onClick={() => onOpenFile(row.chapter.filePath)}
              title={row.chapter.filePath}
            >
              {/* By position, not by the ordering key, which may have gaps. */}
              <span className="outline__number">{chapterNumberLabel(index)}</span>
              <span>{row.chapter.title}</span>
            </button>
            <span className="outline__moves">
              <button
                className="outline__move"
                disabled={busy || index === 0}
                aria-label={`Move ${row.chapter.title} earlier`}
                title="Move earlier"
                onClick={() => void move(index, -1)}
              >
                ↑
              </button>
              <button
                className="outline__move"
                disabled={busy || index === rows.length - 1}
                aria-label={`Move ${row.chapter.title} later`}
                title="Move later"
                onClick={() => void move(index, 1)}
              >
                ↓
              </button>
            </span>
          </div>
          {row.scenes.length === 0 ? (
            <p className="outline__none">No scenes recorded</p>
          ) : (
            <ul className="outline__scenes">
              {row.scenes.map((scene) => (
                <li key={scene.id}>
                  <button
                    className="outline__scene"
                    onClick={() => onSelectEntity(scene.id as string)}
                    title={scene.id as string}
                  >
                    <span>{scene.title}</span>
                    {scene.status !== "planned" && (
                      <span className="outline__status">{scene.status}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {loose.length > 0 && (
        <section className="outline__chapter">
          <div className="outline__head">
            <span className="outline__title outline__title--plain">Not in a chapter yet</span>
          </div>
          <ul className="outline__scenes">
            {loose.map((scene) => (
              <li key={scene.id}>
                <button
                  className="outline__scene"
                  onClick={() => onSelectEntity(scene.id as string)}
                  title={scene.id as string}
                >
                  {scene.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
