/**
 * The session length chooser of the start panels (S46, R3.31, design rule 10): Off, 10, 20 or 50
 * hands as a radio group, shared by the drill run's StartPanel and /train's AutomatedStart so the
 * two read the same. The choice is written to the session defaults by the caller and read back
 * into the session at Start (trainer/session-length.ts).
 */
import { SESSION_LENGTHS, SESSION_LENGTH_TEXT, isSessionLength, sessionLengthLabel, type SessionLength } from "../../trainer/session-length.js";
import { RadioField, type Choice } from "../drills/form-parts.js";

const OFF_VALUE = "off";

const CHOICES: readonly Choice<string>[] = [
  { value: OFF_VALUE, label: SESSION_LENGTH_TEXT.off },
  ...SESSION_LENGTHS.map((length) => ({ value: String(length), label: sessionLengthLabel(length) })),
];

/** The length a radio value stands for; a value that is not a length is Off. */
export function sessionLengthOfValue(raw: string): SessionLength {
  const parsed = raw === OFF_VALUE ? null : Number(raw);
  return isSessionLength(parsed) ? parsed : null;
}

export interface SessionLengthFieldProps {
  value: SessionLength;
  onChange: (length: SessionLength) => void;
}

export function SessionLengthField({ value, onChange }: SessionLengthFieldProps) {
  return (
    <RadioField
      legend={SESSION_LENGTH_TEXT.legend}
      hint={SESSION_LENGTH_TEXT.hint}
      value={value === null ? OFF_VALUE : String(value)}
      options={CHOICES}
      onChange={(raw) => onChange(sessionLengthOfValue(raw))}
    />
  );
}
