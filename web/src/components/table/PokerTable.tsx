/**
 * The poker table (S24, A7, R3.13): 6 to 9 seats around an oval felt with the pot in the middle.
 * The root is a group named "Table, 6 seats, pot 1.5bb" so a screen reader hears the table at
 * once; the seats are a list placed on an ellipse by seatLayout with the hero at the bottom. An
 * optional center slot holds the board (BoardReveal) under the pot. A seat count outside 6 to 9
 * renders an alert instead of a broken table. Amounts arrive in centi-big-blinds and are only
 * formatted here (ADR 0004).
 */
import type { ReactNode } from "react";

import { formatCbb } from "../../poker/format.js";
import { Seat, type TableSeat } from "./Seat.js";
import { seatLayout } from "./seat-layout.js";

export const MIN_SEATS = 6;
export const MAX_SEATS = 9;
const CENTER_SPOT = { leftPercent: 50, topPercent: 50 } as const;

export interface PokerTableProps {
  seats: readonly TableSeat[];
  potCbb: number;
  /** Rendered under the pot, for example the board. */
  center?: ReactNode;
  fourColor?: boolean;
}

export function PokerTable({ seats, potCbb, center, fourColor = false }: PokerTableProps) {
  if (seats.length < MIN_SEATS || seats.length > MAX_SEATS) {
    return (
      <p role="alert" data-testid="poker-table" className="rounded border border-danger p-3 text-danger">
        {`A table needs ${MIN_SEATS} to ${MAX_SEATS} seats; got ${seats.length}.`}
      </p>
    );
  }
  const layout = seatLayout(
    seats.length,
    seats.findIndex((seat) => seat.isHero),
  );
  const pot = formatCbb(potCbb);
  return (
    <div
      role="group"
      aria-label={`Table, ${seats.length} seats, pot ${pot}`}
      data-testid="poker-table"
      className="relative mx-auto aspect-[2/1] w-full max-w-4xl"
    >
      <div className="absolute inset-[12%] flex flex-col items-center justify-center gap-2 rounded-[50%] border-8 border-felt-edge bg-felt text-white shadow-inner">
        <span className="rounded bg-black/30 px-2 py-0.5 text-sm font-semibold tabular-nums">Pot {pot}</span>
        {center}
      </div>
      <ul aria-label="Seats" className="pointer-events-none absolute inset-0">
        {seats.map((seat, index) => (
          <Seat key={seat.position} seat={seat} spot={layout[index] ?? CENTER_SPOT} fourColor={fourColor} />
        ))}
      </ul>
    </div>
  );
}
