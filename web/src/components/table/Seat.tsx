/**
 * One seat card at the game-style table (S24, S38, R3.13, O-380, O-381). A raised card with the
 * position, the stack in big blinds, a "D" dealer button marker, an "STR" straddle marker, the
 * seat's last action as a badge, the current bet when given and, for the hero, the word You, an
 * accent mark and the hole cards. Markers carry a visually hidden spoken name ("Dealer button",
 * "Straddle"). A folded seat is dimmed and also says "Folded", so dimming is never the only
 * signal; the seat whose action is playing is marked active (the focus mark and a small lift, no
 * lift under reduced motion). The marks are outlines 2 px off the card (S43 review round 2): a
 * Tailwind ring is a box-shadow, which the raised card's own shadow replaced, so it never painted.
 * Seats never overlap the felt, so a mark always sits on the page ground. The card carries both layouts' spots as custom properties and the
 * container query in styles.css picks one (seat-layout.ts).
 */
import type { CSSProperties } from "react";

import { RAISED_CLASS, VisuallyHidden, cn } from "../ui/index.js";
import type { Position } from "../../contracts.js";
import { formatCbb } from "../../poker/format.js";
import { CardView } from "./CardView.js";
import type { SeatSlot } from "./seat-layout.js";

/** The hero's mark: the accent outline, 2 px off the card so the raised shadow stays (O-432). */
export const HERO_MARK_CLASS = "outline-2 outline-offset-2 outline-accent";
/** The acting seat's mark: the focus outline, apart from the hero's accent (O-432). */
export const ACTING_MARK_CLASS = "outline-2 outline-offset-2 outline-focus";

/** An action chip at the seat's bet spot; moving while its step plays. */
export interface SeatChip {
  /** The api's history label, never a computed amount (ADR 0004). */
  label: string;
  moving: boolean;
  durationMs: number;
}

export interface TableSeat {
  position: Position;
  stackCbb: number;
  betCbb?: number;
  isHero: boolean;
  hasFolded: boolean;
  isButton: boolean;
  isStraddle: boolean;
  /** The hero's two hole cards; other seats show none. */
  cards?: readonly [string, string];
  /** The seat's last action label, shown as a badge. */
  lastAction?: string;
  /** True while this seat's action plays. */
  active?: boolean;
  chip?: SeatChip;
}

export interface SeatSlots {
  readonly landscape: SeatSlot;
  readonly portrait: SeatSlot;
}

interface SeatProps {
  seat: TableSeat;
  slots: SeatSlots;
  fourColor: boolean;
}

const percent = (value: number): string => `${value}%`;

/** The seat's spots in both layouts, as the custom properties styles.css reads. */
export function seatSpotStyle({ landscape, portrait }: SeatSlots): CSSProperties {
  return {
    "--land-x": percent(landscape.seat.leftPercent),
    "--land-y": percent(landscape.seat.topPercent),
    "--port-x": percent(portrait.seat.leftPercent),
    "--port-y": percent(portrait.seat.topPercent),
    "--land-w": percent(landscape.box.widthPercent),
    "--port-w": percent(portrait.box.widthPercent),
  } as CSSProperties;
}

function Marker({ short, name, className }: { short: string; name: string; className: string }) {
  return (
    <span title={name} className={cn("rounded-full px-1.5 text-xs font-bold", className)}>
      <span aria-hidden="true">{short}</span>
      <VisuallyHidden>{name}</VisuallyHidden>
    </span>
  );
}

function Badge({ seat }: { seat: TableSeat }) {
  if (seat.hasFolded) {
    return (
      <span data-testid="seat-action" className="table-seat-badge text-xs text-muted">
        Folded
      </span>
    );
  }
  if (seat.lastAction === undefined) return null;
  return (
    <span data-testid="seat-action" className="table-seat-badge whitespace-nowrap rounded-full bg-surface-sunken px-2 text-xs font-semibold">
      {seat.lastAction}
    </span>
  );
}

export function Seat({ seat, slots, fourColor }: SeatProps) {
  const active = seat.active === true;
  return (
    <li
      data-testid={`seat-${seat.position}`}
      data-folded={seat.hasFolded ? "true" : "false"}
      data-active={active ? "true" : "false"}
      data-hero={seat.isHero ? "true" : "false"}
      style={seatSpotStyle(slots)}
      className={cn(
        "table-seat flex flex-col items-center gap-0.5 rounded-xl border bg-surface-raised px-2 py-1.5 text-center text-sm",
        RAISED_CLASS,
        seat.isHero ? "border-accent" : "border-border",
        // One mark per seat: the acting seat's focus mark wins over the hero's accent mark (O-432).
        active ? cn("table-seat-active", ACTING_MARK_CLASS) : seat.isHero && HERO_MARK_CLASS,
        seat.hasFolded && "opacity-50",
      )}
    >
      <div className="flex items-center gap-1">
        <span className="font-semibold">{seat.position}</span>
        {seat.isButton ? <Marker short="D" name="Dealer button" className="bg-white text-slate-900 ring-1 ring-slate-400" /> : null}
        {seat.isStraddle ? <Marker short="STR" name="Straddle" className="bg-warning text-white" /> : null}
        {seat.isHero ? <span className="text-xs font-semibold text-accent">You</span> : null}
      </div>
      <span className="tabular-nums">{formatCbb(seat.stackCbb)}</span>
      {seat.cards === undefined ? null : (
        <div className="flex gap-0.5">
          <CardView card={seat.cards[0]} size="sm" fourColor={fourColor} />
          <CardView card={seat.cards[1]} size="sm" fourColor={fourColor} />
        </div>
      )}
      <Badge seat={seat} />
      {seat.betCbb === undefined ? null : <span className="text-xs tabular-nums">Bet {formatCbb(seat.betCbb)}</span>}
    </li>
  );
}
