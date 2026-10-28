/**
 * The builder form's labeled controls (S26, R3.14, A7 section 4): a section, a text field, a
 * select, a radio group, a checkbox group, a single checkbox and the v1 note (O-317). Since S40 the
 * fields take the shared FIELD_CLASS edge and a section is the components/ui Card. Every
 * control has a visible label; an error line is tied to its control through aria-describedby and
 * aria-invalid and starts with the word "Error", so color is never the only signal; native inputs
 * keep every control keyboard operable (Tab, arrows within a radio group, Space to toggle).
 */
import { useId, type ReactNode } from "react";

import { Card, cn, FIELD_CLASS } from "../../components/ui/index.js";

export interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
}

/** Every text field and select of the builder: the shared field edge (S36, O-369), red when invalid. */
const INPUT_CLASSES = cn(FIELD_CLASS, "h-9 px-2 text-sm aria-[invalid=true]:border-danger");

function describedBy(...ids: (string | undefined)[]): string | undefined {
  const present = ids.filter((id): id is string => id !== undefined);
  return present.length === 0 ? undefined : present.join(" ");
}

export interface ErrorTextProps {
  id: string;
  messages: readonly string[] | undefined;
}

export function ErrorText({ id, messages }: ErrorTextProps) {
  if (messages === undefined || messages.length === 0) return null;
  return (
    <p id={id} className="text-sm font-medium text-danger">
      {`Error: ${messages.join(" ")}`}
    </p>
  );
}

export function V1Note({ text }: { text: string }) {
  return (
    <p role="note" className="rounded-md border border-warning bg-surface-sunken px-2 py-1 text-sm">
      {`Note: ${text}`}
    </p>
  );
}

export interface FormSectionProps {
  title: string;
  children: ReactNode;
}

/** One builder page's card (S40): the components/ui Card, so the depth and heading are shared. */
export function FormSection({ title, children }: FormSectionProps) {
  return (
    <Card title={title}>
      <div className="flex flex-col gap-4">{children}</div>
    </Card>
  );
}

interface FieldShell {
  label: string;
  hint?: string;
  errors?: readonly string[] | undefined;
}

function useFieldIds(hint: string | undefined, errors: readonly string[] | undefined) {
  const id = useId();
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = errors === undefined || errors.length === 0 ? undefined : `${id}-error`;
  return { id, hintId, errorId, described: describedBy(hintId, errorId), invalid: errorId !== undefined };
}

export interface TextFieldProps extends FieldShell {
  value: string;
  onChange: (value: string) => void;
  inputMode?: "text" | "numeric" | "decimal";
  multiline?: boolean;
  className?: string;
}

export function TextField({ label, hint, errors, value, onChange, inputMode = "text", multiline = false, className }: TextFieldProps) {
  const ids = useFieldIds(hint, errors);
  const shared = {
    id: ids.id,
    value,
    "aria-describedby": ids.described,
    "aria-invalid": ids.invalid,
  };
  return (
    <div className={cn("flex flex-col gap-1 text-sm", className)}>
      <label htmlFor={ids.id} className="font-medium">
        {label}
      </label>
      {multiline ? (
        <textarea {...shared} rows={3} onChange={(event) => onChange(event.target.value)} className={cn(INPUT_CLASSES, "h-auto py-1")} />
      ) : (
        <input {...shared} type="text" inputMode={inputMode} onChange={(event) => onChange(event.target.value)} className={INPUT_CLASSES} />
      )}
      {hint === undefined ? null : (
        <p id={ids.hintId} className="text-muted">
          {hint}
        </p>
      )}
      <ErrorText id={ids.errorId ?? ""} messages={errors} />
    </div>
  );
}

export interface SelectFieldProps<T extends string> extends FieldShell {
  value: T;
  options: readonly Choice<T>[];
  onChange: (value: T) => void;
}

export function SelectField<T extends string>({ label, hint, errors, value, options, onChange }: SelectFieldProps<T>) {
  const ids = useFieldIds(hint, errors);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={ids.id} className="font-medium">
        {label}
      </label>
      <select
        id={ids.id}
        value={value}
        aria-describedby={ids.described}
        aria-invalid={ids.invalid}
        onChange={(event) => {
          const chosen = options.find((option) => option.value === event.target.value);
          if (chosen !== undefined) onChange(chosen.value);
        }}
        className={cn(INPUT_CLASSES, "min-w-32 self-start")}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint === undefined ? null : (
        <p id={ids.hintId} className="text-muted">
          {hint}
        </p>
      )}
      <ErrorText id={ids.errorId ?? ""} messages={errors} />
    </div>
  );
}

export interface RadioFieldProps<T extends string> extends Omit<FieldShell, "label"> {
  legend: string;
  value: T;
  options: readonly Choice<T>[];
  onChange: (value: T) => void;
}

export function RadioField<T extends string>({ legend, hint, errors, value, options, onChange }: RadioFieldProps<T>) {
  const ids = useFieldIds(hint, errors);
  return (
    <fieldset className="flex flex-col gap-1 text-sm" aria-describedby={ids.described} aria-invalid={ids.invalid}>
      <legend className="mb-1 font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {options.map((option) => (
          <label key={option.value} className="inline-flex items-center gap-2">
            <input type="radio" name={ids.id} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
            <span>{option.label}</span>
            {option.hint === undefined ? null : <span className="text-muted">{option.hint}</span>}
          </label>
        ))}
      </div>
      {hint === undefined ? null : (
        <p id={ids.hintId} className="text-muted">
          {hint}
        </p>
      )}
      <ErrorText id={ids.errorId ?? ""} messages={errors} />
    </fieldset>
  );
}

export interface CheckboxGroupProps<T extends string> extends Omit<FieldShell, "label"> {
  legend: string;
  options: readonly Choice<T>[];
  selected: readonly T[];
  onToggle: (value: T) => void;
}

export function CheckboxGroup<T extends string>({ legend, hint, errors, options, selected, onToggle }: CheckboxGroupProps<T>) {
  const ids = useFieldIds(hint, errors);
  return (
    <fieldset className="flex flex-col gap-1 text-sm" aria-describedby={ids.described} aria-invalid={ids.invalid}>
      <legend className="mb-1 font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {options.map((option) => (
          <label key={option.value} className="inline-flex items-center gap-2">
            <input type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {hint === undefined ? null : (
        <p id={ids.hintId} className="text-muted">
          {hint}
        </p>
      )}
      <ErrorText id={ids.errorId ?? ""} messages={errors} />
    </fieldset>
  );
}

export interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}

export function CheckboxField({ label, checked, onChange, hint }: CheckboxFieldProps) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="font-medium">{label}</span>
      {hint === undefined ? null : <span className="text-muted">{hint}</span>}
    </label>
  );
}
