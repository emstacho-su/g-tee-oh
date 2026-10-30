/**
 * Tests for the pot type of a walked line (S45, R3.12, screen critic): the label names the pot from
 * the line's action tokens only (no numbers, so it stays in the web): none at the root or with only
 * folds, a limped pot, a single-raised pot, a three-bet, four-bet or N-bet pot by the count of
 * raises, and a squeeze when the second raise follows a raise and a call. The spot summary carries
 * it as its last part.
 */
import { describe, expect, it } from "vitest";

import { fixtureStakes } from "../../src/fixtures/study.js";
import { potTypeLabel } from "../../src/study/pot-type.js";
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
    ["r250.a", "three-bet pot"],
  ])("R3.12 %s is %s", (line, label) => {
    expect(potTypeLabel(line)).toBe(label);
  });

  it("R3.12 the summary ends with the pot type past the root and leaves it out at the root", () => {
    const search = { format: "online", table_size: 6, stake: "00000000-0000-4000-8000-0000000000a1", depth: 10000, pair: "BB-BTN" } as const;
    expect(settingsSummary(fixtureStakes, search)).toBe("Online, 6 players, online (5% rake, cap $1.50), 100bb, BTN against BB");
    expect(settingsSummary(fixtureStakes, { ...search, line: "r250.r1100" })).toBe(
      "Online, 6 players, online (5% rake, cap $1.50), 100bb, BTN against BB, three-bet pot",
    );
  });
});
