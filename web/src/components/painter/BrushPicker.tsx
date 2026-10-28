/**
 * The painter's brushes (S27 lane B, R3.17, ADR 0020, A7 section 4): one brush per tree action of
 * the node, as a single-choice Radix ToggleGroup (arrow keys move between brushes, the chosen one
 * carries aria-checked). Each brush shows the action's swatch (color and hatch pattern) and its
 * label, so color is never the only signal; number keys 1 to 9 pick the first nine brushes
 * through useHotkey while the painter is enabled.
 */
import * as RadixToggleGroup from "@radix-ui/react-toggle-group";

import type { NodeAction } from "../../contracts.js";
import { useHotkey } from "../../hotkeys/index.js";
import { ActionSwatch } from "../trainer/ActionSwatch.js";
import { cn } from "../ui/index.js";
import { MAX_BRUSH_HOTKEYS } from "./paint-model.js";

export const BRUSH_SCOPE = "Brushes";
const BRUSH_GROUP_LABEL = "Brush";

export interface BrushPickerProps {
  actions: readonly NodeAction[];
  brush: number;
  enabled: boolean;
  onBrushChange: (brush: number) => void;
}

interface BrushHotkeyProps {
  action: NodeAction;
  position: number;
  enabled: boolean;
  onPick: (brush: number) => void;
}

/** Registers number key `position` for one brush; renders nothing. */
function BrushHotkey({ action, position, enabled, onPick }: BrushHotkeyProps) {
  useHotkey(
    { key: String(position), description: `Paint with ${action.label}`, scope: BRUSH_SCOPE, handler: () => onPick(action.index) },
    enabled && position <= MAX_BRUSH_HOTKEYS,
  );
  return null;
}

export function BrushPicker({ actions, brush, enabled, onBrushChange }: BrushPickerProps) {
  return (
    <>
      <RadixToggleGroup.Root
        type="single"
        aria-label={BRUSH_GROUP_LABEL}
        value={String(brush)}
        disabled={!enabled}
        onValueChange={(next) => {
          const chosen = actions.find((action) => String(action.index) === next);
          if (chosen !== undefined) onBrushChange(chosen.index);
        }}
        className="inline-flex flex-wrap gap-1 rounded-md border border-border bg-surface-sunken p-1"
      >
        {actions.map((action, position) => (
          <RadixToggleGroup.Item
            key={action.index}
            value={String(action.index)}
            aria-keyshortcuts={position < MAX_BRUSH_HOTKEYS ? String(position + 1) : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm text-muted",
              "data-[state=on]:bg-surface-raised data-[state=on]:font-semibold data-[state=on]:text-text data-[state=on]:ring-2 data-[state=on]:ring-accent",
            )}
          >
            {position < MAX_BRUSH_HOTKEYS ? (
              <kbd aria-hidden="true" className="font-mono text-xs text-muted">
                {position + 1}
              </kbd>
            ) : null}
            <ActionSwatch action={action} actions={actions} />
            <span>{action.label}</span>
          </RadixToggleGroup.Item>
        ))}
      </RadixToggleGroup.Root>
      {actions.map((action, position) => (
        <BrushHotkey key={action.index} action={action} position={position + 1} enabled={enabled} onPick={onBrushChange} />
      ))}
    </>
  );
}
