/**
 * Segmented controls over Radix ToggleGroup (S24, O-44; S36, O-346; S41, O-415).
 *
 * - ToggleGroup is a single choice: arrow keys move between items, and the chosen item carries
 *   aria-checked through Radix's radio semantics. An empty value from Radix (the active item
 *   pressed again) is ignored, so a choice is always selected.
 * - MultiToggleGroup is a choice of any number (the quiz's positions, spot types and question
 *   kinds): each item is a button with aria-pressed, and the reported value keeps the options'
 *   order whatever order the items were pressed in.
 * An option marked disabled is shown but can never be chosen (a seat the library does not cover).
 * MultiToggleGroup always wraps its items when they do not fit; ToggleGroup wraps only with wrap.
 *
 * Look: a sunken track; every item takes the shared tactile press, the unchosen ones flat and the
 * chosen one raised out of the track in bold, so the choice never rests on colour alone.
 */
import * as RadixToggleGroup from "@radix-ui/react-toggle-group";

import { cn } from "./cn.js";
import { CONTROL_EDGE_CLASS, FLAT_REST_CLASS, TACTILE_CLASS } from "./tactile.js";

export interface ToggleOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface ToggleGroupProps<T extends string> {
  label: string;
  value: T;
  options: readonly ToggleOption<T>[];
  onValueChange: (value: T) => void;
  /** Wrap the items onto more lines when they do not fit (S41); one line by default. */
  wrap?: boolean;
}

export interface MultiToggleGroupProps<T extends string> {
  label: string;
  value: readonly T[];
  options: readonly ToggleOption<T>[];
  onValueChange: (value: T[]) => void;
}

const TRACK_CLASSES = cn("inline-flex gap-0.5 rounded-xl bg-surface-sunken p-1 shadow-[inset_0_1px_3px_rgb(0_0_0/0.12)]", CONTROL_EDGE_CLASS);
/** S41: a track that wraps its items onto more lines when they do not fit; opt-in, so S36's toggles keep their one line. */
const WRAPPING_TRACK_CLASSES = cn(TRACK_CLASSES, "flex-wrap");

const ITEM_CLASSES = cn(
  "rounded-lg px-3 py-1 text-sm text-muted",
  TACTILE_CLASS,
  FLAT_REST_CLASS,
  "data-[state=on]:bg-surface-raised data-[state=on]:font-semibold data-[state=on]:text-text",
  "data-[state=on]:[--tactile-rest:var(--shadow-press-rest)]",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

function Items<T extends string>({ options }: { options: readonly ToggleOption<T>[] }) {
  return (
    <>
      {options.map((option) => (
        <RadixToggleGroup.Item key={option.value} value={option.value} disabled={option.disabled === true} className={ITEM_CLASSES}>
          {option.label}
        </RadixToggleGroup.Item>
      ))}
    </>
  );
}

export function ToggleGroup<T extends string>({ label, value, options, onValueChange, wrap = false }: ToggleGroupProps<T>) {
  return (
    <RadixToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        const chosen = options.find((option) => option.value === next && option.disabled !== true);
        if (chosen !== undefined) onValueChange(chosen.value);
      }}
      className={wrap ? WRAPPING_TRACK_CLASSES : TRACK_CLASSES}
    >
      <Items options={options} />
    </RadixToggleGroup.Root>
  );
}

export function MultiToggleGroup<T extends string>({ label, value, options, onValueChange }: MultiToggleGroupProps<T>) {
  return (
    <RadixToggleGroup.Root
      type="multiple"
      role="group"
      aria-label={label}
      value={[...value]}
      onValueChange={(next) => {
        const picked = new Set(next);
        onValueChange(options.filter((option) => picked.has(option.value) && option.disabled !== true).map((option) => option.value));
      }}
      className={WRAPPING_TRACK_CLASSES}
    >
      <Items options={options} />
    </RadixToggleGroup.Root>
  );
}
