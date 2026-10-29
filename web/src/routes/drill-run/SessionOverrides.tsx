/**
 * Session-only run overrides on the start panel (S47, R3.13, O-487): the pause rule and the reveal
 * speed for this session, behind the panel's Options disclosure. They change the web's run settings
 * (trainer/pause-rule.ts) for the session about to start and never the stored drill; the Mixed-
 * frequency switch stays outside, where it has always been. Spot mode always pauses on the reveal
 * (O-284), so the pause choice shows only for street and full-hand drills.
 */
import { ToggleGroup } from "../../components/ui/index.js";
import { PAUSE_LABELS, SPEED_LABELS } from "../../drills/labels.js";
import type { PauseRule, RevealSpeed, RunSettings, StopRule } from "../../trainer/session-types.js";

export const OVERRIDES_TEXT = {
  options: "Options",
  pause: "Pause this session",
  speed: "Speed this session",
  hint: "This session only; the drill keeps its own settings.",
} as const;

const PAUSE_OPTIONS = (Object.keys(PAUSE_LABELS) as PauseRule[]).map((value) => ({ value, label: PAUSE_LABELS[value] }));
const SPEED_OPTIONS = (Object.keys(SPEED_LABELS) as RevealSpeed[]).map((value) => ({ value, label: SPEED_LABELS[value] }));
const SPOT_MODE: StopRule = "after_action";

export type SessionOverrideValues = Partial<Pick<RunSettings, "pause" | "speed">>;

export interface SessionOverridesProps {
  /** The drill's own run settings, the values shown until an override is chosen. */
  trainer: RunSettings;
  value: SessionOverrideValues;
  onChange: (value: SessionOverrideValues) => void;
}

export function SessionOverrides({ trainer, value, onChange }: SessionOverridesProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="session-overrides">
      {trainer.stop_rule === SPOT_MODE ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium" aria-hidden="true">
            {OVERRIDES_TEXT.pause}
          </span>
          <ToggleGroup<PauseRule> label={OVERRIDES_TEXT.pause} value={value.pause ?? trainer.pause} options={PAUSE_OPTIONS} onValueChange={(pause) => onChange({ ...value, pause })} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium" aria-hidden="true">
          {OVERRIDES_TEXT.speed}
        </span>
        <ToggleGroup<RevealSpeed> label={OVERRIDES_TEXT.speed} value={value.speed ?? trainer.speed} options={SPEED_OPTIONS} onValueChange={(speed) => onChange({ ...value, speed })} />
      </div>
      <p className="text-sm text-muted">{OVERRIDES_TEXT.hint}</p>
    </div>
  );
}
