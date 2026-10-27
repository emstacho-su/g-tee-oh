/**
 * The RNG (random number generator) mode strip (S24, 05 section 7, R3.13, O-213, ADR 0009).
 *
 * Mechanism: a roll from 1 to 100 picks the action whose cumulative frequency band contains it,
 * bands ordered passive to aggressive. The bands and the selected action come only from
 * rngBands and rollSelectedAction in packages/learning, the one entry grade() also uses (O-213),
 * so the strip and the grade can never disagree; this component computes no band itself. It
 * draws one segment per band, as wide as the band, with the action's color, pattern, short letter
 * and the range text ("16-95 Raise to 2.5bb"), a marker at the roll, and the sentence "Roll 37
 * selects Raise to 2.5bb". The info button calls onExplain; the explainer itself is S25. Input the
 * learning package rejects (lengths that differ, a roll outside 1 to 100, an unknown bucket)
 * renders an alert instead of a guessed strip.
 */
import { RNG_ROLL_MAX, RNG_ROLL_MIN, rngBands, rollSelectedAction, type RngBand } from "@g-tee-oh/learning";

import { Button, cn } from "../ui/index.js";
import type { NodeAction } from "../../contracts.js";
import { toGradeActions } from "../../poker/grade-actions.js";
import { ACTION_FILL_CLASSES, ActionSwatch, actionFillStyle } from "./ActionSwatch.js";

export interface RngRollerProps {
  actions: readonly NodeAction[];
  freqByAction: readonly number[];
  roll: number | null;
  onExplain: () => void;
}

type RollerModel =
  | { readonly ok: true; readonly bands: readonly RngBand[]; readonly selected: number | null }
  | { readonly ok: false; readonly message: string };

const ROLL_SPAN = RNG_ROLL_MAX - RNG_ROLL_MIN + 1;
const PERCENT = 100;
/** Centers the marker inside its roll's one-percent slot. */
const HALF_SLOT = 0.5;

function rollerModel(actions: readonly NodeAction[], freqByAction: readonly number[], roll: number | null): RollerModel {
  try {
    const gradeActions = toGradeActions(actions);
    const bands = rngBands(freqByAction, gradeActions);
    const selected = roll === null ? null : rollSelectedAction(freqByAction, gradeActions, roll);
    return { ok: true, bands, selected };
  } catch (error: unknown) {
    if (error instanceof RangeError) return { ok: false, message: error.message };
    throw error;
  }
}

function percentOf(rolls: number): string {
  return `${(rolls * PERCENT) / ROLL_SPAN}%`;
}

function InfoButton({ onExplain }: { onExplain: () => void }) {
  return (
    <Button variant="ghost" size="sm" aria-label="How RNG mode works" onClick={onExplain}>
      <span aria-hidden="true">ⓘ</span>
    </Button>
  );
}

export function RngRoller({ actions, freqByAction, roll, onExplain }: RngRollerProps) {
  const model = rollerModel(actions, freqByAction, roll);
  if (!model.ok) {
    return (
      <div data-testid="rng-roller" className="flex items-center gap-2">
        <p role="alert" className="text-danger">{`RNG bands unavailable: ${model.message}`}</p>
        <InfoButton onExplain={onExplain} />
      </div>
    );
  }
  const selectedAction = model.selected === null ? undefined : actions[model.selected];
  return (
    <div
      data-testid="rng-roller"
      {...(model.selected === null ? {} : { "data-selected-index": String(model.selected) })}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium" aria-live="polite">
          {roll === null || selectedAction === undefined ? "RNG mode" : `Roll ${roll} selects ${selectedAction.label}`}
        </p>
        <InfoButton onExplain={onExplain} />
      </div>
      <div className="relative">
        <ol aria-label="RNG bands" className="flex h-12 w-full overflow-hidden rounded border border-border">
          {model.bands.map((band) => {
            const action = actions[band.actionIndex];
            if (action === undefined) return null;
            const range = `${band.from}-${band.to}`;
            const current = band.actionIndex === model.selected;
            return (
              <li
                key={band.actionIndex}
                data-range={range}
                {...(current ? { "aria-current": "true" } : {})}
                style={{ ...actionFillStyle(action, actions), width: percentOf(band.to - band.from + 1) }}
                className={cn(
                  "flex min-w-0 items-center justify-center gap-1 overflow-hidden border-r border-black/20 px-1 text-xs text-slate-900",
                  ACTION_FILL_CLASSES,
                  current && "outline outline-2 -outline-offset-2 outline-focus",
                )}
              >
                <span className="flex items-center gap-1 truncate rounded bg-white/80 px-1">
                  <ActionSwatch action={action} actions={actions} />
                  <span>{`${range} ${action.label}`}</span>
                </span>
              </li>
            );
          })}
        </ol>
        {roll === null ? null : (
          <span
            data-testid="rng-marker"
            aria-hidden="true"
            style={{ left: percentOf(roll - RNG_ROLL_MIN + HALF_SLOT) }}
            className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 bg-text"
          />
        )}
      </div>
    </div>
  );
}
