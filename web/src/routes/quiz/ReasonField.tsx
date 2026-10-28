/**
 * The required reason under every quiz answer (S41, R3.16, O-350, O-412): a labelled textarea on
 * the shared field class, limited to 1,000 characters, with a live "n / 1000" count and a hint that
 * says the minimum. Enter inside it types a newline: a textarea never submits its form, and the
 * hotkey dispatch ignores keys typed into a textarea (hotkeys/dispatch.ts), so only the Submit
 * button or Enter outside the field sends the answer.
 */
import { useId } from "react";

import { FIELD_CLASS, cn } from "../../components/ui/index.js";
import { REASON_MAX_CHARS, reasonCount } from "../../prediction/draft.js";
import { PREDICTION_TEXT } from "../../prediction/labels.js";

export interface ReasonFieldProps {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

const REASON_ROWS = 3;

export function ReasonField({ value, disabled, onChange }: ReasonFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const countId = `${id}-count`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {PREDICTION_TEXT.reasonLabel}
      </label>
      <textarea
        id={id}
        value={value}
        rows={REASON_ROWS}
        maxLength={REASON_MAX_CHARS}
        disabled={disabled}
        aria-describedby={`${hintId} ${countId}`}
        onChange={(event) => onChange(event.target.value)}
        className={cn(FIELD_CLASS, "w-full px-3 py-2 text-base")}
      />
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
        <span id={hintId}>{PREDICTION_TEXT.reasonHint}</span>
        <span id={countId} aria-live="polite">
          {reasonCount(value)}
        </span>
      </div>
    </div>
  );
}
