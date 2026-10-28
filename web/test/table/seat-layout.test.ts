/**
 * Tests for the seat-card layouts of the game-style table (S38, R3.13, O-380): explicit slot
 * tables for 6 to 9 seats in a landscape and a portrait box, the hero at the bottom centre, the
 * other seats clockwise, no two seat cards overlapping each other or the felt, every card inside
 * the box, and each seat's bet spot on the line between the seat and the felt's centre.
 */
import { describe, expect, it } from "vitest";

import {
  FELT_BOXES,
  PORTRAIT_BELOW_PX,
  TABLE_ORIENTATIONS,
  feltCentre,
  seatLayout,
  type SeatSlot,
  type TableOrientation,
} from "../../src/components/table/seat-layout.js";

const COUNTS = [6, 7, 8, 9] as const;
const EPSILON = 1e-9;

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function rectOf(slot: SeatSlot): Rect {
  const halfW = slot.box.widthPercent / 2;
  const halfH = slot.box.heightPercent / 2;
  return {
    left: slot.seat.leftPercent - halfW,
    right: slot.seat.leftPercent + halfW,
    top: slot.seat.topPercent - halfH,
    bottom: slot.seat.topPercent + halfH,
  };
}

function overlaps(first: Rect, second: Rect): boolean {
  return first.left < second.right && second.left < first.right && first.top < second.bottom && second.top < first.bottom;
}

function feltRect(orientation: TableOrientation): Rect {
  const felt = FELT_BOXES[orientation];
  return { left: felt.leftPercent, right: 100 - felt.rightPercent, top: felt.topPercent, bottom: 100 - felt.bottomPercent };
}

/** The clockwise screen angle of a point around the felt centre, from the bottom, in 0 to 2 pi. */
function clockwiseFromBottom(slot: SeatSlot, orientation: TableOrientation): number {
  const centre = feltCentre(orientation);
  const angle = Math.atan2(slot.seat.topPercent - centre.topPercent, slot.seat.leftPercent - centre.leftPercent);
  // Screen y grows downwards, so atan2 grows clockwise; the bottom is pi / 2.
  return (angle - Math.PI / 2 + 4 * Math.PI) % (2 * Math.PI);
}

describe("R3.13 seatLayout", () => {
  it("R3.13 the portrait switch is the table's own width below 600 px (O-380)", () => {
    expect(PORTRAIT_BELOW_PX).toBe(600);
    expect(TABLE_ORIENTATIONS).toEqual(["landscape", "portrait"]);
  });

  for (const orientation of TABLE_ORIENTATIONS) {
    for (const count of COUNTS) {
      it(`R3.13 ${orientation}, ${count} seats: the hero sits at the bottom centre`, () => {
        for (let hero = 0; hero < count; hero += 1) {
          const layout = seatLayout(count, hero, orientation);
          expect(layout).toHaveLength(count);
          const heroSlot = layout[hero]!;
          expect(heroSlot.seat.leftPercent).toBeCloseTo(50);
          for (const other of layout) expect(heroSlot.seat.topPercent).toBeGreaterThanOrEqual(other.seat.topPercent);
        }
      });

      it(`R3.13 ${orientation}, ${count} seats: the seats follow the table clockwise from the hero`, () => {
        const hero = 2;
        const layout = seatLayout(count, hero, orientation);
        const angles = Array.from({ length: count }, (_, step) => clockwiseFromBottom(layout[(hero + step) % count]!, orientation));
        for (let step = 1; step < count; step += 1) expect(angles[step]!).toBeGreaterThan(angles[step - 1]! - EPSILON);
      });

      it(`R3.13 ${orientation}, ${count} seats: no two seat cards overlap, none covers the felt, all stay inside the box`, () => {
        const layout = seatLayout(count, 0, orientation);
        const rects = layout.map(rectOf);
        const felt = feltRect(orientation);
        rects.forEach((rect, index) => {
          expect(rect.left).toBeGreaterThanOrEqual(0);
          expect(rect.right).toBeLessThanOrEqual(100);
          expect(rect.top).toBeGreaterThanOrEqual(0);
          expect(rect.bottom).toBeLessThanOrEqual(100);
          expect(overlaps(rect, felt), `seat ${index} covers the felt`).toBe(false);
          rects.slice(index + 1).forEach((other, offset) => {
            expect(overlaps(rect, other), `seats ${index} and ${index + offset + 1} overlap`).toBe(false);
          });
        });
      });

      it(`R3.13 ${orientation}, ${count} seats: each bet spot lies between its seat and the felt centre`, () => {
        const centre = feltCentre(orientation);
        for (const slot of seatLayout(count, 1, orientation)) {
          const dx = centre.leftPercent - slot.seat.leftPercent;
          const dy = centre.topPercent - slot.seat.topPercent;
          const along = Math.abs(dx) >= Math.abs(dy)
            ? (slot.bet.leftPercent - slot.seat.leftPercent) / dx
            : (slot.bet.topPercent - slot.seat.topPercent) / dy;
          expect(along).toBeGreaterThan(0);
          expect(along).toBeLessThan(1);
          expect(slot.bet.leftPercent).toBeCloseTo(slot.seat.leftPercent + along * dx);
          expect(slot.bet.topPercent).toBeCloseTo(slot.seat.topPercent + along * dy);
        }
      });
    }
  }

  it("R3.13 without a hero the first seat takes the bottom slot", () => {
    const layout = seatLayout(7, -1, "landscape");
    expect(layout[0]?.seat.leftPercent).toBeCloseTo(50);
    expect(layout[0]?.seat.topPercent).toBeGreaterThan(80);
  });

  it("R3.13 a seat count outside 6 to 9 is a RangeError, never a guessed layout", () => {
    expect(() => seatLayout(5, 0, "landscape")).toThrow(RangeError);
    expect(() => seatLayout(10, 0, "portrait")).toThrow(RangeError);
  });
});
