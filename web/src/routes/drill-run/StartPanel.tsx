/**
 * The drill run's start panel (S25, R3.13, O-283, O-288, A7 section 3): the drill's name, grouping,
 * stop rule and pause rule (S26, O-314; spot mode shows its fixed pause after every action), named
 * from src/drills/labels.ts as the library and the builder name them (PR #30 review LOW 10), the RNG
 * mode switch and Start. The switch starts at the drill's trainer.rng and
 * only overrides it for this session (POST /sessions settings.rng); turning it on asks the RNG
 * explainer to open on first use (the caller's onRngChange). The switch is a button with role
 * switch and aria-checked, and its state is also printed as On or Off, so it never relies on color.
 */
import { useId } from "react";

import { Button, LoadingNote, cn } from "../../components/ui/index.js";
import { GROUPING_LABELS, PAUSE_LABELS, STOP_RULE_LABELS } from "../../drills/labels.js";
import { SPOT_MODE_SETTINGS } from "../../trainer/pause-rule.js";
import type { Drill, PauseRule } from "../../trainer/session-types.js";
import { SESSION_TEXT } from "./labels.js";

/** Spot mode always pauses on the reveal (O-284); the other modes follow trainer.pause (O-314). */
function shownPauseRule(drill: Drill): PauseRule {
  return drill.trainer.stop_rule === "after_action" ? SPOT_MODE_SETTINGS.pause : drill.trainer.pause;
}

export interface StartPanelProps {
  drill: Drill;
  rng: boolean;
  onRngChange: (rng: boolean) => void;
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
      className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-sm font-medium"
    >
      <span aria-hidden="true" className={cn("relative h-5 w-9 rounded-full", checked ? "bg-accent" : "bg-surface-sunken")}>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left]", checked ? "left-4" : "left-0.5")} />
      </span>
      <span aria-hidden="true">{SESSION_TEXT.rngSwitch}</span>
      <span aria-hidden="true" className="font-semibold">
        {checked ? "On" : "Off"}
      </span>
    </button>
  );
}

export function StartPanel({ drill, rng, onRngChange, onStart, starting }: StartPanelProps) {
  const headingId = useId();
  const hintId = useId();
  return (
    <section aria-labelledby={headingId} data-testid="start-panel" className="flex max-w-xl flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4">
      <h2 id={headingId} className="text-xl font-semibold">
        {drill.name}
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">{SESSION_TEXT.grouping}</dt>
        <dd>{GROUPING_LABELS[drill.trainer.grouping]}</dd>
        <dt className="text-muted">{SESSION_TEXT.stopRule}</dt>
        <dd>{STOP_RULE_LABELS[drill.trainer.stop_rule]}</dd>
        <dt className="text-muted">{SESSION_TEXT.pauseRule}</dt>
        <dd data-testid="pause-rule">{PAUSE_LABELS[shownPauseRule(drill)]}</dd>
      </dl>
      <div className="flex flex-col gap-1">
        <RngSwitch checked={rng} onChange={onRngChange} hintId={hintId} />
        <p id={hintId} className="text-sm text-muted">
          {SESSION_TEXT.rngHint}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" size="lg" disabled={starting} onClick={onStart}>
          {SESSION_TEXT.start}
        </Button>
        {starting ? <LoadingNote text={SESSION_TEXT.starting} /> : null}
      </div>
    </section>
  );
}
