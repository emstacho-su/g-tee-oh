/**
 * The seven v1 rating tracks (O-271, R4.10, R4.11, 06 section 2, ADR 0011). Pure data and one pure
 * function: no input/output, so the migration that seeds the track table and this table are checked
 * against each other by a database test (db/test, R4.11).
 *
 * Mechanism: every spot class maps to exactly one track by its action family (solver-query's
 * ActionFamily::as_str name, sessions/action-family.ts RUST_ACTION_FAMILIES; the api never derives
 * a family) and, for decisions facing one raise, by the hero's seat: a hero in the blinds defends
 * (blind-defense), any other seat faces the open in position (facing-open-ip). Squeeze decisions
 * face one raise and a caller, so they split by seat the same way. Live-only families (limped pots
 * and straddled pots) form one track. The seat names are naming data (catalog/seats.ts).
 *
 * TRACKS[i].scope is exactly the jsonb the migration writes: the families, which hero seats, and
 * the formats. track.weight is an enable multiplier of 1 (O-271); the effective weight is computed
 * on read by the progress lane.
 */
import { BLIND_POSITIONS, type Position } from "../catalog/seats.js";
import type { RustActionFamily } from "../sessions/action-family.js";

export const TRACK_KEYS = [
  "opens",
  "facing-open-ip",
  "blind-defense",
  "facing-3bet",
  "four-bet-plus",
  "blind-vs-blind",
  "live-limped-straddled",
] as const;

export type TrackKey = (typeof TRACK_KEYS)[number];

/** Which hero seats a track takes: any, every seat but the blinds, or the blinds only. */
export type TrackHero = "any" | "non_blind" | "blind";

export type TrackFormat = "online" | "live";

export interface TrackScope {
  families: readonly RustActionFamily[];
  hero: TrackHero;
  formats: readonly TrackFormat[];
}

export interface TrackDefinition {
  key: TrackKey;
  name: string;
  scope: TrackScope;
}

/** The track.family column of every v1 track: equilibrium play (ADR 0011). */
export const TRACK_FAMILY = "equilibrium";
/** The track.format column of every v1 track: cash games. */
export const TRACK_FORMAT = "cash";
/** The track.weight column: an enable multiplier (O-271). */
export const TRACK_ENABLED_WEIGHT = 1;

const BOTH_FORMATS: readonly TrackFormat[] = ["online", "live"];
const LIVE_ONLY: readonly TrackFormat[] = ["live"];
const FACING_ONE_RAISE: readonly RustActionFamily[] = ["facing-open", "squeeze"];

export const TRACKS: readonly TrackDefinition[] = [
  { key: "opens", name: "Opens", scope: { families: ["rfi"], hero: "any", formats: BOTH_FORMATS } },
  {
    key: "facing-open-ip",
    name: "Facing an open in position",
    scope: { families: FACING_ONE_RAISE, hero: "non_blind", formats: BOTH_FORMATS },
  },
  {
    key: "blind-defense",
    name: "Blind defense",
    scope: { families: FACING_ONE_RAISE, hero: "blind", formats: BOTH_FORMATS },
  },
  { key: "facing-3bet", name: "Facing a 3-bet", scope: { families: ["facing-3bet"], hero: "any", formats: BOTH_FORMATS } },
  {
    key: "four-bet-plus",
    name: "4-bet pots and beyond",
    scope: { families: ["facing-4bet"], hero: "any", formats: BOTH_FORMATS },
  },
  {
    key: "blind-vs-blind",
    name: "Blind versus blind",
    scope: { families: ["blind-vs-blind"], hero: "any", formats: BOTH_FORMATS },
  },
  {
    key: "live-limped-straddled",
    name: "Live limped and straddled pots",
    scope: { families: ["limped-isolation", "straddled-pot"], hero: "any", formats: LIVE_ONLY },
  },
];

function heroMatches(hero: TrackHero, position: string): boolean {
  const blind = BLIND_POSITIONS.some((seat: Position) => seat === position);
  if (hero === "blind") {
    return blind;
  }
  if (hero === "non_blind") {
    return !blind;
  }
  return true;
}

/**
 * The one track a spot class belongs to, from solver-query's family name and the seat to act;
 * null for a family no track takes (an unknown name, or a postflop node with no family).
 */
export function trackFor(family: string | null, heroPosition: string): TrackKey | null {
  const track = TRACKS.find(
    (candidate) =>
      candidate.scope.families.some((name) => name === family) && heroMatches(candidate.scope.hero, heroPosition),
  );
  return track?.key ?? null;
}

/** The definition of one track key. */
export function trackDefinition(key: TrackKey): TrackDefinition {
  const track = TRACKS.find((candidate) => candidate.key === key);
  if (track === undefined) {
    throw new RangeError(`unknown track key ${key}`);
  }
  return track;
}
