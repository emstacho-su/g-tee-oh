/**
 * The range and nut advantage card (S45, R3.12, O-461, design rule 6: who is ahead is read first).
 *
 * Mechanism: StudyInsights.range_advantage and nut_advantage as solver-query computed them (ADR
 * 0004): each seat's mean equity against the other range, and each seat's share of its range at or
 * above the served nut threshold. Both show as a pair of two-sided bars, out-of-position seat first,
 * each bar as wide as the seat's served share with the seat and the number printed beside it, so
 * colour is never the only signal. One sentence then says, for the seat to act, whether it is ahead
 * or behind and by how many points, from the served to-act differences. solver-query has no equity
 * at a postflop node in v1 (O-32), so both blocks are null there and the card says so in words. The
 * card does not depend on the selected hand: the screen reads it with a stand-in hand until one is
 * chosen (O-461). Numbers are only formatted, one decimal like every text surface.
 */
import { useId } from "react";

import type { StudyInsights } from "../../contracts.js";
import { formatShare } from "../../poker/format.js";
import { RAISED_CLASS, cn } from "../ui/index.js";

export const ADVANTAGE_TEXT = {
  title: "Range and nut advantage",
  equity: "Mean equity",
  nuts: (threshold: string) => `Nut hands: ${threshold} equity or more`,
  notComputed: "Range and nut advantage are not computed on the flop, turn or river in this version.",
} as const;

const PERCENT = 100;
const POINT_DECIMALS = 1;

export interface AdvantageSeats {
  /** The pair's out-of-position seat, its first position. */
  readonly oop: string;
  readonly ip: string;
}

export interface RangeAdvantageCardProps {
  rangeAdvantage: StudyInsights["range_advantage"];
  nutAdvantage: StudyInsights["nut_advantage"];
  seats: AdvantageSeats;
  /** The seat to act, whose advantage the sentence states. */
  toAct: string;
}

interface SeatBarProps {
  seat: string;
  share: number;
}

function SeatBar({ seat, share }: SeatBarProps) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="w-28 shrink-0 tabular-nums">{`${seat} ${formatShare(share)}`}</span>
      <span aria-hidden="true" className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
        <span data-testid="advantage-bar" style={{ width: `${Math.round(share * PERCENT)}%` }} className="block h-full bg-text/60" />
      </span>
    </li>
  );
}

interface PairProps {
  label: string;
  seats: AdvantageSeats;
  oopShare: number;
  ipShare: number;
}

/** Two bars, out-of-position seat first, grouped under one label. */
function SeatPair({ label, seats, oopShare, ipShare }: PairProps) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1">
      <p id={labelId} className="text-xs font-semibold tracking-wide text-muted uppercase">
        {label}
      </p>
      <ul className="flex flex-col gap-1">
        <SeatBar seat={seats.oop} share={oopShare} />
        <SeatBar seat={seats.ip} share={ipShare} />
      </ul>
    </div>
  );
}

/** "4.0 points": a served difference in percentage points, unsigned. */
function points(value: number): string {
  return `${Math.abs(value).toFixed(POINT_DECIMALS)} points`;
}

/** The to-act sentence from the two served differences. */
function advantageSentence(
  toAct: string,
  range: NonNullable<StudyInsights["range_advantage"]>,
  nuts: StudyInsights["nut_advantage"],
): string {
  const equity = range.to_act_advantage_pct_points;
  const lead = `${toAct}, to act, is ${equity >= 0 ? "ahead" : "behind"} by ${points(equity)} of equity`;
  if (nuts === null) return `${lead}.`;
  const nutPoints = nuts.to_act_advantage * PERCENT;
  return `${lead} and holds ${points(nutPoints)} ${nutPoints >= 0 ? "more" : "less"} of its range in nut hands.`;
}

export function RangeAdvantageCard({ rangeAdvantage, nutAdvantage, seats, toAct }: RangeAdvantageCardProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn("flex min-w-0 flex-col gap-3 rounded-2xl border border-border/50 bg-surface-raised p-4 text-sm", RAISED_CLASS)}
    >
      <h3 id={titleId} className="font-semibold">
        {ADVANTAGE_TEXT.title}
      </h3>
      {rangeAdvantage === null ? (
        <p className="text-muted">{ADVANTAGE_TEXT.notComputed}</p>
      ) : (
        <>
          <SeatPair label={ADVANTAGE_TEXT.equity} seats={seats} oopShare={rangeAdvantage.oop_mean_equity} ipShare={rangeAdvantage.ip_mean_equity} />
          {nutAdvantage === null ? null : (
            <SeatPair
              label={ADVANTAGE_TEXT.nuts(formatShare(nutAdvantage.threshold_equity))}
              seats={seats}
              oopShare={nutAdvantage.oop_share}
              ipShare={nutAdvantage.ip_share}
            />
          )}
          <p>{advantageSentence(toAct, rangeAdvantage, nutAdvantage)}</p>
        </>
      )}
    </section>
  );
}
