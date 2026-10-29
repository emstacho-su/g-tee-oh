/**
 * The keyboard shortcuts overlay (S24, S46, A7 section 4, R3.13, R3.30). A Dialog titled "Keyboard
 * shortcuts" that lists the active bindings grouped by scope, with "?" itself under General and
 * the reserved keys (reserved.ts) after the live ones of their scope, only when that scope has
 * live keys on the page. A shift chord prints
 * as "Shift+" and the keycap; Space prints as "Space". Its open state lives in the hotkey store,
 * so the "?" key in dispatch.ts opens it; Radix closes it on Escape or the close button and the
 * change is written back to the store.
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
  type HotkeyBinding,
  type RegisteredBinding,
} from "./registry.js";
import { RESERVED_KEYS } from "./reserved.js";

interface ShortcutRow {
  readonly key: string;
  readonly description: string;
}

interface ShortcutGroup {
  readonly scope: string;
  readonly rows: readonly ShortcutRow[];
}

const SPACE_KEY = " ";
const SPACE_NAME = "Space";
const SHIFT_PREFIX = "Shift+";

/** Single letters print upper case, as on the keycap; the space bar prints its name. */
export function displayKey(key: string): string {
  if (key === SPACE_KEY) return SPACE_NAME;
  return key.length === 1 ? key.toUpperCase() : key;
}

/** The keycap text of a binding: "Shift+E", "Enter", "F". */
export function displayBinding(binding: Pick<HotkeyBinding, "key" | "shift">): string {
  return `${binding.shift === true ? SHIFT_PREFIX : ""}${displayKey(binding.key)}`;
}

function addRow(groups: readonly ShortcutGroup[], scope: string, row: ShortcutRow): ShortcutGroup[] {
  const existing = groups.find((group) => group.scope === scope);
  if (existing === undefined) return [...groups, { scope, rows: [row] }];
  return groups.map((group) => (group === existing ? { ...group, rows: [...group.rows, row] } : group));
}

function groupByScope(bindings: readonly RegisteredBinding[]): ShortcutGroup[] {
  const general: ShortcutGroup = { scope: GENERAL_SCOPE, rows: [{ key: SHORTCUTS_KEY, description: SHORTCUTS_DESCRIPTION }] };
  const live = bindings.reduce<ShortcutGroup[]>(
    (groups, binding) => addRow(groups, binding.scope, { key: displayBinding(binding), description: binding.description }),
    [general],
  );
  // A reserved key shows only beside its scope's live keys, so a page without a trainer session
  // has no lone Session group (PR #45 review round 2, finding 6).
  return RESERVED_KEYS.reduce<ShortcutGroup[]>(
    (groups, reserved) =>
      groups.some((group) => group.scope === reserved.scope)
        ? addRow(groups, reserved.scope, { key: displayKey(reserved.key), description: reserved.description })
        : groups,
    live,
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
