/**
 * A visible name over a choice control of the practice pickers (S41, R3.16, R3.17): the control
 * carries the same name as its accessible label (ToggleGroup's aria-label), so the visible line is
 * hidden from screen readers to avoid reading it twice. An optional note sits under the control.
 */
import type { ReactNode } from "react";

export interface ChoiceFieldProps {
  label: string;
  note?: string | null;
  children: ReactNode;
}

export function ChoiceField({ label, note, children }: ChoiceFieldProps) {
  return (
    <div className="flex flex-col items-start gap-1">
      <p aria-hidden="true" className="text-sm font-medium">
        {label}
      </p>
      {children}
      {note === undefined || note === null ? null : <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}
