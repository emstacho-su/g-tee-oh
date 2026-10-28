/**
 * The roll scale of Mixed-frequency mode (S24, S37, 05 section 7, R3.10, R3.13, O-213, O-344,
 * O-376, ADR 0024). The wire name stays rng (settings.rng, rng_roll, O-377); every word on screen
 * says Mixed-frequency mode.
 *
 * Mechanism: one component in two states, on one 1 to 100 track with the roll's marker and its
 * "Roll 37" label at the same place in both.
 * - hidden (before the decision): ticks at 1, 25, 50, 75 and 100 and the marker, nothing else. The
 *   prompt carries the roll but no strategy (predict before peek, 05 section 5), so the hero weighs
 *   every option's frequency without the scale naming one (screen review rows 13 and 21). This
 *   state needs only the roll.
 * - revealed (after the decision): the same track with one segment per band, as wide as the band,
 *   in the action's color, pattern and short letter with the range text ("16-95 Raise to 2.5bb"),
 *   and the caption "Roll 37 fell on Raise to 2.5bb". The bands grow in from the left: the band list
 *   starts clipped to nothing and a frame later unclips, through a CSS transition on clip-path; under
 *   prefers-reduced-motion (Tailwind's motion-reduce) there is no transition, so the bands simply
 *   appear (O-376). A band narrower than NARROW_BAND_ROLLS rolls shows only its swatch and letter in
 *   the strip, with the full text as its tooltip and for screen readers; the legend under the strip
 *   always lists every band in full.
 * The bands and the band the roll fell in come only from rngBands and rollSelectedAction in
 * packages/learning, the one entry grade() also uses (O-213); this component computes no band. It
 * never says Best: the label follows EV (ADR 0024 rule 1) and FeedbackRoller adds the separate
 * followed-the-roll mark. The info button calls onExplain; without onExplain there is no info
 * button (the explainer draws its own example scales, which must not hold a button that only
 * reopens the dialog they sit in). Input the learning package rejects (lengths that differ, a roll
 * outside 1 to 100, an unknown bucket) renders an alert instead of a guessed strip.
 *
 * Numbering (O-198): packages/learning returns record positions (RngBand.actionIndex and
 * rollSelectedAction's result), which this component uses only to read actions and the positional
 * freqByAction. Wherever an index leaves the component (data-selected-index on the scale,
 * data-action-index on each band) it is converted to NodeAction.index through
 * src/poker/action-index.ts.
 */
import { RNG_ROLL_MAX, RNG_ROLL_MIN, rngBands, rollSelectedAction, type RngBand } from "@g-tee-oh/learning";
import { useEffect, useState, type ReactNode } from "react";

import { Button, VisuallyHidden, cn } from "../ui/index.js";
import type { NodeAction } from "../../contracts.js";
import { indexAtPosition } from "../../poker/action-index.js";
import { toGradeActions } from "../../poker/grade-actions.js";
import { ACTION_FILL_CLASSES, ActionSwatch, actionFillStyle } from "./ActionSwatch.js";
import { RNG_EXPLAINER_TITLE } from "./use-rng-explainer.js";

/** Before the decision: the roll alone. */
export interface HiddenRollerProps {
  hidden: true;
  roll: number;
  /** Opens the explainer; the info button is left out when absent. */
  onExplain?: () => void;
}

/** After the decision: the bands of the hand's frequencies, with the roll marked when there is one. */
export interface RevealedRollerProps {
  hidden?: false;
  actions: readonly NodeAction[];
  /** One frequency per action, by position in actions (record order). */
  freqByAction: readonly number[];
  roll: number | null;
  /** Opens the explainer; the info button is left out when absent. */
  onExplain?: () => void;
}

export type RngRollerProps = HiddenRollerProps | RevealedRollerProps;

type RollerModel =
  | {
      readonly ok: true;
      readonly bands: readonly RngBand[];
      /** The record position of the band the roll fell in, for reading actions; null without a roll. */
      readonly selectedPosition: number | null;
      /** That action's NodeAction.index, the only index that leaves the component. */
      readonly selectedIndex: number | null;
    }
  | { readonly ok: false; readonly message: string };

const ROLL_SPAN = RNG_ROLL_MAX - RNG_ROLL_MIN + 1;
const PERCENT = 100;
/** Centers the marker inside its roll's one-percent slot. */
const HALF_SLOT = 0.5;
/** Bands narrower than this many rolls (a fifth of the strip) show no text inside the strip. */
export const NARROW_BAND_ROLLS = 20;
/** The tick values of the hidden scale. */
export const SCALE_TICKS: readonly number[] = [RNG_ROLL_MIN, 25, 50, 75, RNG_ROLL_MAX];
/** The clip-path of the band list before and after the reveal (left to right, O-376). */
const CLIPPED = "inset(0px 100% 0px 0px)";
const UNCLIPPED = "inset(0px 0% 0px 0px)";

export const ROLLER_TEXT = {
  bands: "Mixed-frequency bands",
  legend: "Mixed-frequency band legend",
  unavailable: "Mixed-frequency bands unavailable",
  mode: "Mixed-frequency mode",
} as const;

function rollerModel(actions: readonly NodeAction[], freqByAction: readonly number[], roll: number | null): RollerModel {
  try {
    const gradeActions = toGradeActions(actions);
    const bands = rngBands(freqByAction, gradeActions);
    const selectedPosition = roll === null ? null : rollSelectedAction(freqByAction, gradeActions, roll);
    const selectedIndex = selectedPosition === null ? null : indexAtPosition(actions, selectedPosition);
    return { ok: true, bands, selectedPosition, selectedIndex };
  } catch (error: unknown) {
    if (error instanceof RangeError) return { ok: false, message: error.message };
    throw error;
  }
}

/** "16-95 Raise to 2.5bb": a band's range and its action's button label. */
function bandText(band: RngBand, action: NodeAction): string {
  return `${band.from}-${band.to} ${action.label}`;
}

function percentOf(rolls: number): string {
  return `${(rolls * PERCENT) / ROLL_SPAN}%`;
}

function markerLeft(roll: number): string {
  return percentOf(roll - RNG_ROLL_MIN + HALF_SLOT);
}

function InfoButton({ onExplain }: { onExplain: (() => void) | undefined }) {
  if (onExplain === undefined) return null;
  return (
    <Button variant="ghost" size="sm" aria-label={RNG_EXPLAINER_TITLE} onClick={onExplain}>
      <span aria-hidden="true">ⓘ</span>
    </Button>
  );
}

/** The roll's label above its marker, at the same place before and after the reveal. */
function RollLabel({ roll }: { roll: number }) {
  return (
    <div className="relative h-5">
      <span
        data-testid="rng-roll-label"
        style={{ left: markerLeft(roll) }}
        className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-xs font-semibold tabular-nums"
      >
        {`Roll ${roll}`}
      </span>
    </div>
  );
}

function Marker({ roll }: { roll: number }) {
  return (
    <span
      data-testid="rng-marker"
      aria-hidden="true"
      style={{ left: markerLeft(roll) }}
      className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 bg-text"
    />
  );
}

interface ShellProps {
  revealed: boolean;
  selectedIndex?: number | null;
  heading: string;
  onExplain: (() => void) | undefined;
  children: ReactNode;
}

function Shell({ revealed, selectedIndex = null, heading, onExplain, children }: ShellProps) {
  return (
    <div
      data-testid="rng-roller"
      data-revealed={String(revealed)}
      {...(selectedIndex === null ? {} : { "data-selected-index": String(selectedIndex) })}
      className="flex flex-col gap-1"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium" aria-live="polite">
          {heading}
        </p>
        <InfoButton onExplain={onExplain} />
      </div>
      {children}
    </div>
  );
}

function HiddenRoller({ roll, onExplain }: HiddenRollerProps) {
  return (
    <Shell revealed={false} heading={ROLLER_TEXT.mode} onExplain={onExplain}>
      <RollLabel roll={roll} />
      <div role="img" aria-label={`Roll ${roll} on a scale from ${RNG_ROLL_MIN} to ${RNG_ROLL_MAX}`} className="relative">
        <div className="h-12 w-full rounded border border-border bg-surface-sunken" />
        <Marker roll={roll} />
      </div>
      <div aria-hidden="true" className="relative h-4 text-xs text-muted">
        {SCALE_TICKS.map((tick) => (
          <span key={tick} data-testid="rng-tick" style={{ left: markerLeft(tick) }} className="absolute top-0 -translate-x-1/2 tabular-nums">
            {tick}
          </span>
        ))}
      </div>
    </Shell>
  );
}

/** False on the first frame, true from the next one, so the band list's clip-path can transition. */
function useRevealed(): boolean {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setRevealed(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return revealed;
}

interface BandStripProps {
  actions: readonly NodeAction[];
  bands: readonly RngBand[];
  selectedPosition: number | null;
}

function BandStrip({ actions, bands, selectedPosition }: BandStripProps) {
  const unclipped = useRevealed();
  return (
    <ol
      aria-label={ROLLER_TEXT.bands}
      data-reveal={unclipped ? "done" : "pending"}
      style={{ clipPath: unclipped ? UNCLIPPED : CLIPPED }}
      className="flex h-12 w-full overflow-hidden rounded border border-border motion-safe:transition-[clip-path] motion-safe:duration-500 motion-safe:ease-out motion-reduce:transition-none"
    >
      {bands.map((band) => {
        const action = actions[band.actionIndex];
        if (action === undefined) return null;
        const text = bandText(band, action);
        const narrow = band.to - band.from + 1 < NARROW_BAND_ROLLS;
        const current = band.actionIndex === selectedPosition;
        return (
          <li
            key={action.index}
            data-range={`${band.from}-${band.to}`}
            data-action-index={action.index}
            title={text}
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
              {narrow ? <VisuallyHidden>{text}</VisuallyHidden> : <span data-testid="rng-band-label">{text}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RevealedRoller({ actions, freqByAction, roll, onExplain }: RevealedRollerProps) {
  const model = rollerModel(actions, freqByAction, roll);
  if (!model.ok) {
    return (
      <div data-testid="rng-roller" data-revealed="true" className="flex items-center gap-2">
        <p role="alert" className="text-danger">{`${ROLLER_TEXT.unavailable}: ${model.message}`}</p>
        <InfoButton onExplain={onExplain} />
      </div>
    );
  }
  const selectedAction = model.selectedPosition === null ? undefined : actions[model.selectedPosition];
  const heading = roll === null || selectedAction === undefined ? ROLLER_TEXT.mode : `Roll ${roll} fell on ${selectedAction.label}`;
  return (
    <Shell revealed selectedIndex={model.selectedIndex} heading={heading} onExplain={onExplain}>
      {roll === null ? null : <RollLabel roll={roll} />}
      <div className="relative">
        <BandStrip actions={actions} bands={model.bands} selectedPosition={model.selectedPosition} />
        {roll === null ? null : <Marker roll={roll} />}
      </div>
      <ul aria-label={ROLLER_TEXT.legend} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {model.bands.map((band) => {
          const action = actions[band.actionIndex];
          if (action === undefined) return null;
          return (
            <li key={action.index} className="flex items-center gap-1">
              <ActionSwatch action={action} actions={actions} />
              <span>{bandText(band, action)}</span>
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}

export function RngRoller(props: RngRollerProps) {
  return props.hidden === true ? <HiddenRoller {...props} /> : <RevealedRoller {...props} />;
}
