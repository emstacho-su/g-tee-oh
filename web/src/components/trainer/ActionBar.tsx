/**
 * The trainer's action buttons (S24, S46, 05, A7 section 4, R3.13, R3.30, ADR 0020, O-22, O-475).
 *
 * Mechanism: one button per tree action at the node, in record order, and nothing else: the tree
 * decides the buttons (ADR 0020), so a bucket with no tree action has no button, not a disabled
 * one. Labels come from actionButtonLabel (Standard exact size; Grouped bucket label with the
 * size underneath on postflop nodes). Each button carries the action's swatch and short letter so
 * color is not the only signal, prints its key and registers it through useHotkey while it is
 * enabled. Keys come from action-keys.ts: a fixed letter per kind (F, C, X, A, L) and the digits 1
 * to 9 for the bet and raise sizes in bar order, so no key moves with the number of buttons.
 *
 * Numbering (O-198): onAction receives NodeAction.index, the numbering the api grades and the
 * contract's action_index carries, never the button's position; the position only picks the
 * size's digit.
 */
import { Button, cn } from "../ui/index.js";
import type { Grouping, NodeAction, Street } from "../../contracts.js";
import { displayKey, useHotkey } from "../../hotkeys/index.js";
import { ActionSwatch } from "./ActionSwatch.js";
import { MAX_SIZE_HOTKEYS, actionHotkeys } from "./action-keys.js";
import { actionAccessibleName, actionButtonLabel } from "./action-labels.js";

/** Number keys 1 to 9 select the first nine sizes (kept under its S24 name for the settings table). */
export const MAX_HOTKEY_ACTIONS = MAX_SIZE_HOTKEYS;
export const ACTION_SCOPE = "Actions";

export interface ActionBarProps {
  actions: readonly NodeAction[];
  grouping: Grouping;
  street: Street;
  disabled?: boolean;
  /**
   * The NodeAction.index the hero chose, once chosen (S46, critic round 3 G10): that button is
   * marked pressed with the selection ring (--selected, O-434) and keeps its full ink while the
   * bar is disabled, so the strip itself says which action was taken.
   */
  chosenIndex?: number | null;
  onAction: (index: number) => void;
}

interface ActionButtonProps {
  action: NodeAction;
  actions: readonly NodeAction[];
  hotkey: string | null;
  grouping: Grouping;
  street: Street;
  disabled: boolean;
  chosen: boolean;
  onAction: (index: number) => void;
}

/** The chosen action's mark: the selection ring on the surface, with the disabled dimming lifted. */
const CHOSEN_CLASSES = "ring-2 ring-selected ring-offset-2 ring-offset-surface disabled:opacity-100";

function ActionButton({ action, actions, hotkey, grouping, street, disabled, chosen, onAction }: ActionButtonProps) {
  const label = actionButtonLabel(action, grouping, street);
  const name = actionAccessibleName(label);
  const choose = () => onAction(action.index);
  const keycap = hotkey === null ? null : displayKey(hotkey);
  useHotkey({ key: hotkey ?? "", description: `Choose ${name}`, scope: ACTION_SCOPE, handler: choose }, hotkey !== null && !disabled);
  return (
    <Button
      size="lg"
      aria-label={name}
      {...(keycap === null ? {} : { "aria-keyshortcuts": keycap })}
      {...(chosen ? { "aria-pressed": true, "data-chosen": "true" } : {})}
      disabled={disabled}
      onClick={choose}
      className={cn("h-auto min-w-24 flex-col py-2", chosen && CHOSEN_CLASSES)}
    >
      <span className="flex items-center gap-2">
        {keycap === null ? null : (
          <kbd aria-hidden="true" className="rounded border border-border bg-surface-sunken px-1 font-mono text-xs">
            {keycap}
          </kbd>
        )}
        <ActionSwatch action={action} actions={actions} />
        <span>{label.main}</span>
      </span>
      {label.sub === null ? null : <span className="text-xs text-muted tabular-nums">{label.sub}</span>}
    </Button>
  );
}

export function ActionBar({ actions, grouping, street, disabled = false, chosenIndex = null, onAction }: ActionBarProps) {
  const hotkeys = actionHotkeys(actions);
  return (
    <div data-testid="action-bar" role="group" aria-label="Actions" className="flex flex-wrap gap-2">
      {actions.map((action, position) => (
        <ActionButton
          key={action.index}
          action={action}
          actions={actions}
          hotkey={hotkeys[position] ?? null}
          grouping={grouping}
          street={street}
          disabled={disabled}
          chosen={chosenIndex !== null && action.index === chosenIndex}
          onAction={onAction}
        />
      ))}
    </div>
  );
}
