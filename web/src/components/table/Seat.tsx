/**
 * One seat at the poker table (S24, R3.13). Shows the position, the stack in big blinds, the
 * current bet, a "D" dealer button marker, an "STR" straddle marker and, for the hero, the word
 * Hero and the hole cards. Markers carry a visually hidden spoken name ("Dealer button",
 * "Straddle"). A folded seat is dimmed and also says "Folded", so dimming is never the only signal.
 */
import { VisuallyHidden, cn } from "../ui/index.js";
import type { Position } from "../../contracts.js";
import { formatCbb } from "../../poker/format.js";
import { CardView } from "./CardView.js";
import type { SeatSpot } from "./seat-layout.js";

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
}

interface SeatProps {
  seat: TableSeat;
  spot: SeatSpot;
  fourColor: boolean;
}

function Marker({ short, name, className }: { short: string; name: string; className: string }) {
  return (
    <span title={name} className={cn("rounded-full px-1.5 text-xs font-bold", className)}>
      <span aria-hidden="true">{short}</span>
      <VisuallyHidden>{name}</VisuallyHidden>
    </span>
  );
}

export function Seat({ seat, spot, fourColor }: SeatProps) {
  return (
    <li
      data-testid={`seat-${seat.position}`}
      data-folded={seat.hasFolded ? "true" : "false"}
      style={{ left: `${spot.leftPercent}%`, top: `${spot.topPercent}%` }}
      className={cn(
        "pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-lg border bg-surface-raised px-2 py-1 text-center text-sm shadow",
        seat.isHero ? "border-accent ring-2 ring-accent" : "border-border",
        seat.hasFolded && "opacity-50",
      )}
    >
      <div className="flex items-center gap-1">
        <span className="font-semibold">{seat.position}</span>
        {seat.isButton ? <Marker short="D" name="Dealer button" className="bg-white text-slate-900 ring-1 ring-slate-400" /> : null}
        {seat.isStraddle ? <Marker short="STR" name="Straddle" className="bg-warning text-white" /> : null}
      </div>
      <span className="tabular-nums">{formatCbb(seat.stackCbb)}</span>
      {seat.isHero ? <span className="text-xs font-semibold text-accent">Hero</span> : null}
      {seat.cards === undefined ? null : (
        <div className="flex gap-0.5">
          <CardView card={seat.cards[0]} size="sm" fourColor={fourColor} />
          <CardView card={seat.cards[1]} size="sm" fourColor={fourColor} />
        </div>
      )}
      {seat.hasFolded ? <span className="text-xs text-muted">Folded</span> : null}
      {seat.betCbb === undefined ? null : <span className="text-xs tabular-nums">Bet {formatCbb(seat.betCbb)}</span>}
    </li>
  );
}
