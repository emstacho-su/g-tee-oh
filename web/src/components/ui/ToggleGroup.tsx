/**
 * A single-choice segmented control over Radix ToggleGroup (S24, O-44; S36, O-346): arrow keys
 * move between items, and the chosen item carries aria-checked through Radix's radio semantics.
 * Used for the matrix mode switch and similar choices. An empty value from Radix (the active item
 * pressed again) is ignored, so a choice is always selected.
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
}

export interface ToggleGroupProps<T extends string> {
  label: string;
  value: T;
  options: readonly ToggleOption<T>[];
  onValueChange: (value: T) => void;
}

const ITEM_CLASSES = cn(
  "rounded-lg px-3 py-1 text-sm text-muted",
  TACTILE_CLASS,
  FLAT_REST_CLASS,
  "data-[state=on]:bg-surface-raised data-[state=on]:font-semibold data-[state=on]:text-text",
  "data-[state=on]:[--tactile-rest:var(--shadow-press-rest)]",
);

export function ToggleGroup<T extends string>({ label, value, options, onValueChange }: ToggleGroupProps<T>) {
  return (
    <RadixToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        const chosen = options.find((option) => option.value === next);
        if (chosen !== undefined) onValueChange(chosen.value);
      }}
      className={cn("inline-flex gap-0.5 rounded-xl bg-surface-sunken p-1 shadow-[inset_0_1px_3px_rgb(0_0_0/0.12)]", CONTROL_EDGE_CLASS)}
    >
      {options.map((option) => (
        <RadixToggleGroup.Item key={option.value} value={option.value} className={ITEM_CLASSES}>
          {option.label}
        </RadixToggleGroup.Item>
      ))}
    </RadixToggleGroup.Root>
  );
}
