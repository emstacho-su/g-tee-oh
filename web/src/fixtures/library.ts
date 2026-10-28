/**
 * Synthetic coverage and builder fixtures (S28, R3.4, R3.5, O-26, O-57). Unit tests, the mocked
 * api (e2e/support/mock-library.ts) and the screenshots read these. Every flop, count, priority
 * and byte figure is invented for the view; nothing comes from any reference tool. The texture
 * family of each covered flop is written by hand here, as solver-query would report it.
 */
import type { BuilderStatus } from "../contracts.js";
import type { Coverage } from "../library/texture-families.js";
import { FIXTURE_STUDY_CONFIG_ID, FIXTURE_STUDY_PAIR, fixturePairsByConfig } from "./study.js";

export const FIXTURE_QUEUE_CONFIG_ID = FIXTURE_STUDY_CONFIG_ID;
export const FIXTURE_QUEUE_PAIR = FIXTURE_STUDY_PAIR;

/** Queued builds for the fixture pair, in claim order (highest priority first). */
export const FIXTURE_QUEUE: Coverage["queue"] = [
  { job_id: "00000000-0000-4000-8000-0000000000c1", flop: "Kd8s3h", priority: 5, position: 1 },
  { job_id: "00000000-0000-4000-8000-0000000000c2", flop: "Qc9h4d", priority: 3, position: 2 },
  { job_id: "00000000-0000-4000-8000-0000000000c3", flop: "Th6c2s", priority: 1.5, position: 3 },
];

/** The queued flop the flows request: last in line, so the raise is visible. */
export const FIXTURE_REQUESTED_FLOP = "Th6c2s";

export const FIXTURE_COVERED_FLOPS: Coverage["flops"] = [
  { flop: "Ah7d2c", texture_family: "dry-ace-high", scenarios: 20 },
  { flop: "As8d3h", texture_family: "dry-ace-high", scenarios: 20 },
  { flop: "8s8d3c", texture_family: "paired", scenarios: 20 },
  { flop: "Js9s4s", texture_family: "monotone", scenarios: 10 },
  { flop: "KhQhTd", texture_family: "two-tone-broadway", scenarios: 20 },
  { flop: "6c5d4h", texture_family: "low-connected", scenarios: 20 },
];

/** The coverage the api answers for a configuration and pair the fixture catalog holds. */
export function fixtureCoverage(configId: string, pair: string): Coverage | undefined {
  const entry = fixturePairsByConfig[configId]?.find((candidate) => candidate.pair === pair);
  if (entry === undefined) return undefined;
  const queued = configId === FIXTURE_QUEUE_CONFIG_ID && pair === FIXTURE_QUEUE_PAIR;
  return {
    config_id: configId,
    pair,
    preflop_available: entry.preflop_available,
    flops: queued ? [...FIXTURE_COVERED_FLOPS] : [],
    queue: queued ? [...FIXTURE_QUEUE] : [],
    synthetic: entry.preflop_available,
    database: "connected",
  };
}

export const fixtureBuilderStatus: BuilderStatus = {
  state: "running",
  reason: "",
  queue: { queued: 3, running: 1, failed: 0, blocked_budget: 1 },
  throughput_per_hour: 0.5,
  storage: { library_bytes: 120_000_000_000, reference_bytes: 30_000_000_000 },
  settings: { cpu_share: 0.6 },
};
