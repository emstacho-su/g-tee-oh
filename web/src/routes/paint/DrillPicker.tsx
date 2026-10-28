/**
 * The /paint drill picker (S27 lane B, R3.17, O-302): the user's drills as a radio list and Start
 * painting, which starts a drill-backed range_paint session (the drill's stored spots decide which
 * node is painted). With no drill yet it links to the drill builder. Native radio inputs, so the
 * keyboard and screen readers get the standard single-choice behaviour.
 */
import { Link } from "@tanstack/react-router";
import { useId } from "react";

import { Button, LoadingNote } from "../../components/ui/index.js";
import type { Drill } from "../../trainer/session-types.js";

export const PICKER_TEXT = {
  legend: "Drill to paint",
  start: "Start painting",
  starting: "Starting a range-painting session.",
  empty: "You have no drill yet. A drill names the spots to paint.",
  newDrill: "New drill",
} as const;

export interface DrillPickerProps {
  drills: readonly Drill[];
  selected: string | null;
  starting: boolean;
  onSelect: (drillId: string) => void;
  onStart: () => void;
}

export function DrillPicker({ drills, selected, starting, onSelect, onStart }: DrillPickerProps) {
  const name = useId();
  if (drills.length === 0) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm">
        {PICKER_TEXT.empty}
        <Link to="/drills/new" className="font-medium text-accent underline">
          {PICKER_TEXT.newDrill}
        </Link>
      </p>
    );
  }
  return (
    <div data-testid="paint-picker" className="flex max-w-xl flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">{PICKER_TEXT.legend}</legend>
        {drills.map((drill) => (
          <label key={drill.id} className="flex items-center gap-2 text-sm">
            <input type="radio" name={name} value={drill.id} checked={selected === drill.id} onChange={() => onSelect(drill.id)} />
            {drill.name}
          </label>
        ))}
      </fieldset>
      <div className="flex items-center gap-3">
        <Button variant="primary" size="lg" disabled={selected === null || starting} onClick={onStart}>
          {PICKER_TEXT.start}
        </Button>
        {starting ? <LoadingNote text={PICKER_TEXT.starting} /> : null}
      </div>
    </div>
  );
}
