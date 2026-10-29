/**
 * The drill run's start panel (S25, S38, R3.13, O-283, O-288, O-346, A7 section 3): the drill's name,
 * then its grouping, stop rule and pause rule (S26, O-314; spot mode shows its fixed pause after
 * every action) as chips, named from src/drills/labels.ts as the library and the builder name them
 * (PR #30 review LOW 10), the session length chooser (S46, R3.31, SessionLengthField), the
 * Mixed-frequency mode switch and Start, all in one raised S36 Card.
 *
 * The switch starts at the drill's trainer.rng and only overrides it for this session (POST
 * /sessions settings.rng); turning it on asks the explainer to open on first use (the caller's
 * onRngChange). It is a button with role switch and aria-checked, its state also printed as On or
 * Off, so it never relies on colour; it takes the shared tactile press and the checked control edge
 * (CONTROL_EDGE_CLASS, WCAG 1.4.11). components/ui has no switch primitive yet, so it stays here.
 */
import { useId } from "react";

import { Button, Card, CONTROL_EDGE_CLASS, LoadingNote, TACTILE_CLASS, cn } from "../../components/ui/index.js";
import { GROUPING_LABELS, PAUSE_LABELS, STOP_RULE_LABELS } from "../../drills/labels.js";
import { SPOT_MODE_SETTINGS } from "../../trainer/pause-rule.js";
import type { SessionLength } from "../../trainer/session-length.js";
import type { Drill, PauseRule } from "../../trainer/session-types.js";
import { SESSION_TEXT } from "./labels.js";
import { SessionLengthField } from "./SessionLengthField.js";
import { SettingChips } from "./SessionLook.js";

/** Spot mode always pauses on the reveal (O-284); the other modes follow trainer.pause (O-314). */
function shownPauseRule(drill: Drill): PauseRule {
  return drill.trainer.stop_rule === "after_action" ? SPOT_MODE_SETTINGS.pause : drill.trainer.pause;
}

export interface StartPanelProps {
  drill: Drill;
  rng: boolean;
  onRngChange: (rng: boolean) => void;
  /** The planned session length from the session defaults, and the change that writes it back (S46, R3.31). */
  sessionLength: SessionLength;
  onSessionLengthChange: (length: SessionLength) => void;
  onStart: () => void;
  starting: boolean;
}

interface RngSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  hintId: string;
}

function RngSwitch({ checked, onChange, hintId }: RngSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={SESSION_TEXT.rngSwitch}
      aria-describedby={hintId}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex items-center gap-3 self-start rounded-xl bg-surface-raised px-3 py-2 text-sm font-semibold",
        TACTILE_CLASS,
        CONTROL_EDGE_CLASS,
      )}
    >
      <span aria-hidden="true" className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-surface-sunken")}>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-surface-raised shadow transition-[left]", checked ? "left-4" : "left-0.5")} />
      </span>
      <span aria-hidden="true">{SESSION_TEXT.rngSwitch}</span>
      <span aria-hidden="true" className={cn("rounded-full px-2 text-xs", checked ? "bg-accent text-accent-text" : "bg-surface-sunken text-muted")}>
        {checked ? "On" : "Off"}
      </span>
    </button>
  );
}

export function StartPanel({ drill, rng, onRngChange, sessionLength, onSessionLengthChange, onStart, starting }: StartPanelProps) {
  const hintId = useId();
  const chips = [
    { name: SESSION_TEXT.grouping, value: GROUPING_LABELS[drill.trainer.grouping] },
    { name: SESSION_TEXT.stopRule, value: STOP_RULE_LABELS[drill.trainer.stop_rule] },
    { name: SESSION_TEXT.pauseRule, value: PAUSE_LABELS[shownPauseRule(drill)], valueTestId: "pause-rule" },
  ];
  return (
    <Card title={drill.name} testId="start-panel" className="max-w-xl">
      <SettingChips label={SESSION_TEXT.drillSettings} chips={chips} />
      <SessionLengthField value={sessionLength} onChange={onSessionLengthChange} />
      <div className="flex flex-col gap-2">
        <RngSwitch checked={rng} onChange={onRngChange} hintId={hintId} />
        <p id={hintId} className="text-sm text-muted">
          {SESSION_TEXT.rngHint}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" disabled={starting} onClick={onStart}>
          {SESSION_TEXT.start}
        </Button>
        {starting ? <LoadingNote text={SESSION_TEXT.starting} /> : null}
      </div>
    </Card>
  );
}
