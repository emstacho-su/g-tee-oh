/**
 * The session defaults' two controls (S32, S37, R4.12, O-323, O-344; S47, R4.10): the grouping
 * ToggleGroup and the Mixed-frequency mode checkbox, each written straight to the session defaults
 * store. The Session defaults page renders them with its status line, and the automated start
 * panel renders them inline (S47) so the roll is turned on where the session starts instead of two
 * screens away. The stored field keeps the wire name rng.
 */
import { ToggleGroup } from "../../components/ui/index.js";
import type { Grouping } from "../../contracts.js";
import { GROUPING_LABELS } from "../../drills/labels.js";
import { GROUPINGS, useSessionDefaultsStore } from "../../store/index.js";
import { SESSION_TEXT } from "../drill-run/labels.js";
import { SESSION_DEFAULTS_TEXT } from "./settings-text.js";

const GROUPING_OPTIONS = GROUPINGS.map((value) => ({ value, label: GROUPING_LABELS[value] }));

export interface SessionDefaultsFieldsProps {
  /** Called after each write, so the owner can say "Saved" (the settings page) or nothing (the start panel). */
  onSaved?: () => void;
  /** A prefix for the hint id, so two renders on one page never share one. */
  idPrefix?: string;
}

export function SessionDefaultsFields({ onSaved, idPrefix = "session-defaults" }: SessionDefaultsFieldsProps) {
  const defaults = useSessionDefaultsStore((state) => state.defaults);
  const setGrouping = useSessionDefaultsStore((state) => state.setGrouping);
  const setRng = useSessionDefaultsStore((state) => state.setRng);
  const hintId = `${idPrefix}-rng-hint`;
  const saving = <T,>(apply: (value: T) => void) => (value: T): void => {
    apply(value);
    onSaved?.();
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium" aria-hidden="true">
          {SESSION_DEFAULTS_TEXT.grouping}
        </span>
        <ToggleGroup<Grouping> label={SESSION_DEFAULTS_TEXT.grouping} value={defaults.grouping} options={GROUPING_OPTIONS} onValueChange={saving(setGrouping)} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="inline-flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={defaults.rng} aria-describedby={hintId} onChange={(event) => saving(setRng)(event.target.checked)} className="h-4 w-4" />
          {SESSION_TEXT.rngSwitch}
        </label>
        <p id={hintId} className="text-sm text-muted">
          {SESSION_TEXT.rngHint}
        </p>
      </div>
    </>
  );
}
