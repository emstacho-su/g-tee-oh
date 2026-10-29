/**
 * The active action filters as chips above the matrix (S45, R3.12, O-468, design rule 3): one chip
 * per filtered action with its swatch, its exact label and an x that removes it, and a Clear button
 * that empties the set. Renders nothing when no filter names an action at this node, so a stale
 * index in the address shows nothing rather than an empty chip. The component holds no state: the
 * caller owns the set, which lives in the address.
 */
import { ActionSwatch } from "../../components/trainer/ActionSwatch.js";
import { Button } from "../../components/ui/index.js";
import type { NodeAction } from "../../contracts.js";
import { exactActionLabel } from "../../poker/format.js";

export const FILTER_TEXT = {
  list: "Active filters",
  clear: "Clear filters",
  remove: (name: string) => `Remove filter ${name}`,
} as const;

export interface FilterChipsProps {
  actions: readonly NodeAction[];
  /** The filtered NodeAction.index values; ones naming no action here are left out. */
  filters: readonly number[];
  onRemove: (index: number) => void;
  onClear: () => void;
}

export function FilterChips({ actions, filters, onRemove, onClear }: FilterChipsProps) {
  const active = actions.filter((action) => filters.includes(action.index));
  if (active.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ul aria-label={FILTER_TEXT.list} className="flex flex-wrap gap-2">
        {active.map((action) => {
          const name = exactActionLabel(action);
          return (
            <li key={action.index}>
              <button
                type="button"
                aria-label={FILTER_TEXT.remove(name)}
                onClick={() => onRemove(action.index)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-surface-raised py-0.5 pr-2 pl-1.5 text-xs font-medium"
              >
                <ActionSwatch action={action} actions={actions} showLetter={false} />
                <span aria-hidden="true">{name}</span>
                <span aria-hidden="true" className="text-muted">
                  ×
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button size="sm" onClick={onClear}>
        {FILTER_TEXT.clear}
      </Button>
    </div>
  );
}
