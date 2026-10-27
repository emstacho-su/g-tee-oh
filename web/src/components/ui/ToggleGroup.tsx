/**
 * A single-choice segmented control over Radix ToggleGroup (S24, O-44): arrow keys move between
 * items, and the chosen item carries aria-checked through Radix's radio semantics. Used for the
 * matrix mode switch and similar choices. An empty value from Radix (the active item pressed
 * again) is ignored, so a choice is always selected.
 */
import * as RadixToggleGroup from "@radix-ui/react-toggle-group";

import { cn } from "./cn.js";

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
      className="inline-flex rounded-md border border-border bg-surface-sunken p-0.5"
    >
      {options.map((option) => (
        <RadixToggleGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            "rounded px-3 py-1 text-sm text-muted",
            "data-[state=on]:bg-surface-raised data-[state=on]:font-semibold data-[state=on]:text-text",
          )}
        >
          {option.label}
        </RadixToggleGroup.Item>
      ))}
    </RadixToggleGroup.Root>
  );
}
