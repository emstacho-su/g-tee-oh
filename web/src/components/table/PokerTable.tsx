/**
 * The game-style poker table (S24, S38, R3.13, O-380, O-381): 6 to 9 seat cards around a felt
 * tabletop with the pot and an optional center slot (the board, BoardReveal).
 *
 * Mechanism: seatLayout gives every seat a slot in the landscape and in the portrait layout; the
 * seat cards, the felt and the action chips carry both as custom properties, and the container
 * query in styles.css (the "poker-table" container, PORTRAIT_BELOW_PX) picks the portrait spots,
 * the 4 by 5 box and the compact card when the table itself is narrow, so a phone or a narrow
 * column gets the portrait table without any script measuring it. Chips sit at their seat's bet
 * spot; a moving chip slides there from the seat over its step's duration (none under reduced
 * motion). The root is a group named "Table, 6 seats, pot 1.5bb" so a screen reader hears the
 * table at once; the seats are a list; chips are decoration (aria-hidden) because the seat badges
 * and SpotTable's action log carry the words. A seat count outside 6 to 9 renders an alert
 * instead of a broken table. Amounts arrive in centi-big-blinds and are only formatted here
 * (ADR 0004). No z-index: the chips come after the felt in document order.
 */
import type { CSSProperties, ReactNode } from "react";

import { formatCbb } from "../../poker/format.js";
import { Seat, seatSpotStyle, type SeatSlots, type TableSeat } from "./Seat.js";
import { FELT_BOXES, MAX_LAYOUT_SEATS, MIN_LAYOUT_SEATS, seatLayout, type FeltBox } from "./seat-layout.js";

export const MIN_SEATS = MIN_LAYOUT_SEATS;
export const MAX_SEATS = MAX_LAYOUT_SEATS;

export interface PokerTableProps {
  seats: readonly TableSeat[];
  potCbb: number;
  /** Rendered on the felt under the pot, for example the board. */
  center?: ReactNode;
  fourColor?: boolean;
  /** True while actions replay; exposed as data-replaying. */
  replaying?: boolean;
  /** A click anywhere on the table, for example to finish a replay. */
  onClick?: () => void;
}

const percent = (value: number): string => `${value}%`;

function feltStyle(landscape: FeltBox, portrait: FeltBox): CSSProperties {
  return {
    "--land-felt-l": percent(landscape.leftPercent),
    "--land-felt-r": percent(landscape.rightPercent),
    "--land-felt-t": percent(landscape.topPercent),
    "--land-felt-b": percent(landscape.bottomPercent),
    "--port-felt-l": percent(portrait.leftPercent),
    "--port-felt-r": percent(portrait.rightPercent),
    "--port-felt-t": percent(portrait.topPercent),
    "--port-felt-b": percent(portrait.bottomPercent),
  } as CSSProperties;
}

function chipStyle(slots: SeatSlots, durationMs: number): CSSProperties {
  return {
    ...seatSpotStyle(slots),
    "--land-bet-x": percent(slots.landscape.bet.leftPercent),
    "--land-bet-y": percent(slots.landscape.bet.topPercent),
    "--port-bet-x": percent(slots.portrait.bet.leftPercent),
    "--port-bet-y": percent(slots.portrait.bet.topPercent),
    "--chip-ms": `${Math.round(durationMs)}ms`,
  } as CSSProperties;
}

function ActionChip({ seat, slots }: { seat: TableSeat; slots: SeatSlots }) {
  if (seat.chip === undefined) return null;
  return (
    <span
      aria-hidden="true"
      data-testid={`chip-${seat.position}`}
      data-moving={seat.chip.moving ? "true" : "false"}
      style={chipStyle(slots, seat.chip.durationMs)}
      className="table-chip inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-border-strong bg-surface-raised px-2 py-0.5 text-xs font-semibold text-text shadow"
    >
      <span className="inline-block h-2.5 w-2.5 rounded-full border border-black/30 bg-warning" />
      {seat.chip.label}
    </span>
  );
}

export function PokerTable({ seats, potCbb, center, fourColor = false, replaying = false, onClick }: PokerTableProps) {
  if (seats.length < MIN_SEATS || seats.length > MAX_SEATS) {
    return (
      <p role="alert" data-testid="poker-table" className="rounded border border-danger p-3 text-danger">
        {`A table needs ${MIN_SEATS} to ${MAX_SEATS} seats; got ${seats.length}.`}
      </p>
    );
  }
  const heroIndex = seats.findIndex((seat) => seat.isHero);
  const landscape = seatLayout(seats.length, heroIndex, "landscape");
  const portrait = seatLayout(seats.length, heroIndex, "portrait");
  const slotsOf = (index: number): SeatSlots | null => {
    const land = landscape[index];
    const port = portrait[index];
    return land === undefined || port === undefined ? null : { landscape: land, portrait: port };
  };
  const pot = formatCbb(potCbb);
  return (
    <div
      role="group"
      aria-label={`Table, ${seats.length} seats, pot ${pot}`}
      data-testid="poker-table"
      data-replaying={replaying ? "true" : "false"}
      onClick={onClick}
      className="poker-table mx-auto w-full max-w-4xl"
    >
      <div className="table-box relative w-full" style={feltStyle(FELT_BOXES.landscape, FELT_BOXES.portrait)}>
        <div
          data-testid="table-felt"
          className="table-felt absolute flex flex-col items-center justify-center gap-2 rounded-[2rem] border-8 border-felt-edge bg-felt text-white shadow-inner"
        >
          <span className="rounded bg-black/30 px-2 py-0.5 text-sm font-semibold tabular-nums">Pot {pot}</span>
          {center === undefined ? null : <div className="table-center flex max-w-full justify-center px-1">{center}</div>}
        </div>
        <ul aria-label="Seats" className="absolute inset-0">
          {seats.map((seat, index) => {
            const slots = slotsOf(index);
            return slots === null ? null : <Seat key={seat.position} seat={seat} slots={slots} fourColor={fourColor} />;
          })}
        </ul>
        <div className="pointer-events-none absolute inset-0">
          {seats.map((seat, index) => {
            const slots = slotsOf(index);
            return slots === null ? null : <ActionChip key={seat.position} seat={seat} slots={slots} />;
          })}
        </div>
      </div>
    </div>
  );
}
