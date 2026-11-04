/**
 * Tabs over Radix Tabs (S45 follow-up, R3.26, O-44): the WAI-ARIA tabs pattern (tablist, tab and
 * tabpanel with their aria wiring, roving focus with the arrow keys, automatic activation), styled
 * like ToggleGroup's segmented track so the two read as one family.
 *
 * Mechanism: the caller owns the open tab (value and onValueChange) and passes each tab's label, an
 * optional badge and its content. Radix mounts only the open tab's content (no forceMount), so a
 * closed tab's body, and every read inside it, mounts only when the tab opens: the lazy mount the
 * right column relies on. A badge is part of the tab's accessible name and is shown as visible
 * text, never colour alone. Radix prevents the arrow keys it uses, so the Study keyboard scope's
 * arrows yield while the tablist has focus.
 */
import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

import { cn } from "./cn.js";
import { CONTROL_EDGE_CLASS, FLAT_REST_CLASS, TACTILE_CLASS } from "./tactile.js";

export interface TabItem<T extends string> {
  readonly value: T;
  readonly label: string;
  /** A short tag beside the label, for example the street a tab's data belongs to. */
  readonly badge?: string;
  readonly content: ReactNode;
}

export interface TabsProps<T extends string> {
  /** The tablist's accessible name. */
  label: string;
  value: T;
  tabs: readonly TabItem<T>[];
  onValueChange: (value: T) => void;
}

const TRIGGER_CLASSES = cn(
  "flex items-center gap-1.5 rounded-lg px-3 py-1 text-sm text-muted",
  TACTILE_CLASS,
  FLAT_REST_CLASS,
  "data-[state=active]:bg-surface-raised data-[state=active]:font-semibold data-[state=active]:text-text",
  "data-[state=active]:[--tactile-rest:var(--shadow-press-rest)]",
);

export function Tabs<T extends string>({ label, value, tabs, onValueChange }: TabsProps<T>) {
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={(next) => {
        const chosen = tabs.find((tab) => tab.value === next);
        if (chosen !== undefined) onValueChange(chosen.value);
      }}
      className="flex min-w-0 flex-col gap-3"
    >
      <RadixTabs.List
        aria-label={label}
        className={cn("inline-flex max-w-full flex-wrap gap-0.5 self-start rounded-xl bg-surface-sunken p-1 shadow-[inset_0_1px_3px_rgb(0_0_0/0.12)]", CONTROL_EDGE_CLASS)}
      >
        {tabs.map((tab) => (
          <RadixTabs.Trigger key={tab.value} value={tab.value} className={TRIGGER_CLASSES}>
            {tab.label}
            {tab.badge === undefined ? null : (
              <span data-testid="tab-badge" className="rounded-full border border-border px-1.5 text-xs font-medium">
                {tab.badge}
              </span>
            )}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {tabs.map((tab) => (
        <RadixTabs.Content key={tab.value} value={tab.value} aria-label={tab.label} className="flex min-w-0 flex-col gap-4">
          {tab.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
