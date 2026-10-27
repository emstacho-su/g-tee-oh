/**
 * The keyboard shortcuts overlay (S24, A7 section 4, R3.13). A Dialog titled "Keyboard
 * shortcuts" that lists the active bindings grouped by scope, with "?" itself under General.
 * Its open state lives in the hotkey store, so the "?" key in dispatch.ts opens it; Radix closes
 * it on Escape or the close button and the change is written back to the store.
 */
import { useMemo } from "react";
import { useStore } from "zustand";

import { Dialog } from "../components/ui/index.js";
import { useHotkeyStore } from "./context.js";
import {
  GENERAL_SCOPE,
  SHORTCUTS_DESCRIPTION,
  SHORTCUTS_KEY,
  activeBindings,
  type RegisteredBinding,
} from "./registry.js";

interface ShortcutRow {
  readonly key: string;
  readonly description: string;
}

interface ShortcutGroup {
  readonly scope: string;
  readonly rows: readonly ShortcutRow[];
}

/** Single letters print upper case, as on the keycap. */
export function displayKey(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

function groupByScope(bindings: readonly RegisteredBinding[]): ShortcutGroup[] {
  const general: ShortcutGroup = { scope: GENERAL_SCOPE, rows: [{ key: SHORTCUTS_KEY, description: SHORTCUTS_DESCRIPTION }] };
  return bindings.reduce<ShortcutGroup[]>(
    (groups, binding) => {
      const row: ShortcutRow = { key: displayKey(binding.key), description: binding.description };
      const existing = groups.find((group) => group.scope === binding.scope);
      if (existing === undefined) return [...groups, { scope: binding.scope, rows: [row] }];
      return groups.map((group) => (group === existing ? { ...group, rows: [...group.rows, row] } : group));
    },
    [general],
  );
}

function scopeId(scope: string): string {
  return `shortcuts-scope-${scope.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function ShortcutsOverlay() {
  const store = useHotkeyStore();
  const open = useStore(store, (state) => state.overlayOpen);
  const bindings = useStore(store, (state) => state.bindings);
  const setOverlayOpen = useStore(store, (state) => state.setOverlayOpen);
  const groups = useMemo(() => groupByScope(activeBindings(bindings)), [bindings]);
  return (
    <Dialog open={open} onOpenChange={setOverlayOpen} title="Keyboard shortcuts">
      <div data-testid="shortcuts-overlay" className="flex flex-col gap-4">
        {groups.map((group) => (
          <section key={group.scope} aria-labelledby={scopeId(group.scope)}>
            <h3 id={scopeId(group.scope)} className="text-sm font-semibold text-muted">
              {group.scope}
            </h3>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {group.rows.map((row) => (
                <div key={row.key} className="contents">
                  <dt>
                    <kbd className="rounded border border-border bg-surface-sunken px-1.5 font-mono text-sm">{row.key}</kbd>
                  </dt>
                  <dd className="text-sm">{row.description}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
