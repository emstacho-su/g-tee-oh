/**
 * The holdout jobs' periods (R4.13, O-276): the monthly round job runs once per local month at
 * local midnight on the 1st, and the draw job once per local day, both in APP_TIME_ZONE (O-247).
 */
import { describe, expect, it } from "vitest";

import { holdoutDrawPeriod, HOLDOUT_DRAW_JOB, HOLDOUT_DRAW_KIND } from "../src/jobs/holdout-draw.js";
import { holdoutRoundPeriod, HOLDOUT_ROUND_JOB, HOLDOUT_ROUND_KIND } from "../src/jobs/holdout-round.js";
import { JOB_KINDS } from "../src/jobs/registry.js";

const NEW_YORK = "America/New_York";

describe("R4.13 holdout job periods", () => {
  it("R4.13 the round job's period is the local month, run at local midnight on the 1st", () => {
    // 2026-11-01 03:30 UTC is still 2026-10-31 in New York (UTC-4 until the 2026-11-01 change).
    expect(holdoutRoundPeriod(new Date("2026-11-01T03:30:00Z"), NEW_YORK)).toEqual({
      periodKey: "2026-10-01",
      runAt: new Date("2026-10-01T04:00:00Z"),
    });
    expect(holdoutRoundPeriod(new Date("2026-11-15T12:00:00Z"), NEW_YORK)).toEqual({
      periodKey: "2026-11-01",
      runAt: new Date("2026-11-01T04:00:00Z"),
    });
    expect(holdoutRoundPeriod(new Date("2026-12-31T23:59:59Z"), "UTC").periodKey).toBe("2026-12-01");
  });

  it("R4.13 the draw job's period is the local day", () => {
    expect(holdoutDrawPeriod(new Date("2026-11-02T03:00:00Z"), NEW_YORK)).toEqual({
      periodKey: "2026-11-01",
      runAt: new Date("2026-11-01T04:00:00Z"),
    });
  });

  it("R4.13 both jobs are registered under their registry kinds", () => {
    expect(HOLDOUT_ROUND_JOB.kind).toBe(HOLDOUT_ROUND_KIND);
    expect(HOLDOUT_DRAW_JOB.kind).toBe(HOLDOUT_DRAW_KIND);
    expect(Object.values(JOB_KINDS)).toEqual(expect.arrayContaining([HOLDOUT_ROUND_KIND, HOLDOUT_DRAW_KIND]));
    const at = new Date("2026-11-15T12:00:00Z");
    expect(HOLDOUT_ROUND_JOB.nextPeriod(at, NEW_YORK)).toEqual(holdoutRoundPeriod(at, NEW_YORK));
    expect(HOLDOUT_DRAW_JOB.nextPeriod(at, NEW_YORK)).toEqual(holdoutDrawPeriod(at, NEW_YORK));
  });
});
