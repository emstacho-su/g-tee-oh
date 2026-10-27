/**
 * Seat lists and canonical position pairs (R3.2, O-234). The api mirrors gto-model's
 * Position::seated table as naming data, so this test pins the Rust source of truth verbatim and
 * fails on any drift, order included.
 *
 * How the vector was produced (2026-10-27): the S21 lead added a throwaway test to crates/gto-model
 * that printed, for every table size 2 to 9, the seats from Position::seated and the pairs built by
 * PositionPair::new over every two seats (seat i before seat j in seated order), then reverted it.
 * The lines below are that output, unedited.
 */
import { describe, expect, it } from "vitest";

import { canonicalPairs, seatedPositions } from "../src/catalog/seats.js";

const GTO_MODEL_OUTPUT = `
SEATS 2 BTN,BB
PAIRS 2 BB-BTN
SEATS 3 BTN,SB,BB
PAIRS 3 SB-BTN,BB-BTN,SB-BB
SEATS 4 CO,BTN,SB,BB
PAIRS 4 CO-BTN,SB-CO,BB-CO,SB-BTN,BB-BTN,SB-BB
SEATS 5 HJ,CO,BTN,SB,BB
PAIRS 5 HJ-CO,HJ-BTN,SB-HJ,BB-HJ,CO-BTN,SB-CO,BB-CO,SB-BTN,BB-BTN,SB-BB
SEATS 6 UTG,HJ,CO,BTN,SB,BB
PAIRS 6 UTG-HJ,UTG-CO,UTG-BTN,SB-UTG,BB-UTG,HJ-CO,HJ-BTN,SB-HJ,BB-HJ,CO-BTN,SB-CO,BB-CO,SB-BTN,BB-BTN,SB-BB
SEATS 7 UTG,LJ,HJ,CO,BTN,SB,BB
PAIRS 7 UTG-LJ,UTG-HJ,UTG-CO,UTG-BTN,SB-UTG,BB-UTG,LJ-HJ,LJ-CO,LJ-BTN,SB-LJ,BB-LJ,HJ-CO,HJ-BTN,SB-HJ,BB-HJ,CO-BTN,SB-CO,BB-CO,SB-BTN,BB-BTN,SB-BB
SEATS 8 UTG,UTG1,LJ,HJ,CO,BTN,SB,BB
PAIRS 8 UTG-UTG1,UTG-LJ,UTG-HJ,UTG-CO,UTG-BTN,SB-UTG,BB-UTG,UTG1-LJ,UTG1-HJ,UTG1-CO,UTG1-BTN,SB-UTG1,BB-UTG1,LJ-HJ,LJ-CO,LJ-BTN,SB-LJ,BB-LJ,HJ-CO,HJ-BTN,SB-HJ,BB-HJ,CO-BTN,SB-CO,BB-CO,SB-BTN,BB-BTN,SB-BB
SEATS 9 UTG,UTG1,UTG2,LJ,HJ,CO,BTN,SB,BB
PAIRS 9 UTG-UTG1,UTG-UTG2,UTG-LJ,UTG-HJ,UTG-CO,UTG-BTN,SB-UTG,BB-UTG,UTG1-UTG2,UTG1-LJ,UTG1-HJ,UTG1-CO,UTG1-BTN,SB-UTG1,BB-UTG1,UTG2-LJ,UTG2-HJ,UTG2-CO,UTG2-BTN,SB-UTG2,BB-UTG2,LJ-HJ,LJ-CO,LJ-BTN,SB-LJ,BB-LJ,HJ-CO,HJ-BTN,SB-HJ,BB-HJ,CO-BTN,SB-CO,BB-CO,SB-BTN,BB-BTN,SB-BB
`;

const TABLE_SIZES = [2, 3, 4, 5, 6, 7, 8, 9] as const;

/** The comma list on the line "<kind> <size> <list>" of the pinned output. */
function pinned(kind: "SEATS" | "PAIRS", size: number): string[] {
  const prefix = `${kind} ${size} `;
  const line = GTO_MODEL_OUTPUT.split("\n").find((candidate) => candidate.startsWith(prefix));
  if (line === undefined) {
    throw new Error(`the pinned output has no ${kind} line for size ${size}`);
  }
  return line.slice(prefix.length).split(",");
}

describe("R3.2 seat lists mirror gto-model (O-234)", () => {
  it.each(TABLE_SIZES)("R3.2 the seats at table size %i equal Position::seated, in order", (size) => {
    expect([...seatedPositions(size)]).toEqual(pinned("SEATS", size));
  });

  it.each(TABLE_SIZES)("R3.2 the pairs at table size %i equal PositionPair::new over every two seats, in order", (size) => {
    expect(canonicalPairs(size).map((entry) => entry.pair)).toEqual(pinned("PAIRS", size));
  });

  it("R3.2 each pair names its out-of-position seat first and splits into oop and ip", () => {
    for (const size of TABLE_SIZES) {
      for (const entry of canonicalPairs(size)) {
        expect(entry.pair).toBe(`${entry.oop}-${entry.ip}`);
      }
    }
  });

  it("R3.2 a table size outside 2 to 9 is rejected", () => {
    expect(() => seatedPositions(1)).toThrow(RangeError);
    expect(() => seatedPositions(10)).toThrow(RangeError);
    expect(() => canonicalPairs(10)).toThrow(RangeError);
  });
});
