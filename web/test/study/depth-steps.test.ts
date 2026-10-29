/**
 * Tests for the depth steps at the current line (S45, R3.12, O-467): the covered depths of the
 * address's format, table size and stake for its pair, ascending; the next deeper and the next
 * shallower depth around the current one; a configuration whose pairs have not loaded, or that does
 * not cover the pair, is skipped; and the search a depth step writes keeps the line, hand, lens,
 * mode and filters.
 */
import { describe, expect, it } from "vitest";

import { fixtureConfigs, fixtureOnlineStake } from "./depth-fixtures.js";
import { coveredDepths, depthNeighbours, siblingConfigIds, withDepth } from "../../src/study/depth-steps.js";
import type { PositionPairEntry } from "../../src/study/queries.js";

const SEARCH = { format: "online", table_size: 6, stake: fixtureOnlineStake, depth: 10000, pair: "BB-BTN" } as const;
const covered = (pair: string): readonly PositionPairEntry[] => [{ pair, oop: "BB", ip: "BTN", preflop_available: true }];

describe("R3.12 depth steps at the current line (O-467)", () => {
  it("R3.12 siblingConfigIds lists the configurations of the same format, size and stake by depth", () => {
    expect(siblingConfigIds(fixtureConfigs, SEARCH)).toEqual([
      { depth: 10000, configId: "cfg_6_online_100" },
      { depth: 20000, configId: "cfg_6_online_200" },
      { depth: 30000, configId: "cfg_6_online_300" },
    ]);
  });

  it("R3.12 coveredDepths keeps a depth only when its pairs have loaded and cover the pair", () => {
    const pairsOf = (configId: string) => (configId === "cfg_6_online_300" ? undefined : covered("BB-BTN"));
    expect(coveredDepths(fixtureConfigs, SEARCH, pairsOf)).toEqual([10000, 20000]);
    const uncovered = (configId: string) => (configId === "cfg_6_online_200" ? [{ ...covered("BB-BTN")[0]!, preflop_available: false }] : covered("BB-BTN"));
    expect(coveredDepths(fixtureConfigs, SEARCH, uncovered)).toEqual([10000, 30000]);
  });

  it("R3.12 depthNeighbours gives the next deeper and shallower covered depth, or undefined at the ends", () => {
    expect(depthNeighbours([10000, 20000, 30000], 20000)).toEqual({ deeper: 30000, shallower: 10000 });
    expect(depthNeighbours([10000, 20000], 10000)).toEqual({ deeper: 20000, shallower: undefined });
    expect(depthNeighbours([10000], 10000)).toEqual({ deeper: undefined, shallower: undefined });
    expect(depthNeighbours([], undefined)).toEqual({ deeper: undefined, shallower: undefined });
  });

  it("R3.12 withDepth keeps the line, hand and mode and drops the filters and the lens (code review)", () => {
    const search = { ...SEARCH, line: "r250", hand: "AKs", mode: "compare" as const, lens: 2, filters: "0,2" };
    expect(withDepth(search, 20000)).toEqual({ ...SEARCH, depth: 20000, line: "r250", hand: "AKs", mode: "compare" });
  });
});
