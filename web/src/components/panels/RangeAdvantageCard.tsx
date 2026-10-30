/**
 * The range and nut advantage card (S45, R3.12, O-461, design rule 6: who is ahead is read first).
 *
 * Mechanism: StudyInsights.range_advantage and nut_advantage as solver-query computed them (ADR
 * 0004): each seat's mean equity against the other range, and each seat's share of its range at or
 * above the served nut threshold. Both show as a pair of two-sided bars, out-of-position seat first,
 * each bar as wide as the seat's served share with the seat and the number printed beside it, so
 * colour is never the only signal. Two sentences then say what the served to-act figures mean:
 * to_act_advantage_pct_points is the acting seat's mean equity minus an even split (solver-query
 * ranges.rs), so it reads as points above or below 50 percent, never as a gap between the seats
 * (code review); to_act_advantage is the acting seat's nut share minus the other seat's. Zero reads
 * as neither range ahead. Nothing is subtracted here (ADR 0004): the web picks the acting seat's own
 * mean to print beside the served points. solver-query has no equity
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
  even: "Neither range is ahead.",
  evenNuts: "Both ranges hold the same share of nut hands.",
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

/** "BTN, to act, holds 52.0% range equity, 2.0 points above an even split." from the served figures. */
function equitySentence(toAct: string, seats: AdvantageSeats, range: NonNullable<StudyInsights["range_advantage"]>): string {
  const above = range.to_act_advantage_pct_points;
  if (above === 0) return ADVANTAGE_TEXT.even;
  const ownMean = toAct === seats.ip ? range.ip_mean_equity : range.oop_mean_equity;
  return `${toAct}, to act, holds ${formatShare(ownMean)} range equity, ${points(above)} ${above > 0 ? "above" : "below"} an even split.`;
}

/** "BTN holds 4.0 points more of its range in nut hands than BB." from the served difference. */
function nutSentence(toAct: string, seats: AdvantageSeats, nuts: NonNullable<StudyInsights["nut_advantage"]>): string {
  const lead = nuts.to_act_advantage * PERCENT;
  if (lead === 0) return ADVANTAGE_TEXT.evenNuts;
  const other = toAct === seats.ip ? seats.oop : seats.ip;
  return `${toAct} holds ${points(lead)} ${lead > 0 ? "more" : "less"} of its range in nut hands than ${other}.`;
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
          <p>{equitySentence(toAct, seats, rangeAdvantage)}</p>
          {nutAdvantage === null ? null : <p>{nutSentence(toAct, seats, nutAdvantage)}</p>}
        </>
      )}
    </section>
  );
}
