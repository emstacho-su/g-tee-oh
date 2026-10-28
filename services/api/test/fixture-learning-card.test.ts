/**
 * The e2e learning seed's card (R4.10, O-324): scripts/fixture-learning.mjs writes a hand-copied
 * FSRS card so it needs no TypeScript toolchain; this test holds that copy to what learning's FSRS
 * adapter and the api's stored-card format give for the same two Good reviews (S31's seedCards),
 * and checks the api parses it back.
 */
import { newSpotClassCard, reviewSpotClass } from "@g-tee-oh/learning";
import { describe, expect, it } from "vitest";

import { spotClassCardOf, storedCardOf } from "../src/learning-state/fsrs-card.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// A plain .mjs with no declaration file: imported by URL and given the one signature used here.
const SEED_SCRIPT = new URL("../../../scripts/fixture-learning.mjs", import.meta.url).href;
const { seededCard } = (await import(SEED_SCRIPT)) as { seededCard: (now: Date) => unknown };

describe("R4.10 the e2e seed card matches learning's FSRS adapter", () => {
  for (const nowIso of ["2026-10-28T12:00:00Z", "2027-03-01T00:00:00Z"]) {
    it(`R4.10 at ${nowIso}`, () => {
      const now = new Date(nowIso);
      const created = new Date(now.getTime() - 60 * DAY_MS);
      const reviewed = new Date(now.getTime() - 30 * DAY_MS);
      const card = reviewSpotClass(reviewSpotClass(newSpotClassCard("k", created), "Good", created), "Good", reviewed);
      const seeded = seededCard(now);
      expect(seeded).toEqual(storedCardOf(card));
      expect(spotClassCardOf("k", seeded).card.reps).toBe(2);
    });
  }
});
