/**
 * A single-choice segmented control over Radix ToggleGroup (S24, O-44; S36, O-346): arrow keys
 * move between items, and the chosen item carries aria-checked through Radix's radio semantics.
 * Used for the matrix mode switch and similar choices. An empty value from Radix (the active item
 * pressed again) is ignored, so a choice, once made, stays selected.
 *
 * S39 (R3.12, O-354) adds, without changing existing callers: value may be undefined (nothing
 * chosen yet); an option may carry a detail line (the stake's rake); and an option may be
 * unavailable. An unavailable item is marked aria-disabled, not disabled, so it stays in the
 * arrow-key order and its reason, shown as visible text inside the item, is part of its
 * accessible name; choosing it does nothing.
 *
 * S41 (R3.16, O-415) adds MultiToggleGroup, a choice of any number over the same track and items.
 *
 * Look: a sunken track; every item takes the shared tactile press, the unchosen ones flat and the
 * chosen one raised out of the track in bold, so the choice never rests on colour alone.
 */
import * as RadixToggleGroup from "@radix-ui/react-toggle-group";
import { Fragment } from "react";

import { cn } from "./cn.js";
import { CONTROL_EDGE_CLASS, FLAT_REST_CLASS, TACTILE_CLASS } from "./tactile.js";

export interface ToggleOption<T extends string> {
  value: T;
  label: string;
  /** A second, smaller line under the label. */
  detail?: string;
  /** The item stays visible and focusable but cannot be chosen. */
  disabled?: boolean;
  /** Why the item is unavailable, shown under the label when disabled. */
  reason?: string;
}

export interface ToggleGroupProps<T extends string> {
  label: string;
  /** Undefined while nothing is chosen. */
  value: T | undefined;
  options: readonly ToggleOption<T>[];
  onValueChange: (value: T) => void;
  /** Lets the items wrap onto more lines, for long lists on a phone. */
  wrap?: boolean;
}

const ITEM_CLASSES = cn(
  "rounded-lg px-3 py-1 text-sm text-muted",
  TACTILE_CLASS,
  FLAT_REST_CLASS,
  "data-[state=on]:bg-surface-raised data-[state=on]:font-semibold data-[state=on]:text-text",
  "data-[state=on]:[--tactile-rest:var(--shadow-press-rest)]",
);
const STACKED_ITEM_CLASSES = "flex flex-col items-start text-left";
/** Unavailable items read as such by their dashed edge and their reason, never by fading the text. */
const UNAVAILABLE_ITEM_CLASSES = "cursor-not-allowed border border-dashed border-border-strong";
const SECOND_LINE_CLASSES = "text-xs font-normal";
const REASON_LINE_CLASSES = "text-xs font-medium";
/** Separates the lines in the accessible name ("2/5 10% rake No 9-player game at this stake"). */
const NAME_SEPARATOR = " ";

/** The smaller lines under the label: the detail, then the reason when the item is unavailable. */
function extraLines<T extends string>(option: ToggleOption<T>): { text: string; className: string }[] {
  const reason = option.disabled === true ? option.reason : undefined;
  return [
    ...(option.detail === undefined ? [] : [{ text: option.detail, className: SECOND_LINE_CLASSES }]),
    ...(reason === undefined ? [] : [{ text: reason, className: REASON_LINE_CLASSES }]),
  ];
}

function ItemContent<T extends string>({ option }: { option: ToggleOption<T> }) {
  const lines = extraLines(option);
  if (lines.length === 0) return <>{option.label}</>;
  return (
    <>
      <span>{option.label}</span>
      {lines.map((line) => (
        <Fragment key={line.className}>
          {NAME_SEPARATOR}
          <span className={line.className}>{line.text}</span>
        </Fragment>
      ))}
    </>
  );
}

export function ToggleGroup<T extends string>({ label, value, options, onValueChange, wrap = false }: ToggleGroupProps<T>) {
  return (
    <RadixToggleGroup.Root
      type="single"
      aria-label={label}
      value={value ?? ""}
      onValueChange={(next) => {
        const chosen = options.find((option) => option.value === next);
        if (chosen !== undefined && chosen.disabled !== true) onValueChange(chosen.value);
      }}
      className={trackClasses(wrap)}
    >
      <Items options={options} />
    </RadixToggleGroup.Root>
  );
}

function trackClasses(wrap: boolean): string {
  return cn(
    "inline-flex gap-0.5 rounded-xl bg-surface-sunken p-1 shadow-[inset_0_1px_3px_rgb(0_0_0/0.12)]",
    wrap && "max-w-full flex-wrap",
    CONTROL_EDGE_CLASS,
  );
}

/** The items of either control; an unavailable one is aria-disabled and stays in the arrow-key order (S39). */
function Items<T extends string>({ options }: { options: readonly ToggleOption<T>[] }) {
  return (
    <>
      {options.map((option) => {
        const unavailable = option.disabled === true;
        return (
          <RadixToggleGroup.Item
            key={option.value}
            value={option.value}
            aria-disabled={unavailable ? true : undefined}
            className={cn(
              ITEM_CLASSES,
              extraLines(option).length > 0 && STACKED_ITEM_CLASSES,
              unavailable && UNAVAILABLE_ITEM_CLASSES,
            )}
          >
            <ItemContent option={option} />
          </RadixToggleGroup.Item>
        );
      })}
    </>
  );
}

export interface MultiToggleGroupProps<T extends string> {
  label: string;
  value: readonly T[];
  options: readonly ToggleOption<T>[];
  onValueChange: (value: T[]) => void;
}

/**
 * S41 (R3.16, O-415): a choice of any number (the quiz's positions, spot types and question kinds).
 * Each item is a toggle button with aria-pressed; the reported value keeps the options' order
 * whatever order the items were pressed in, and never holds an unavailable option. It always wraps,
 * since its lists run long on a phone.
 */
export function MultiToggleGroup<T extends string>({ label, value, options, onValueChange }: MultiToggleGroupProps<T>) {
  return (
    <RadixToggleGroup.Root
      type="multiple"
      role="group"
      aria-label={label}
      value={[...value]}
      onValueChange={(next) => {
        const picked = new Set(next);
        const chosen = options.filter((option) => picked.has(option.value) && option.disabled !== true).map((option) => option.value);
        // Pressing an unavailable item changes nothing, so nothing is reported.
        const unchanged = chosen.length === value.length && chosen.every((choice) => value.includes(choice));
        if (!unchanged) onValueChange(chosen);
      }}
      className={trackClasses(true)}
    >
      <Items options={options} />
    </RadixToggleGroup.Root>
  );
}
