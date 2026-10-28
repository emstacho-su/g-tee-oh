/**
 * The spot-class catalog (R4.10, O-270, ADR 0004, ADR 0013, ADR 0018): every spot class the
 * automated loop may serve within a scope of configurations, read from solver-query, never composed
 * or parsed in TypeScript.
 *
 * Mechanism:
 * - Scope: the catalog game_config rows with no ante (O-33), all of them or the ids given; every
 *   pair of two seats at each configuration's table size (catalog/seats.ts canonicalPairs).
 * - Each (configuration, pair) is asked of GET /v1/coverage?classes=true, at most
 *   MAX_CONCURRENT_SOLVER_CALLS at a time, under CATALOG_DEADLINE_MS rather than the request
 *   deadline (a cold catalog over every configuration is hundreds of calls). A pair whose preflop
 *   solution is held is covered and contributes its spot_classes; a pair with none is a gap the
 *   caller records as a coverage_request (O-240); a pair whose solution is marked unavailable (503)
 *   is neither, so it is not served and not requested.
 * - Entries of one spot_class_key across configurations (the same class at 1/3 and 2/5, for
 *   example) merge into one class with one option per (configuration, pair). The class's family is
 *   solver-query's; its track is trackFor(family, the hero seat of its first spot) (O-271); its
 *   frequency prior is the mean over its options of learning's frequencyPriorPer1000(table size,
 *   line reach) (O-270); meanPotBb is the line-reach-weighted mean start-node pot in big blinds,
 *   which the progress lane's effective track weight reads (O-271).
 * - Cache: per solver-query client and scope, for CATALOG_TTL_MS, single flight (concurrent loads
 *   of one scope share one promise; a failed load is dropped so the next call retries), and dropped
 *   whole on a coverage_added notification (watchCoverageAdded), since new coverage changes classes.
 */
import { frequencyPriorPer1000 } from "@g-tee-oh/learning";

import { canonicalPairs } from "../catalog/seats.js";
import type { Database } from "../db.js";
import type { NotificationSource } from "../events/source.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { trackFor, type TrackKey } from "../learning/tracks.js";
import { CBB_PER_BB } from "../sessions/candidates.js";
import { mapBounded, MAX_CONCURRENT_SOLVER_CALLS } from "../sessions/concurrency.js";
import { heroSpotSchema, MAX_HERO_SPOTS, type HeroSpot } from "../sessions/state.js";
import { expectData, type SolverQuery, type SqClassSpot, type SqSpotClassEntry } from "../solver-query/client.js";

/** How long the whole catalog read may take; a cold read over every configuration is many calls (O-270). */
export const CATALOG_DEADLINE_MS = 30_000;
/** How long a loaded catalog is served from memory before it is read again. */
export const CATALOG_TTL_MS = 600_000;
/** A reach is a probability; solver-query's f32 sum may round a hair above 1. */
const MAX_LINE_REACH = 1;
/** v1 serves no ante variants (O-33). */
const NO_ANTE_CBB = 0;
const COVERAGE_ADDED_CHANNEL = "coverage_added";
const SCOPE_KEY_SEPARATOR = ",";
const ALL_CONFIGS_SCOPE = "*";

export type CatalogOption = Readonly<{
  configId: string;
  pair: string;
  tableSize: number;
  solutionId: string;
  lineReach: number;
  spots: readonly SqClassSpot[];
}>;

export type CatalogClass = Readonly<{
  spotClassKey: string;
  family: string;
  /** solver-query's format of the class (SpotClassEntry.format), for the heat map columns. */
  format: string;
  /** solver-query's depth band of the class (SpotClassEntry.depth_band). */
  depthBand: string;
  trackKey: TrackKey | null;
  heroPosition: string;
  frequencyPriorPer1k: number;
  meanPotBb: number;
  options: readonly CatalogOption[];
}>;

export type CatalogPair = Readonly<{ configId: string; pair: string }>;

export type ClassCatalog = Readonly<{
  classes: readonly CatalogClass[];
  byKey: ReadonlyMap<string, CatalogClass>;
  coveredPairs: readonly CatalogPair[];
  uncoveredPairs: readonly CatalogPair[];
  /** Pairs whose solution solver-query marks unavailable: neither served nor requested. */
  unavailablePairs: readonly CatalogPair[];
}>;

/** What solver-query answered for one (configuration, pair). */
export type PairAnswer = Readonly<{
  configId: string;
  pair: string;
  tableSize: number;
  status: "covered" | "uncovered" | "unavailable";
  spotClasses: readonly SqSpotClassEntry[];
}>;

export interface CatalogLoadOptions {
  /** The clock the cache expiry reads; Date.now unless a test fixes it. */
  nowMs?: () => number;
}

interface ScopedConfig {
  id: string;
  tableSize: number;
}

interface CacheEntry {
  expiresAt: number;
  catalog: Promise<ClassCatalog>;
}

let caches = new WeakMap<SolverQuery, Map<string, CacheEntry>>();
const watchedSources = new WeakSet<NotificationSource>();

/** Drops every cached catalog (coverage changed, or a test wants a cold read). */
export function invalidateClassCatalogs(): void {
  caches = new WeakMap();
}

/** Drops the cached catalogs whenever the builder announces new coverage; subscribes once per source. */
export function watchCoverageAdded(source: NotificationSource | null): void {
  if (source === null || watchedSources.has(source)) {
    return;
  }
  watchedSources.add(source);
  source.subscribe((channel) => {
    if (channel === COVERAGE_ADDED_CHANNEL) {
      invalidateClassCatalogs();
    }
  });
}

function weightedMeanPotBb(spots: readonly SqClassSpot[]): number {
  const totalReach = spots.reduce((sum, spot) => sum + spot.line_reach, 0);
  if (totalReach <= 0) {
    return spots.reduce((sum, spot) => sum + spot.pot_cbb / CBB_PER_BB, 0) / Math.max(spots.length, 1);
  }
  return spots.reduce((sum, spot) => sum + (spot.line_reach / totalReach) * (spot.pot_cbb / CBB_PER_BB), 0);
}

/** The fields every entry of one class key shares, copied from its first entry. */
type ClassNames = Readonly<{ family: string; format: string; depthBand: string }>;

function classOf(key: string, names: ClassNames, options: readonly CatalogOption[]): CatalogClass | undefined {
  const heroPosition = options.flatMap((option) => option.spots)[0]?.hero_position;
  if (heroPosition === undefined) {
    return undefined;
  }
  const priors = options.map((option) => frequencyPriorPer1000(option.tableSize, Math.min(option.lineReach, MAX_LINE_REACH)));
  return Object.freeze({
    spotClassKey: key,
    family: names.family,
    format: names.format,
    depthBand: names.depthBand,
    trackKey: trackFor(names.family, heroPosition),
    heroPosition,
    frequencyPriorPer1k: priors.reduce((sum, prior) => sum + prior, 0) / priors.length,
    meanPotBb: weightedMeanPotBb(options.flatMap((option) => option.spots)),
    options: Object.freeze([...options]),
  });
}

function pairOf(answer: PairAnswer): CatalogPair {
  return Object.freeze({ configId: answer.configId, pair: answer.pair });
}

/** The catalog of solver-query's answers (pure): classes merged by key, sorted by key. */
export function buildClassCatalog(answers: readonly PairAnswer[]): ClassCatalog {
  const grouped = new Map<string, { names: ClassNames; options: CatalogOption[] }>();
  for (const answer of answers.filter((candidate) => candidate.status === "covered")) {
    for (const entry of answer.spotClasses) {
      const option: CatalogOption = Object.freeze({
        configId: answer.configId,
        pair: answer.pair,
        tableSize: entry.table_size,
        solutionId: entry.solution_id,
        lineReach: entry.line_reach,
        spots: Object.freeze([...entry.spots]),
      });
      const group = grouped.get(entry.spot_class_key);
      const names = group?.names ?? { family: entry.family, format: entry.format, depthBand: entry.depth_band };
      grouped.set(entry.spot_class_key, { names, options: [...(group?.options ?? []), option] });
    }
  }
  const classes = [...grouped.keys()]
    .sort()
    .flatMap((key) => {
      const group = grouped.get(key);
      const built = group === undefined ? undefined : classOf(key, group.names, group.options);
      return built === undefined ? [] : [built];
    });
  return Object.freeze({
    classes: Object.freeze(classes),
    byKey: new Map(classes.map((cls) => [cls.spotClassKey, cls])),
    coveredPairs: Object.freeze(answers.filter((answer) => answer.status === "covered").map(pairOf)),
    uncoveredPairs: Object.freeze(answers.filter((answer) => answer.status === "uncovered").map(pairOf)),
    unavailablePairs: Object.freeze(answers.filter((answer) => answer.status === "unavailable").map(pairOf)),
  });
}

/** The session state's hero spots for a block of the class: every spot of every option (O-272). */
export function heroSpotsOf(cls: CatalogClass): HeroSpot[] {
  return cls.options
    .flatMap((option) =>
      option.spots.map((spot) =>
        heroSpotSchema.parse({
          config_id: option.configId,
          pair: option.pair,
          line: spot.line ?? null,
          hero_seat: spot.hero_position,
          history: spot.history.map((entry) => ({ position: entry.position, token: entry.token, label: entry.label })),
        }),
      ),
    )
    .slice(0, MAX_HERO_SPOTS);
}

/** The scope's configurations, sorted by id; an id the catalog does not hold is a 400. */
export async function scopedConfigs(database: Database, configIds?: readonly string[]): Promise<ScopedConfig[]> {
  const rows = await database
    .selectFrom("game_config")
    .select(["id", "table_size"])
    .where("ante_cbb", "=", NO_ANTE_CBB)
    .where((eb) => (configIds === undefined ? eb.and([]) : eb("id", "in", [...configIds])))
    .orderBy("id")
    .execute();
  const unknown = (configIds ?? []).filter((id) => !rows.some((row) => row.id === id));
  if (unknown.length > 0) {
    throw new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.badRequest, {
      detail: `config_ids names configurations the catalog does not serve: ${unknown.join(", ")}.`,
    });
  }
  return rows.map((row) => ({ id: row.id, tableSize: row.table_size }));
}

async function askPair(solverQuery: SolverQuery, config: ScopedConfig, pair: string, signal: AbortSignal): Promise<PairAnswer> {
  const base = { configId: config.id, pair, tableSize: config.tableSize };
  try {
    const coverage = await expectData(
      solverQuery.GET("/v1/coverage", { params: { query: { config_id: config.id, pair, classes: true } }, signal }),
      "the spot classes of this spot",
    );
    const status = coverage.preflop.available ? "covered" : "uncovered";
    return { ...base, status, spotClasses: coverage.spot_classes };
  } catch (error: unknown) {
    if (error instanceof ProblemError && error.status === HTTP_STATUS.unavailable) {
      return { ...base, status: "unavailable", spotClasses: [] };
    }
    throw error;
  }
}

async function readCatalog(solverQuery: SolverQuery, configs: readonly ScopedConfig[]): Promise<ClassCatalog> {
  const signal = AbortSignal.timeout(CATALOG_DEADLINE_MS);
  const questions = configs.flatMap((config) => canonicalPairs(config.tableSize).map(({ pair }) => ({ config, pair })));
  const answers = await mapBounded(questions, MAX_CONCURRENT_SOLVER_CALLS, ({ config, pair }) => askPair(solverQuery, config, pair, signal));
  return buildClassCatalog(answers);
}

function cacheFor(solverQuery: SolverQuery): Map<string, CacheEntry> {
  const existing = caches.get(solverQuery);
  if (existing !== undefined) {
    return existing;
  }
  const created = new Map<string, CacheEntry>();
  caches.set(solverQuery, created);
  return created;
}

/**
 * The catalog of the scope (every catalog configuration when configIds is undefined), cached per
 * client and scope for CATALOG_TTL_MS with one load in flight per scope.
 */
export async function loadClassCatalog(
  solverQuery: SolverQuery,
  database: Database,
  configIds?: readonly string[],
  options: CatalogLoadOptions = {},
): Promise<ClassCatalog> {
  const nowMs = (options.nowMs ?? Date.now)();
  const scopeKey = configIds === undefined ? ALL_CONFIGS_SCOPE : [...new Set(configIds)].sort().join(SCOPE_KEY_SEPARATOR);
  const cache = cacheFor(solverQuery);
  const cached = cache.get(scopeKey);
  if (cached !== undefined && cached.expiresAt > nowMs) {
    return cached.catalog;
  }
  const catalog = scopedConfigs(database, configIds).then((configs) => readCatalog(solverQuery, configs));
  const entry: CacheEntry = { expiresAt: nowMs + CATALOG_TTL_MS, catalog };
  cache.set(scopeKey, entry);
  catalog.catch(() => {
    if (cache.get(scopeKey) === entry) {
      cache.delete(scopeKey);
    }
  });
  return catalog;
}
