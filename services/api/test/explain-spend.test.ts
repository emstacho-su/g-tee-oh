/**
 * The monthly Ask spend and its reservation (R3.20, O-306, O-5) over the test database. Each test
 * uses its own month far from today, so it never meets the current month the route tests spend
 * in. Prices are the claude-api skill's for the default model.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db.js";
import { costCents, estimateInputTokens, MODEL_PRICES, worstCaseCents } from "../src/explain/pricing.js";
import { monthOf, reserveSpend, settleSpend, spentCents } from "../src/explain/spend.js";
import { appDatabase } from "./support/database.js";

let database: Database;
let monthSeed = 0;
const FIRST_TEST_YEAR = 1990;

/** A month no other test uses. */
function freshMonth(): string {
  monthSeed += 1;
  return monthOf(new Date(Date.UTC(FIRST_TEST_YEAR + monthSeed, 0, 15)));
}

beforeAll(() => {
  database = appDatabase();
});

afterAll(async () => {
  await database.destroy();
});

describe("R3.20 pricing (O-306)", () => {
  it("R3.20 the default model costs 400 and 2,000 cents per million input and output tokens", () => {
    expect(MODEL_PRICES["claude-opus-5-5"]).toEqual({ inputCentsPerMillion: 400, outputCentsPerMillion: 2000 });
  });

  it("R3.20 costs round up to whole cents", () => {
    expect(costCents("claude-opus-5-5", { inputTokens: 0, outputTokens: 0 })).toBe(0);
    expect(costCents("claude-opus-5-5", { inputTokens: 1, outputTokens: 0 })).toBe(1);
    expect(costCents("claude-opus-5-5", { inputTokens: 2500, outputTokens: 500 })).toBe(2);
  });

  it("R3.20 the worst case covers every call at max tokens with an overestimated input", () => {
    expect(estimateInputTokens(9)).toBe(5);
    expect(worstCaseCents("claude-opus-5-5", 10_000, 4000, 2)).toBe(2 * costCents("claude-opus-5-5", { inputTokens: 5000, outputTokens: 4000 }));
  });
});

describe("R3.20 spend reservation (O-306)", () => {
  it("R3.20 the month key is the first day of the UTC month", () => {
    expect(monthOf(new Date("2026-10-31T23:30:00-05:00"))).toBe("2026-11-01");
    expect(monthOf(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01-01");
  });

  it("R3.20 a month without a row has spent nothing; a reservation creates it", async () => {
    const month = freshMonth();
    expect(await spentCents(database, month)).toBe(0);
    expect(await reserveSpend(database, month, 12, 100)).toBe(true);
    expect(await spentCents(database, month)).toBe(12);
  });

  it("R3.20 a reservation that would pass the cap is refused and changes nothing", async () => {
    const month = freshMonth();
    expect(await reserveSpend(database, month, 90, 100)).toBe(true);
    expect(await reserveSpend(database, month, 11, 100)).toBe(false);
    expect(await spentCents(database, month)).toBe(90);
    expect(await reserveSpend(database, month, 10, 100)).toBe(true);
    expect(await spentCents(database, month)).toBe(100);
  });

  it("R3.20 two concurrent reservations at the cap edge cannot both spend", async () => {
    const month = freshMonth();
    expect(await reserveSpend(database, month, 80, 100)).toBe(true);
    const results = await Promise.all([
      reserveSpend(database, month, 15, 100),
      reserveSpend(database, month, 15, 100),
      reserveSpend(database, month, 15, 100),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await spentCents(database, month)).toBe(95);
  });

  it("R3.20 settling swaps the reservation for the real cost, and a refund never goes below zero", async () => {
    const month = freshMonth();
    await reserveSpend(database, month, 30, 100);
    await settleSpend(database, month, 30, 4);
    expect(await spentCents(database, month)).toBe(4);
    await settleSpend(database, month, 30, 0);
    expect(await spentCents(database, month)).toBe(0);
  });
});
