/**
 * The 13 by 13 hand picker for a manual hand list (S26, R3.14, A7 section 4). Each of the 169
 * hand classes is a toggle button whose accessible name is the class ("AKs", "77", "T9o") and
 * whose state is aria-pressed; a chosen cell is filled, bold, thick-edged and ticked in its corner,
 * so color is never the only signal. Cells keep a readable minimum size and the grid scrolls in its
 * own frame at phone width (S47 critic). The grid is one Tab stop with a roving tabindex: the arrow keys move between cells
 * (Home and End jump within a row), and Space or Enter toggles the focused cell, as a native
 * button does. The layout is hands.ts's chart layout: pairs on the diagonal, suited above it,
 * offsuit below.
 */
import { useRef, useState, type KeyboardEvent } from "react";

import { Button, cn } from "../../components/ui/index.js";
import { GRID_SIZE, HAND_GRID } from "../../poker/hands.js";

export interface HandPickerProps {
  selected: readonly string[];
  onToggle: (hand: string) => void;
  onSetAll: (hands: readonly string[]) => void;
  describedBy?: string | undefined;
}

const ALL_HANDS: readonly string[] = HAND_GRID.map((cell) => cell.hand);
/** The smallest cell, in rem: room for a three-character hand at text-xs (about 28px). */
const MIN_CELL_REM = 1.75;
const LAST = GRID_SIZE - 1;

/** The index a key moves the focus to, or undefined for a key the grid does not handle. */
export function nextCellIndex(index: number, key: string): number | undefined {
  const row = Math.floor(index / GRID_SIZE);
  const col = index % GRID_SIZE;
  const moves: Readonly<Record<string, readonly [number, number]>> = {
    ArrowRight: [row, Math.min(col + 1, LAST)],
    ArrowLeft: [row, Math.max(col - 1, 0)],
    ArrowDown: [Math.min(row + 1, LAST), col],
    ArrowUp: [Math.max(row - 1, 0), col],
    Home: [row, 0],
    End: [row, LAST],
  };
  const move = moves[key];
  return move === undefined ? undefined : move[0] * GRID_SIZE + move[1];
}

export function HandPicker({ selected, onToggle, onSetAll, describedBy }: HandPickerProps) {
  const [focusIndex, setFocusIndex] = useState(0);
  const cells = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const next = nextCellIndex(index, event.key);
    if (next === undefined) return;
    event.preventDefault();
    setFocusIndex(next);
    cells.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <p aria-live="polite" data-testid="hand-count">{`${selected.length} of ${ALL_HANDS.length} hands chosen`}</p>
        <Button size="sm" onClick={() => onSetAll(ALL_HANDS)}>
          Choose all
        </Button>
        <Button size="sm" onClick={() => onSetAll([])}>
          Clear
        </Button>
      </div>
      {/* A readable minimum cell that scrolls inside its own frame at phone width (S47 critic G10, G2). */}
      <div className="max-w-full overflow-x-auto" data-testid="hand-picker-frame">
      <div
        role="group"
        aria-label="Hand picker"
        aria-describedby={describedBy}
        className="grid w-max min-w-full max-w-xl gap-px"
        style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, minmax(${MIN_CELL_REM}rem, 1fr))` }}
      >
        {HAND_GRID.map((cell, index) => {
          const on = selected.includes(cell.hand);
          return (
            <button
              key={cell.hand}
              ref={(element) => {
                cells.current[index] = element;
              }}
              type="button"
              aria-pressed={on}
              tabIndex={index === focusIndex ? 0 : -1}
              onFocus={() => setFocusIndex(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              onClick={() => onToggle(cell.hand)}
              className={cn(
                "relative aspect-square min-w-0 rounded-sm text-xs leading-none",
                on ? "border-2 border-text bg-accent font-bold text-accent-text" : "border border-border bg-surface-sunken text-muted",
              )}
            >
              {cell.hand}
              {/* The chosen mark sits in the corner, so it never crowds a three-character hand off its cell. */}
              {on ? (
                <span aria-hidden="true" data-testid="hand-chosen-mark" className="absolute right-0.5 top-0 text-[0.55rem] leading-none">
                  {"✓"}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}
