/**
 * The streak rules, the cosmetic catalog and the local calendar (R4.14, O-278, O-279, O-247), pure:
 * day counting, freezes (2 per Monday week, bridging without adding), the 48-hour repair of a missed
 * day by two minimum days, milestones, and local midnights across a daylight saving change.
 */
import { describe, expect, it } from "vitest";

import { addDays, localDay, mondayOf, monthOf, nextMonth, previousMonth, startOfDay } from "../src/streaks/calendar.js";
import { nextStreakMilestone, streakCosmetics, tierCosmetics } from "../src/streaks/cosmetics.js";
import { computeStreak, FREEZES_PER_WEEK, REPAIR_NEEDED } from "../src/streaks/rules.js";

// 2026-10-05 is a Monday.
const MON = "2026-10-05";
const day = (offset: number): string => addDays(MON, offset);
const counts = (entries: readonly (readonly [number, number])[]) => new Map(entries.map(([offset, n]) => [day(offset), n]));

describe("R4.14 local calendar", () => {
  it("R4.14 local days, Mondays and months are taken in the time zone", () => {
    expect(localDay(new Date("2026-10-06T03:30:00Z"), "America/New_York")).toBe("2026-10-05");
    expect(localDay(new Date("2026-10-06T03:30:00Z"), "UTC")).toBe("2026-10-06");
    expect(mondayOf("2026-10-11")).toBe(MON);
    expect(mondayOf(MON)).toBe(MON);
    expect(mondayOf("2026-10-06")).toBe(MON);
    expect(monthOf("2026-10-27")).toBe("2026-10-01");
    expect(nextMonth("2026-12-15")).toBe("2027-01-01");
    expect(previousMonth("2026-01-15")).toBe("2025-12-01");
  });

  it("R4.14 local midnight is found across a daylight saving change", () => {
    expect(startOfDay("2026-10-05", "America/New_York").toISOString()).toBe("2026-10-05T04:00:00.000Z");
    expect(startOfDay("2026-11-02", "America/New_York").toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(startOfDay("2026-11-01", "America/New_York").toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(startOfDay("2026-03-30", "Europe/Berlin").toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });
});

describe("R4.14 streak day counting", () => {
  it("R4.14 no rated decisions is an empty streak with both freezes left", () => {
    expect(computeStreak(new Map(), MON)).toEqual({
      currentDays: 0,
      longestDays: 0,
      todayRated: 0,
      freezesLeftThisWeek: FREEZES_PER_WEEK,
      frozenDays: [],
      repairedDays: [],
      repairable: null,
    });
  });

  it("R4.14 a day counts at 5 rated decisions; today in progress neither counts nor breaks", () => {
    const streak = computeStreak(counts([[0, 5], [1, 7], [2, 4]]), day(2));
    expect(streak).toMatchObject({ currentDays: 2, longestDays: 2, todayRated: 4 });
    expect(computeStreak(counts([[0, 5], [1, 7], [2, 5]]), day(2)).currentDays).toBe(3);
  });

  it("R4.14 four rated decisions on the only day start no streak and use no freeze", () => {
    expect(computeStreak(counts([[0, 4], [1, 4]]), day(3))).toMatchObject({
      currentDays: 0,
      freezesLeftThisWeek: FREEZES_PER_WEEK,
      frozenDays: [],
    });
  });
});

describe("R4.14 freezes", () => {
  it("R4.14 two missed days in a week are frozen and bridge without adding", () => {
    const streak = computeStreak(counts([[0, 5], [3, 5]]), day(3));
    expect(streak).toMatchObject({ currentDays: 2, freezesLeftThisWeek: 0, frozenDays: [day(1), day(2)] });
  });

  it("R4.14 freezes renew each Monday", () => {
    // Sun (day 6) counted; Mon and Tue of the next week missed and frozen with that week's freezes.
    const streak = computeStreak(counts([[5, 5], [6, 5], [7, 0], [9, 5]]), day(9));
    expect(streak).toMatchObject({ currentDays: 3, frozenDays: [day(7), day(8)], freezesLeftThisWeek: 0 });
  });
});

describe("R4.14 the 48-hour repair", () => {
  // Mon counted; Tue and Wed frozen; Thu missed with no freeze left.
  const base: readonly (readonly [number, number])[] = [[0, 5]];

  it("R4.14 a missed day is repairable while its window is open and the streak holds", () => {
    const streak = computeStreak(counts([...base, [4, 4]]), day(4));
    expect(streak.currentDays).toBe(1);
    expect(streak.repairable).toEqual({ day: day(3), deadlineDay: day(6), progress: 4, needed: REPAIR_NEEDED });
  });

  it("R4.14 ten rated decisions over the next two days repair the day, which then counts", () => {
    const streak = computeStreak(counts([...base, [4, 6], [5, 4]]), day(5));
    expect(streak).toMatchObject({ repairedDays: [day(3)], repairable: null });
    // Mon, repaired Thu and Fri count; Sat (4, today) is in progress.
    expect(streak.currentDays).toBe(3);
  });

  it("R4.14 a window that closes short breaks the streak, and longest keeps the record", () => {
    // Thu's window (Fri and Sat) holds 8; on Sunday it has closed.
    const streak = computeStreak(counts([...base, [4, 4], [5, 4]]), day(6));
    expect(streak).toMatchObject({ currentDays: 0, longestDays: 1, repairable: null, repairedDays: [] });
  });
});

describe("R4.14 cosmetics", () => {
  it("R4.14 streak milestones at 3, 7, 14, 30, 60 and 100 days", () => {
    expect(streakCosmetics(2)).toEqual([]);
    expect(streakCosmetics(14)).toEqual(["badge-streak-3", "badge-streak-7", "card-back-streak-14"]);
    expect(streakCosmetics(100)).toHaveLength(6);
  });

  it("R4.14 tier badges from II and felts at III, V and VII up to the tier reached", () => {
    expect(tierCosmetics("I")).toEqual([]);
    expect(tierCosmetics("III")).toEqual(["badge-tier-II", "badge-tier-III", "felt-tier-III"]);
    expect(tierCosmetics("VIII")).toHaveLength(10);
  });

  it("R4.14 the next milestone skips the ones already unlocked", () => {
    expect(nextStreakMilestone(0, new Set())).toEqual({ days: 3, cosmeticKey: "badge-streak-3" });
    expect(nextStreakMilestone(2, new Set(["badge-streak-3", "badge-streak-7"]))).toEqual({
      days: 14,
      cosmeticKey: "card-back-streak-14",
    });
    expect(nextStreakMilestone(100, new Set())).toBeNull();
  });
});
