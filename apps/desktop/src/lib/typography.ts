/**
 * How the manuscript is set.
 *
 * The one surface somebody looks at for four hours is the only one whose
 * typography is theirs rather than Manu's. Everything else in the application
 * keeps the brand's type; the page does not, because the right measure and the
 * right size are physical facts about a particular person's eyes and screen and
 * no default is right for everybody (docs/BRAND.md, docs/UX.md).
 *
 * Six settings, chosen because each changes how long somebody can work:
 * typeface, size, line height, paragraph spacing, measure, and whether the page
 * is lit or dark. There is no letter-spacing control and no justification
 * control — knobs whose good values are already set and whose bad values only
 * make prose harder to read.
 *
 * None of this touches the file. It is how the words are shown, not what is
 * stored, and a project opened on another machine is byte-identical.
 */

export const FACES = ["serif", "sans", "mono"] as const;
export type Face = (typeof FACES)[number];

export const FACE_LABEL: Readonly<Record<Face, string>> = {
  serif: "Serif",
  sans: "Sans",
  mono: "Monospace",
};

const FACE_STACK: Readonly<Record<Face, string>> = {
  serif: "var(--manu-font-manuscript)",
  sans: "var(--manu-font-ui)",
  mono: "var(--manu-font-mono)",
};

export interface ManuscriptStyle {
  readonly face: Face;
  /** Point size of the prose, in CSS pixels. */
  readonly size: number;
  /** Multiple of the size. */
  readonly lineHeight: number;
  /** Space between paragraphs, as a multiple of the size. */
  readonly paragraphSpacing: number;
  /** Characters per line — the measure, which is what actually tires an eye. */
  readonly measure: number;
}

/**
 * The bounds each setting is clamped to.
 *
 * A measure of 200 characters is not a preference, it is a mistake, and a
 * writer who reaches one by dragging should be stopped by the control rather
 * than discover it later. The ranges are wide enough to be genuinely useful —
 * 45 characters is a narrow column, 100 is a wide page — and no wider.
 */
export const LIMITS = {
  size: { min: 13, max: 26, step: 1 },
  lineHeight: { min: 1.3, max: 2.2, step: 0.05 },
  paragraphSpacing: { min: 0, max: 1.6, step: 0.1 },
  measure: { min: 45, max: 100, step: 1 },
} as const;

export const DEFAULT_STYLE: ManuscriptStyle = {
  face: "serif",
  size: 17,
  lineHeight: 1.75,
  paragraphSpacing: 0.9,
  measure: 68,
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function isFace(value: unknown): value is Face {
  return FACES.includes(value as Face);
}

/** Take anything and return a style that renders. Storage is untrusted input. */
export function repairStyle(value: unknown): ManuscriptStyle {
  if (typeof value !== "object" || value === null) return DEFAULT_STYLE;
  const raw = value as Record<string, unknown>;
  const num = (key: keyof typeof LIMITS, fallback: number) => {
    const given = raw[key];
    if (typeof given !== "number" || !Number.isFinite(given)) return fallback;
    return clamp(given, LIMITS[key].min, LIMITS[key].max);
  };
  return {
    face: isFace(raw["face"]) ? raw["face"] : DEFAULT_STYLE.face,
    size: num("size", DEFAULT_STYLE.size),
    lineHeight: num("lineHeight", DEFAULT_STYLE.lineHeight),
    paragraphSpacing: num("paragraphSpacing", DEFAULT_STYLE.paragraphSpacing),
    measure: num("measure", DEFAULT_STYLE.measure),
  };
}

/**
 * The style as CSS custom properties.
 *
 * Returned as data rather than written to the document, so the editor and the
 * preview can be styled from the same source and a test can assert what a
 * setting produces without a browser.
 *
 * The measure is expressed in `ch`, which is the width of a `0` in the face
 * actually being used — so "68 characters" stays 68 characters when the writer
 * changes typeface or size, which is exactly what they meant by it.
 */
export function styleVariables(style: ManuscriptStyle): Readonly<Record<string, string>> {
  return {
    "--manuscript-face": FACE_STACK[style.face],
    "--manuscript-size": `${style.size}px`,
    "--manuscript-leading": String(style.lineHeight),
    "--manuscript-paragraph": `${style.paragraphSpacing}em`,
    "--manuscript-measure": `${style.measure}ch`,
  };
}

const STORAGE_KEY = "manu.manuscript.style";

export function loadStyle(): ManuscriptStyle {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? DEFAULT_STYLE : repairStyle(JSON.parse(raw));
  } catch {
    return DEFAULT_STYLE;
  }
}

export function saveStyle(style: ManuscriptStyle): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(style));
  } catch {
    // A preference that will not persist is still a preference for this session.
  }
}
