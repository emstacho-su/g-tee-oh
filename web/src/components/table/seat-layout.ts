/**
 * Seat-card layouts of the game-style table (S24, S38, R3.13, O-380). Pure.
 *
 * Mechanism: the table is a box of seat cards around a felt tabletop, laid out twice: landscape
 * (a 16 by 9 box) and portrait (a 4 by 5 box for a phone). Each layout is an explicit slot table
 * per seat count (6 to 9), slot 0 at the bottom centre and the others clockwise: up the left
 * side, across the top and down the right side. Slots are card centres in percent of the box,
 * each with the card's box size, so the arrangement is designed rather than computed on an
 * ellipse, and a test proves no two cards overlap each other or the felt. seatLayout rotates the
 * slots so the hero (or, with no hero, the first seat) takes slot 0, and gives each seat a bet
 * spot where its action chip lands: in landscape part way along the line from its card to the
 * felt's centre, in portrait a designed spot clear of the board, the cards and the other chips.
 * PokerTable passes both layouts to CSS and a container query on the table's own width picks one
 * (PORTRAIT_BELOW_PX), so no script measures the screen.
 */
export type TableOrientation = "landscape" | "portrait";

export const TABLE_ORIENTATIONS: readonly TableOrientation[] = ["landscape", "portrait"];

/** Below this table width the portrait layout applies (O-380); styles.css holds the same number. */
export const PORTRAIT_BELOW_PX = 600;

export interface SeatSpot {
  readonly leftPercent: number;
  readonly topPercent: number;
}

export interface SeatBox {
  readonly widthPercent: number;
  readonly heightPercent: number;
}

export interface SeatSlot {
  /** The card's centre. */
  readonly seat: SeatSpot;
  /** Where the seat's action chip lands, between the card and the felt's centre. */
  readonly bet: SeatSpot;
  /** The card's largest footprint. */
  readonly box: SeatBox;
}

/** The felt tabletop's insets from each edge of the box, in percent. */
export interface FeltBox {
  readonly leftPercent: number;
  readonly rightPercent: number;
  readonly topPercent: number;
  readonly bottomPercent: number;
}

export const MIN_LAYOUT_SEATS = 6;
export const MAX_LAYOUT_SEATS = 9;

export const FELT_BOXES: Readonly<Record<TableOrientation, FeltBox>> = {
  landscape: { leftPercent: 26, rightPercent: 26, topPercent: 28, bottomPercent: 38 },
  portrait: { leftPercent: 30, rightPercent: 30, topPercent: 22, bottomPercent: 32 },
};

/** The bottom slot's card (the hero's, with the hole cards) and every other card. */
const SEAT_BOXES: Readonly<Record<TableOrientation, { readonly bottom: SeatBox; readonly other: SeatBox }>> = {
  landscape: { bottom: { widthPercent: 18, heightPercent: 30 }, other: { widthPercent: 16, heightPercent: 24 } },
  portrait: { bottom: { widthPercent: 34, heightPercent: 22 }, other: { widthPercent: 28, heightPercent: 16 } },
};

/** How far along the line from a card to the felt's centre its bet spot sits, in landscape. */
const BET_SPOT_SHARE = { landscape: 0.55 } as const;

export interface TableBand {
  readonly topPercent: number;
  readonly bottomPercent: number;
}

/**
 * The rows the board and the pot line take on the portrait felt, in percent of the box (S46, critic
 * round 3): PokerTable centres them on the felt, and the band is sized for the narrowest phone,
 * where they take the largest share of the height. Portrait bet chips sit on a row above or below
 * it (PORTRAIT_BETS), so no chip ever covers a community card, before or after the flop.
 */
export const PORTRAIT_BOARD_BAND: TableBand = { topPercent: 34, bottomPercent: 56 };

type Slot = readonly [left: number, top: number];

/** Half an action chip's height on the portrait table, in percent of the box, at the narrowest phone. */
export const BET_CHIP_HALF_HEIGHT_PERCENT = 3;
/** Half an action chip's width there: an amount such as "2.5bb" with its dot, at a 360 px phone. */
export const BET_CHIP_HALF_WIDTH_PERCENT = 9;

const PORTRAIT_FELT = FELT_BOXES.portrait;
const CHIP_H = BET_CHIP_HALF_HEIGHT_PERCENT;
const CHIP_W = BET_CHIP_HALF_WIDTH_PERCENT;

/** The portrait bet columns: against the felt's left edge, at its centre, against its right edge. */
const PORTRAIT_BET_COLUMNS = {
  left: PORTRAIT_FELT.leftPercent + CHIP_W,
  centre: (PORTRAIT_FELT.leftPercent + (100 - PORTRAIT_FELT.rightPercent)) / 2,
  right: 100 - PORTRAIT_FELT.rightPercent - CHIP_W,
} as const;

/**
 * The portrait bet rows, each a chip's height apart so no two chips overlap: two between the
 * felt's top and the board band, two between the band and the felt's bottom, and the hero's on the
 * rim under the felt, above the hero's card.
 */
const PORTRAIT_BET_ROWS = {
  outerAbove: PORTRAIT_FELT.topPercent + CHIP_H,
  innerAbove: PORTRAIT_BOARD_BAND.topPercent - CHIP_H,
  innerBelow: PORTRAIT_BOARD_BAND.bottomPercent + CHIP_H,
  outerBelow: PORTRAIT_BOARD_BAND.bottomPercent + 3 * CHIP_H,
  hero: 100 - PORTRAIT_FELT.bottomPercent + CHIP_H,
} as const;

const { left: L, centre: C, right: R } = PORTRAIT_BET_COLUMNS;
const { outerAbove: OA, innerAbove: IA, innerBelow: IB, outerBelow: OB, hero: H } = PORTRAIT_BET_ROWS;

/**
 * The portrait bet spots per seat count, in the order of SLOTS.portrait (S46, critic round 3,
 * PR #50 review): designed like the cards, each seat on its own side of the board in its own
 * column and row, so no chip covers the board, a card or another chip, before or after the flop.
 */
const PORTRAIT_BETS: Readonly<Record<number, readonly Slot[]>> = {
  6: [[C, H], [L, IB], [L, IA], [C, OA], [R, IA], [R, IB]],
  7: [[C, H], [L, IB], [L, IA], [L, OA], [R, OA], [R, IA], [R, IB]],
  8: [[C, H], [L, OB], [L, IB], [L, IA], [C, OA], [R, IA], [R, IB], [R, OB]],
  9: [[C, H], [L, OB], [L, IB], [L, IA], [L, OA], [R, OA], [R, IA], [R, IB], [R, OB]],
};

/** Card centres per seat count, slot 0 (bottom centre) first, then clockwise on screen. */
const SLOTS: Readonly<Record<TableOrientation, Readonly<Record<number, readonly Slot[]>>>> = {
  landscape: {
    6: [[50, 84], [14, 70], [14, 26], [50, 14], [86, 26], [86, 70]],
    7: [[50, 84], [14, 72], [14, 30], [36, 12], [64, 12], [86, 30], [86, 72]],
    8: [[50, 84], [27, 80], [10, 50], [22, 14], [50, 12], [78, 14], [90, 50], [73, 80]],
    9: [[50, 84], [27, 80], [10, 56], [10, 24], [33, 12], [67, 12], [90, 24], [90, 56], [73, 80]],
  },
  portrait: {
    6: [[50, 88], [15, 72], [15, 36], [50, 10], [85, 36], [85, 72]],
    7: [[50, 88], [15, 70], [15, 40], [34, 10], [66, 10], [85, 40], [85, 70]],
    8: [[50, 88], [15, 74], [15, 50], [15, 26], [50, 9], [85, 26], [85, 50], [85, 74]],
    9: [[50, 88], [15, 76], [15, 52], [15, 28], [34, 9], [66, 9], [85, 28], [85, 52], [85, 76]],
  },
};

/** The felt's centre, where the bet lines point. */
export function feltCentre(orientation: TableOrientation): SeatSpot {
  const felt = FELT_BOXES[orientation];
  return {
    leftPercent: (felt.leftPercent + (100 - felt.rightPercent)) / 2,
    topPercent: (felt.topPercent + (100 - felt.bottomPercent)) / 2,
  };
}

/** The landscape bet spot, part way along the line from the card to the felt's centre. */
function landscapeBet([left, top]: Slot): SeatSpot {
  const centre = feltCentre("landscape");
  const share = BET_SPOT_SHARE.landscape;
  return { leftPercent: left + share * (centre.leftPercent - left), topPercent: top + share * (centre.topPercent - top) };
}

function slotAt(slot: Slot, bet: SeatSpot, isBottom: boolean, orientation: TableOrientation): SeatSlot {
  const [left, top] = slot;
  return {
    seat: { leftPercent: left, topPercent: top },
    bet,
    box: isBottom ? SEAT_BOXES[orientation].bottom : SEAT_BOXES[orientation].other,
  };
}

/** The bet spot of a slot: the designed portrait spot, or the landscape line's. */
function betAt(slot: Slot, step: number, count: number, orientation: TableOrientation): SeatSpot {
  if (orientation === "landscape") return landscapeBet(slot);
  const designed = PORTRAIT_BETS[count]?.[step];
  if (designed === undefined) throw new RangeError(`seatLayout: no portrait bet spot ${step} for ${count} seats`);
  return { leftPercent: designed[0], topPercent: designed[1] };
}

/**
 * One slot per seat, in seat order: the hero (or the first seat, without a hero) at the bottom
 * centre and the seats after it clockwise. A count outside 6 to 9 throws a RangeError, since
 * PokerTable renders its own alert for such a table and a guessed layout would hide the fault.
 */
export function seatLayout(count: number, heroIndex: number, orientation: TableOrientation): SeatSlot[] {
  const slots = SLOTS[orientation][count];
  if (slots === undefined) {
    throw new RangeError(`seatLayout: ${count} seats; the table lays out ${MIN_LAYOUT_SEATS} to ${MAX_LAYOUT_SEATS}`);
  }
  const anchor = heroIndex >= 0 && heroIndex < count ? heroIndex : 0;
  return Array.from({ length: count }, (_, index) => {
    const step = (index - anchor + count) % count;
    const slot = slots[step];
    if (slot === undefined) throw new RangeError(`seatLayout: no slot ${step} for ${count} seats`);
    return slotAt(slot, betAt(slot, step, count, orientation), step === 0, orientation);
  });
}
