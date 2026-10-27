/**
 * The trainer's action buttons (S24, 05, A7 section 4, R3.13, ADR 0020, O-22).
 *
 * Mechanism: one button per tree action at the node, in record order, and nothing else: the tree
 * decides the buttons (ADR 0020), so a bucket with no tree action has no button, not a disabled
 * one. Labels come from actionButtonLabel (Standard exact size; Grouped bucket label with the
 * size underneath on postflop nodes). Each button carries the action's swatch and short letter so
 * color is not the only signal, prints its hotkey number, and registers that number (1 to 9 for
 * the first nine actions) through useHotkey while it is enabled. onAction receives the record
 * index (NodeAction.index), which is what the api grades.
 */
import { Button } from "../ui/index.js";
import type { Grouping, NodeAction, Street } from "../../contracts.js";
import { useHotkey } from "../../hotkeys/index.js";
import { ActionSwatch } from "./ActionSwatch.js";
import { actionAccessibleName, actionButtonLabel } from "./action-labels.js";

/** Number keys 1 to 9 select the first nine actions. */
export const MAX_HOTKEY_ACTIONS = 9;
export const ACTION_SCOPE = "Actions";

export interface ActionBarProps {
  actions: readonly NodeAction[];
  grouping: Grouping;
  street: Street;
  disabled?: boolean;
  onAction: (index: number) => void;
}

interface ActionButtonProps {
  action: NodeAction;
  actions: readonly NodeAction[];
  hotkey: string | null;
  grouping: Grouping;
  street: Street;
  disabled: boolean;
  onAction: (index: number) => void;
}

function ActionButton({ action, actions, hotkey, grouping, street, disabled, onAction }: ActionButtonProps) {
  const label = actionButtonLabel(action, grouping, street);
  const name = actionAccessibleName(label);
  const choose = () => onAction(action.index);
  useHotkey({ key: hotkey ?? "", description: `Choose ${name}`, scope: ACTION_SCOPE, handler: choose }, hotkey !== null && !disabled);
  return (
    <Button
      size="lg"
      aria-label={name}
      {...(hotkey === null ? {} : { "aria-keyshortcuts": hotkey })}
      disabled={disabled}
      onClick={choose}
      className="h-auto min-w-24 flex-col py-2"
    >
      <span className="flex items-center gap-2">
        {hotkey === null ? null : (
          <kbd aria-hidden="true" className="rounded border border-border bg-surface-sunken px-1 font-mono text-xs">
            {hotkey}
          </kbd>
        )}
        <ActionSwatch action={action} actions={actions} />
        <span>{label.main}</span>
      </span>
      {label.sub === null ? null : <span className="text-xs text-muted tabular-nums">{label.sub}</span>}
    </Button>
  );
}

export function ActionBar({ actions, grouping, street, disabled = false, onAction }: ActionBarProps) {
  return (
    <div data-testid="action-bar" role="group" aria-label="Actions" className="flex flex-wrap gap-2">
      {actions.map((action, position) => (
        <ActionButton
          key={action.index}
          action={action}
          actions={actions}
          hotkey={position < MAX_HOTKEY_ACTIONS ? String(position + 1) : null}
          grouping={grouping}
          street={street}
          disabled={disabled}
          onAction={onAction}
        />
      ))}
    </div>
  );
}
