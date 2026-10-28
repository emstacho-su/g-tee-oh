/**
 * The mocked api's check of a catalog-spot session start (S41, R3.16, R3.17, O-415), shared by the
 * prediction and painting mocks so both refuse what the api refuses, in its order.
 *
 * Mechanism: a pure function of the POST /sessions body. It answers 400 validation when the body
 * names both drill_id and catalog_spot, or when catalog_spot is malformed: a configuration the
 * fixture catalog does not hold (src/fixtures/study.ts fixtureConfigs), an empty or repeated seat
 * list, a seat not seated at that table size, a hero seat also listed as an opponent, or a spot type
 * outside the preflop families. It answers 422 no-coverage when no hero seat sits in an available
 * pair of the fixture catalog, as the api does once its coverage search finds no hero spot (O-240).
 * Otherwise null: the session starts.
 */
import { PREFLOP_ACTIONS, seatedPositions } from "../../src/drills/limits.js";
import { fixtureConfigs, fixturePairsByConfig } from "../../src/fixtures/study.js";
import type { ProblemSpec } from "./mock-api.js";

export const CATALOG_PROBLEMS = {
  validation: { status: 400, slug: "validation", title: "Request validation failed" },
  noCoverage: { status: 422, slug: "no-coverage", title: "No coverage" },
} as const satisfies Readonly<Record<string, ProblemSpec>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A list of distinct strings drawn from the allowed values, at least `min` long. */
function isDistinctListOf(value: unknown, allowed: readonly string[], min: number): value is string[] {
  if (!Array.isArray(value) || value.length < min || new Set(value).size !== value.length) return false;
  return value.every((entry) => typeof entry === "string" && allowed.includes(entry));
}

function shapeProblem(spot: unknown): ProblemSpec | null {
  if (!isRecord(spot)) return CATALOG_PROBLEMS.validation;
  const config = fixtureConfigs.find((entry) => entry.config_id === spot["config_id"]);
  if (config === undefined) return CATALOG_PROBLEMS.validation;
  const seated: readonly string[] = seatedPositions(config.table_size);
  const heroes = spot["hero_positions"];
  const villains = spot["villain_positions"] ?? [];
  if (!isDistinctListOf(heroes, seated, 1) || !isDistinctListOf(villains, seated, 0)) return CATALOG_PROBLEMS.validation;
  if (villains.some((seat) => heroes.includes(seat))) return CATALOG_PROBLEMS.validation;
  return isDistinctListOf(spot["spot_types"], PREFLOP_ACTIONS, 1) ? null : CATALOG_PROBLEMS.validation;
}

/** The problem a catalog-spot start earns, or null when it starts a session. */
export function catalogSpotProblem(body: Record<string, unknown>): ProblemSpec | null {
  if (body["drill_id"] !== undefined) return CATALOG_PROBLEMS.validation;
  const spot = body["catalog_spot"];
  const shape = shapeProblem(spot);
  if (shape !== null || !isRecord(spot)) return shape ?? CATALOG_PROBLEMS.validation;
  const pairs = (fixturePairsByConfig[String(spot["config_id"])] ?? []).filter((pair) => pair.preflop_available);
  const heroes = spot["hero_positions"] as string[];
  const covered = heroes.some((seat) => pairs.some((pair) => pair.oop === seat || pair.ip === seat));
  return covered ? null : CATALOG_PROBLEMS.noCoverage;
}
