/**
 * The coverage relay's mapping (R3.4, O-172, O-240): only published flops count as held, the
 * database state and the synthetic flag pass through, and a spot is covered only when preflop is
 * held and, for a flop, a published solution holds it.
 */
import { describe, expect, it } from "vitest";

import type { SqCoverage } from "../src/solver-query/client.js";
import { isSpotCovered, toCoverage } from "../src/study/coverage-mapper.js";

const JOB_ID = "01900000-0000-7000-8000-000000000001";

function coverage(overrides: Partial<SqCoverage> = {}): SqCoverage {
  return {
    config_id: "cfg_6_online_100",
    pair: "BB-BTN",
    preflop: { available: true, solution_ids: ["s"], sources: ["library"], synthetic: false },
    flops: [
      { flop: "Ah7d2c", texture_family: "rainbow-dry", scenarios: 20, status: "published" },
      { flop: "Kd8s3h", texture_family: "rainbow-dry", scenarios: 20, status: "superseded" },
    ],
    textures: [],
    queue: [{ job_id: JOB_ID, flop: "Qc9h4d", priority: 3, status: "queued", position: 2 }],
    database: "connected",
    spot_classes: [],
    ...overrides,
  };
}

describe("R3.4 coverage mapping", () => {
  it("R3.4 keeps published flops only and passes the queue, synthetic and database through", () => {
    expect(toCoverage(coverage())).toEqual({
      config_id: "cfg_6_online_100",
      pair: "BB-BTN",
      preflop_available: true,
      flops: [{ flop: "Ah7d2c", texture_family: "rainbow-dry", scenarios: 20 }],
      queue: [{ job_id: JOB_ID, flop: "Qc9h4d", priority: 3, position: 2 }],
      synthetic: false,
      database: "connected",
    });
  });

  it("R3.4 an unavailable database passes through as empty lists (O-172)", () => {
    const mapped = toCoverage(coverage({ flops: [], queue: [], database: "unavailable" }));
    expect(mapped).toMatchObject({ flops: [], queue: [], database: "unavailable" });
  });

  it("R3.4 a spot is covered only with preflop held and, for a flop, a published flop", () => {
    expect(isSpotCovered(coverage(), undefined)).toBe(true);
    expect(isSpotCovered(coverage(), "Ah7d2c")).toBe(true);
    expect(isSpotCovered(coverage(), "Kd8s3h")).toBe(false);
    expect(isSpotCovered(coverage(), "2c3d4h")).toBe(false);
    const noPreflop = coverage({ preflop: { available: false, solution_ids: [], sources: [], synthetic: false } });
    expect(isSpotCovered(noPreflop, undefined)).toBe(false);
  });
});
