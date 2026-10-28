/**
 * Shared pieces of the builder settings forms (S28, R3.5, O-296): one labeled number field with
 * its in-force value, and the save outcome line. Both forms send a PATCH with only the changed
 * keys; this file holds no state. Since S40 the field takes the shared FIELD_CLASS (O-369).
 */
import { useId } from "react";

import { cn, FIELD_CLASS } from "../ui/index.js";

export interface NumberFieldProps {
  label: string;
  hint: string;
  value: string;
  /** The value in force as text, with "builder default" when nothing is stored. */
  current: string;
  invalid: boolean;
  onChange: (text: string) => void;
  step?: string;
}

export function NumberField({ label, hint, value, current, invalid, onChange, step = "any" }: NumberFieldProps) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        aria-invalid={invalid}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.value)}
        className={cn(FIELD_CLASS, "h-10 w-40 px-3 aria-[invalid=true]:border-danger")}
      />
      <span id={hintId} className="text-xs text-muted">
        {`${current}. Use ${hint}.`}
      </span>
    </div>
  );
}

export type SaveOutcome = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "failed"; message: string };

export function SaveOutcomeLine({ outcome }: { outcome: SaveOutcome }) {
  switch (outcome.kind) {
    case "idle":
      return null;
    case "saving":
      return <p className="text-sm text-muted">Saving.</p>;
    case "saved":
      return (
        <p role="status" className="text-sm font-medium">
          Saved. The builder reads the new settings before its next job.
        </p>
      );
    case "failed":
      return (
        <p role="alert" className="text-sm text-danger">
          {outcome.message}
        </p>
      );
  }
}

export function currentText(value: string, stored: boolean): string {
  return stored ? `Now ${value}` : `Now ${value} (builder default)`;
}
