/**
 * The required reason under every quiz answer (S41, R3.16, O-350, O-412): a labelled textarea on
 * the shared field class, limited to 1,000 characters, with a live "n / 1000" count and a hint that
 * says the minimum. The count and the readiness both come from the shared rule (checkRationale, PR
 * #39 review finding 3): the count is the cleaned text in code points, so a reason that NFC pushes
 * past 1,000 (PR #41 review round 1, finding 8) shows a count over the bound and its own sentence,
 * and the field is marked invalid, rather than leaving Submit disabled with no reason given. When the api
 * refuses the reason (a 400 naming body.rationale), its fixed sentence shows under the field, the
 * field is marked invalid and the sentence joins its description. Enter inside it types a newline:
 * a textarea never submits its form, and the hotkey dispatch ignores keys typed into a textarea
 * (hotkeys/dispatch.ts), so only the Submit button or Enter outside the field sends the answer.
 */
import { RATIONALE_MAX_CHARS, checkRationale } from "@g-tee-oh/contracts";
import { useId } from "react";

import { FIELD_CLASS, cn } from "../../components/ui/index.js";
import { reasonCount } from "../../prediction/draft.js";
import { PREDICTION_TEXT } from "../../prediction/labels.js";

export interface ReasonFieldProps {
  value: string;
  disabled: boolean;
  /** The api refused the last reason sent: show the reason's own sentence. */
  refused?: boolean;
  onChange: (value: string) => void;
}

const REASON_ROWS = 3;

export function ReasonField({ value, disabled, refused = false, onChange }: ReasonFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const countId = `${id}-count`;
  const errorId = `${id}-error`;
  const tooLongId = `${id}-too-long`;
  const { tooLong } = checkRationale(value);
  const describedBy = [refused ? errorId : null, tooLong ? tooLongId : null, hintId, countId].filter((entry) => entry !== null).join(" ");
  return (
    <div className="flex flex-col gap-1" data-testid="reason-field">
      <label htmlFor={id} className="text-sm font-medium">
        {PREDICTION_TEXT.reasonLabel}
      </label>
      <textarea
        id={id}
        value={value}
        rows={REASON_ROWS}
        maxLength={RATIONALE_MAX_CHARS}
        disabled={disabled}
        aria-invalid={refused || tooLong}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className={cn(FIELD_CLASS, "w-full px-3 py-2 text-base")}
      />
      {refused ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {PREDICTION_TEXT.reasonRefused}
        </p>
      ) : null}
      {tooLong ? (
        <p id={tooLongId} role="alert" className="text-sm text-danger">
          {PREDICTION_TEXT.reasonTooLong}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
        <span id={hintId}>{PREDICTION_TEXT.reasonHint}</span>
        <span id={countId} aria-live="polite">
          {reasonCount(value)}
        </span>
      </div>
    </div>
  );
}
