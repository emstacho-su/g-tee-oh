/**
 * The drill run's start panel (S25, S38, R3.13, O-283, O-288, O-346, A7 section 3): the drill's name,
 * then its grouping, stop rule and pause rule (S26, O-314; spot mode shows its fixed pause after
 * every action) as chips, named from src/drills/labels.ts as the library and the builder name them
 * (PR #30 review LOW 10), the Mixed-frequency mode switch and Start, all in one raised S36 Card.
 *
 * The switch starts at the drill's trainer.rng and only overrides it for this session (POST
 * /sessions settings.rng); turning it on asks the explainer to open on first use (the caller's
 * onRngChange). It is a button with role switch and aria-checked, its state also printed as On or
 * Off, so it never relies on colour; it takes the shared tactile press and the checked control edge
 * (CONTROL_EDGE_CLASS, WCAG 1.4.11). components/ui has no switch primitive yet, so it stays here.
 * S47 (R3.36, O-487): optional slots, an Options disclosure for session-only overrides, a note line
 * and an Edit drill link; the switch stays where it is.
 */
import { Link } from "@tanstack/react-router";
import { useId, type ReactNode } from "react";

import { Button, Card, CONTROL_EDGE_CLASS, Disclosure, LoadingNote, TACTILE_CLASS, cn } from "../../components/ui/index.js";
import { GROUPING_LABELS, PAUSE_LABELS, STOP_RULE_LABELS } from "../../drills/labels.js";
import { SPOT_MODE_SETTINGS } from "../../trainer/pause-rule.js";
import type { Drill, PauseRule } from "../../trainer/session-types.js";
import { SESSION_TEXT } from "./labels.js";
import { SettingChips } from "./SessionLook.js";

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
  /** Session-only controls shown behind an Options disclosure (S47, O-487: SessionOverrides). */
  options?: ReactNode;
  /** Offer "Edit drill", a link to the drill's builder (S47, R3.36). */
  editLink?: boolean;
  /** A line above Start, for example that the library just added a spot (CoverageWatch). */
  note?: string | null;
}

export const START_PANEL_TEXT = {
  options: "Options",
  editDrill: "Edit drill",
} as const;

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

export function StartPanel({ drill, rng, onRngChange, onStart, starting, options, editLink = false, note = null }: StartPanelProps) {
  const hintId = useId();
  const chips = [
    { name: SESSION_TEXT.grouping, value: GROUPING_LABELS[drill.trainer.grouping] },
    { name: SESSION_TEXT.stopRule, value: STOP_RULE_LABELS[drill.trainer.stop_rule] },
    { name: SESSION_TEXT.pauseRule, value: PAUSE_LABELS[shownPauseRule(drill)], valueTestId: "pause-rule" },
  ];
  return (
    <Card title={drill.name} testId="start-panel" className="max-w-xl">
      <SettingChips label={SESSION_TEXT.drillSettings} chips={chips} />
      <div className="flex flex-col gap-2">
        <RngSwitch checked={rng} onChange={onRngChange} hintId={hintId} />
        <p id={hintId} className="text-sm text-muted">
          {SESSION_TEXT.rngHint}
        </p>
      </div>
      {options === undefined ? null : (
        <Disclosure title={START_PANEL_TEXT.options} headingLevel={3} testId="start-options">
          {options}
        </Disclosure>
      )}
      {note === null ? null : (
        <p role="status" data-testid="start-note" className="text-sm font-medium">
          {note}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" disabled={starting} onClick={onStart}>
          {SESSION_TEXT.start}
        </Button>
        {starting ? <LoadingNote text={SESSION_TEXT.starting} /> : null}
        {editLink ? (
          <Link to="/drills/$id/$section" params={{ id: drill.id, section: "details" }} className="text-sm font-medium text-accent underline underline-offset-2">
            {START_PANEL_TEXT.editDrill}
          </Link>
        ) : null}
      </div>
    </Card>
  );
}
