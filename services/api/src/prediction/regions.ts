/**
 * Named hand regions of the 13 by 13 grid for the range ladder's third level (R3.16, O-301): which
 * regions hold a class the acting seat mixes. This is naming data only: a region is a list of class
 * names, and the mixed flag it is asked about is solver-query's HandRow.mixed (ADR 0004).
 *
 * The regions split the 169 classes into eight disjoint groups, tested as a partition:
 * - pairs: AA to 22;
 * - suited_aces: A2s to AKs;
 * - suited_connectors: 54s to JTs (gap 0), so JTs is a connector, not a broadway;
 * - suited_broadways: the other suited classes of two ranks from T to K (KQs, KJs, KTs, QJs, QTs);
 * - suited_other: every other suited class;
 * - offsuit_aces: A2o to AKo;
 * - offsuit_broadways: the offsuit classes of two ranks from T to K;
 * - offsuit_other: every other offsuit class.
 */
import type { z } from "zod";

import type { handRegionSchema } from "../schemas/prediction.js";

export type HandRegion = z.infer<typeof handRegionSchema>;

/** Ranks from high to low, the order a class names them in. */
const RANKS = "AKQJT98765432";
const ACE = "A";
const BROADWAY_RANKS = "KQJT";
const SUITED = "s";
const OFFSUIT = "o";
const LOWEST_CONNECTOR_HIGH = "5";
const HIGHEST_CONNECTOR_HIGH = "J";

/** Every region in the order the prompt offers them. */
export const HAND_REGIONS: readonly HandRegion[] = [
  "pairs",
  "suited_aces",
  "suited_broadways",
  "suited_connectors",
  "suited_other",
  "offsuit_aces",
  "offsuit_broadways",
  "offsuit_other",
];

/** The 169 classes, high rank first: pairs, then each suited and offsuit class. */
export function allHandClasses(): string[] {
  const classes: string[] = [];
  for (let high = 0; high < RANKS.length; high += 1) {
    for (let low = high; low < RANKS.length; low += 1) {
      const pair = `${RANKS[high]}${RANKS[low]}`;
      classes.push(...(high === low ? [pair] : [`${pair}${SUITED}`, `${pair}${OFFSUIT}`]));
    }
  }
  return classes;
}

function isConnector(high: string, low: string): boolean {
  const highIndex = RANKS.indexOf(high);
  const inSpan = highIndex >= RANKS.indexOf(HIGHEST_CONNECTOR_HIGH) && highIndex <= RANKS.indexOf(LOWEST_CONNECTOR_HIGH);
  return inSpan && RANKS.indexOf(low) === highIndex + 1;
}

function isBroadway(high: string, low: string): boolean {
  return BROADWAY_RANKS.includes(high) && BROADWAY_RANKS.includes(low);
}

function suitedRegion(high: string, low: string): HandRegion {
  if (high === ACE) {
    return "suited_aces";
  }
  if (isConnector(high, low)) {
    return "suited_connectors";
  }
  return isBroadway(high, low) ? "suited_broadways" : "suited_other";
}

function offsuitRegion(high: string, low: string): HandRegion {
  if (high === ACE) {
    return "offsuit_aces";
  }
  return isBroadway(high, low) ? "offsuit_broadways" : "offsuit_other";
}

/** The region of a class written high rank first (AKs, 72o, 55); a RangeError for anything else. */
export function regionOf(handClass: string): HandRegion {
  const [high = "", low = ""] = handClass;
  const suffix = handClass.slice(2);
  if (!RANKS.includes(high) || !RANKS.includes(low) || RANKS.indexOf(high) > RANKS.indexOf(low)) {
    throw new RangeError(`${JSON.stringify(handClass)} is not a hand class written high rank first`);
  }
  if (high === low && suffix === "") {
    return "pairs";
  }
  if (high !== low && suffix === SUITED) {
    return suitedRegion(high, low);
  }
  if (high !== low && suffix === OFFSUIT) {
    return offsuitRegion(high, low);
  }
  throw new RangeError(`${JSON.stringify(handClass)} is not a hand class written high rank first`);
}

/** The regions holding at least one of `classes`, in HAND_REGIONS order. */
export function regionsHolding(classes: readonly string[]): HandRegion[] {
  const held = new Set(classes.map(regionOf));
  return HAND_REGIONS.filter((region) => held.has(region));
}
