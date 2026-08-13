import type { ReaderSeries } from "@jellytind/domain";
import { LEVEL_INDEX, READER_LEVELS } from "@jellytind/domain";

interface Props {
  series: ReaderSeries;
  /** A second reader over the same subject, for comparison. */
  compare?: ReaderSeries;
}

const WIDTH = 320;
const HEIGHT = 96;
const PAD = { left: 62, right: 8, top: 8, bottom: 18 };

/**
 * One dimension across the book.
 *
 * The axis is labelled with the words a reader used — none, low, moderate,
 * high — and never with a percentage, because the underlying answer was a band
 * and a number would invent precision that was never there. The caveat is
 * rendered with the chart rather than left to the page around it: a rising line
 * is the most persuasive object in this product, and what it is persuading you
 * of is a model's reading (docs/SIMULATIONS.md).
 */
export function ReaderChart({ series, compare }: Props) {
  const points = series.points;
  if (points.length === 0) return null;

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const span = Math.max(1, points.length - 1);
  const x = (index: number) => PAD.left + (index / span) * plotWidth;
  const y = (level: keyof typeof LEVEL_INDEX) =>
    PAD.top + plotHeight - (LEVEL_INDEX[level] / 3) * plotHeight;

  const path = (data: ReaderSeries["points"]) =>
    data
      .map(
        (point, index) => `${index === 0 ? "M" : "L"}${String(x(index))} ${String(y(point.level))}`,
      )
      .join(" ");

  return (
    <figure className="chart">
      <figcaption className="chart__title">{series.label}</figcaption>
      <svg
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        className="chart__svg"
        role="img"
        aria-label={`${series.label}: ${points.map((point) => `chapter ${String(point.position)} ${point.level}`).join(", ")}`}
      >
        {READER_LEVELS.map((level) => (
          <g key={level}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(level)}
              y2={y(level)}
              className="chart__grid"
            />
            <text x={PAD.left - 6} y={y(level) + 3} className="chart__tick" textAnchor="end">
              {level}
            </text>
          </g>
        ))}
        {compare !== undefined && compare.points.length > 0 && (
          <path d={path(compare.points)} className="chart__line chart__line--compare" />
        )}
        <path d={path(points)} className="chart__line" />
        {points.map((point, index) => (
          <circle
            key={point.chapterId}
            cx={x(index)}
            cy={y(point.level)}
            r={2}
            className="chart__dot"
          >
            <title>
              Chapter {point.position}: {point.level}
              {point.because === undefined ? "" : ` — ${point.because}`}
            </title>
          </circle>
        ))}
        <text x={PAD.left} y={HEIGHT - 4} className="chart__tick">
          ch 1
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 4} className="chart__tick" textAnchor="end">
          ch {points.at(-1)?.position ?? 1}
        </text>
      </svg>
      <p className="chart__caveat">{series.caveat}</p>
    </figure>
  );
}
