/**
 * Tests for the pot type of a walked line (S45, R3.12, screen critic): the label names the pot from
 * the line's action tokens only (no numbers, so it stays in the web): none at the root or with only
 * folds, a limped pot, a single-raised pot, a three-bet, four-bet or N-bet pot by the count of
 * raises, and a squeeze when the second raise follows a raise and a call. The spot summary carries
 * it as its last part.
 */
import { describe, expect, it } from "vitest";

import { fixtureStakes } from "../../src/fixtures/study.js";
import { potTypeLabel, preflopLine } from "../../src/study/pot-type.js";
import { settingsSummary } from "../../src/study/settings.js";

describe("R3.12 the pot type of a line", () => {
  it.each([
    [undefined, undefined],
    ["", undefined],
    ["f.f.f", undefined],
    ["f.l", "limped pot"],
    ["l.c", "limped pot"],
    ["r250", "single-raised pot"],
    ["f.f.r250.c", "single-raised pot"],
    ["l.r400", "single-raised pot"],
    ["r250.r1100", "three-bet pot"],
    ["r250.f.r1100", "three-bet pot"],
    ["r250.c.r1300", "squeeze pot"],
    ["r250.r1100.r2400", "four-bet pot"],
    ["r250.c.r1300.r3000", "four-bet pot"],
    ["r250.r1100.r2400.r5000", "5-bet pot"],
    // An all-in is never counted as a raise: the web cannot tell one for less from a raise (code review 2).
    ["r250.a", "all-in pot"],
    ["a", "all-in pot"],
    ["r250.r1100.a.c", "all-in pot"],
  ])("R3.12 %s is %s", (line, label) => {
    expect(potTypeLabel(line)).toBe(label);
  });

  it("R3.12 preflopLine keeps the tokens taken at preflop nodes, so a postflop token is never counted (code review 2)", () => {
    const streets = (...list: ("preflop" | "flop" | "turn" | "river")[]) => list.map((street) => ({ street }));
    expect(preflopLine("r250.c.x.b300", streets("preflop", "preflop", "flop", "flop"))).toBe("r250.c");
    expect(preflopLine("r250.r1100", streets("preflop", "preflop"))).toBe("r250.r1100");
    expect(preflopLine("r250.c.b300", streets("preflop", "preflop", "flop"))).toBe("r250.c");
    expect(preflopLine(undefined, [])).toBeUndefined();
    expect(potTypeLabel(preflopLine("r250.c.b300.r900", streets("preflop", "preflop", "flop", "flop")))).toBe("single-raised pot");
  });

  it("R3.12 the summary ends with the pot type past the root and leaves it out at the root", () => {
    const search = { format: "online", table_size: 6, stake: "00000000-0000-4000-8000-0000000000a1", depth: 10000, pair: "BB-BTN" } as const;
    expect(settingsSummary(fixtureStakes, search)).toBe("Online, 6 players, online (5% rake, cap $1.50), 100bb, BTN against BB");
    expect(settingsSummary(fixtureStakes, { ...search, line: "r250.r1100" })).toBe(
      "Online, 6 players, online (5% rake, cap $1.50), 100bb, BTN against BB, three-bet pot",
    );
  });
});
