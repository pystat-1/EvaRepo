import { useEffect, useState } from "react";

// A score box that takes any mark from 0 to the maximum with up to two
// decimals (0.25, 1.75, 3.4 …). A plain <input type="number"> bound to the
// score lost what was being typed: "2." is not a number yet, so the box
// reset and only whole and half marks (the ± buttons) could be entered.
// Here the typed text is kept as typed and the score updates as soon as it
// reads as a number; Arabic digits (٢٫٧٥) and a comma work too.
export const STEP = 0.25;

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
/** "٢٫٧٥" / "2,75" -> "2.75" */
export function normalizeScoreText(text: string): string {
  return text
    .replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) - (d >= "۰" ? 0x6f0 : 0x660)) % 10))
    .replace(/[٫,،]/g, ".")
    .replace(/\s+/g, "");
}

/** The score a text means (clamped to 0…max, 2 decimals), or null while it is not a number yet. */
export function parseScore(text: string, max: number): number | null {
  const t = normalizeScoreText(text);
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(max, Math.round(n * 100) / 100));
}

const shown = (v: number | undefined) => (v === undefined ? "" : String(v));

export function ScoreInput({
  value,
  max,
  disabled,
  label,
  onChange,
}: {
  value: number | undefined;
  max: number;
  disabled?: boolean;
  label: string;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(shown(value));
  const [editing, setEditing] = useState(false);
  // A change from elsewhere (± buttons, a merge, the card) shows when not typing.
  useEffect(() => {
    if (!editing) setText(shown(value));
  }, [value, editing]);
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      enterKeyHint="next"
      aria-label={`${label} (0–${max})`}
      value={text}
      placeholder="0"
      disabled={disabled}
      onFocus={(e) => {
        setEditing(true);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const t = normalizeScoreText(e.target.value);
        if (!/^\d*\.?\d{0,2}$/.test(t)) return; // keep only what can become a mark
        setText(t);
        if (t === "") return onChange(0);
        const v = parseScore(t, max);
        if (v !== null) onChange(v);
      }}
      onBlur={() => {
        setEditing(false);
        const v = parseScore(text, max);
        setText(v === null ? shown(value) : String(v));
      }}
    />
  );
}
