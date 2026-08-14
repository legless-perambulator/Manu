import {
  FACES,
  FACE_LABEL,
  LIMITS,
  DEFAULT_STYLE,
  styleVariables,
  type Face,
  type ManuscriptStyle,
} from "../lib/typography";
import type { CSSProperties } from "react";

interface Props {
  style: ManuscriptStyle;
  onChange: (style: ManuscriptStyle) => void;
  onClose: () => void;
}

const SAMPLE = [
  "Mara remembered the cellar door differently.",
  "It had been painted once, a long time before anyone thought to ask why, and the paint had gone the colour of a thing left out in weather.",
].join("\n\n");

/**
 * How the manuscript is set.
 *
 * Six controls and a live sample of the writer's own prose settings. No CSS, no
 * config file, no theme JSON — the audit's complaint about customisation was
 * that the only way to change any of this was to edit the application (§8).
 *
 * Every control is a slider or a small set of choices, and every one is bounded
 * by `LIMITS`, so there is no combination reachable here that produces a page
 * nobody could read.
 */
export function ManuscriptAppearance({ style, onChange, onClose }: Props) {
  const set = <K extends keyof ManuscriptStyle>(key: K, value: ManuscriptStyle[K]) =>
    onChange({ ...style, [key]: value });

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal modal--wide" role="dialog" aria-modal="true" aria-label="Manuscript">
        <div className="modal__header">
          <h2>How the manuscript is set</h2>
          <button className="btn btn--ghost btn--small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal__body appearance">
          <div className="appearance__controls">
            <fieldset className="appearance__faces">
              <legend>Typeface</legend>
              {FACES.map((face: Face) => (
                <label key={face} className="appearance__face">
                  <input
                    type="radio"
                    name="manuscript-face"
                    checked={style.face === face}
                    onChange={() => set("face", face)}
                  />
                  <span className={`appearance__face-name appearance__face-name--${face}`}>
                    {FACE_LABEL[face]}
                  </span>
                </label>
              ))}
            </fieldset>

            <Slider
              label="Size"
              value={style.size}
              limits={LIMITS.size}
              format={(value) => `${value}px`}
              onChange={(value) => set("size", value)}
            />
            <Slider
              label="Line height"
              value={style.lineHeight}
              limits={LIMITS.lineHeight}
              format={(value) => value.toFixed(2)}
              onChange={(value) => set("lineHeight", value)}
            />
            <Slider
              label="Space between paragraphs"
              value={style.paragraphSpacing}
              limits={LIMITS.paragraphSpacing}
              format={(value) => (value === 0 ? "none" : `${value.toFixed(1)}×`)}
              onChange={(value) => set("paragraphSpacing", value)}
            />
            <Slider
              label="Line length"
              value={style.measure}
              limits={LIMITS.measure}
              format={(value) => `${value} characters`}
              onChange={(value) => set("measure", value)}
            />

            <div className="appearance__actions">
              <button className="btn btn--small" onClick={() => onChange(DEFAULT_STYLE)}>
                Back to the default
              </button>
            </div>
            <p className="hint">
              This is how the words are shown, not how they are stored. The file on disk is the same
              file on any machine.
            </p>
          </div>

          <div className="appearance__sample" style={styleVariables(style) as CSSProperties}>
            <p className="appearance__sample-label">Sample</p>
            <div className="appearance__page">
              {SAMPLE.split("\n\n").map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  limits,
  format,
  onChange,
}: {
  label: string;
  value: number;
  limits: { min: number; max: number; step: number };
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="appearance__slider">
      <span className="appearance__slider-label">
        {label}
        <span className="appearance__slider-value">{format(value)}</span>
      </span>
      <input
        type="range"
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
