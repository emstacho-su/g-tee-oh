/**
 * Glicko-2 rating per track with fractional outcomes (A6 section 1 row "Glicko-2 per track
 * (fractional outcomes)"; 06 section 3.3). Owner: S30 (p4/learning), closing R4.1 (the update,
 * proven by Glickman's worked example), R4.2 (the simulated learner within 25 rating points after
 * 300 items, O-65) and R4.3 (anti-farming, with S22's rated flag).
 *
 * Parameters per ADR 0011, accepted at sprint start (O-56): new track at rating 1500, rating
 * deviation (RD) 350, volatility 0.06; system constant tau 0.5; one rating period per session
 * (O-27); inactivity raises RD and never subtracts points; ranking uses rating minus two RD. The
 * outcome of a decision is its score in [0, 1] from the grading policy (05 section 6.3), an
 * extension of the paper's 0, 0.5 and 1 that R4.2 verifies by simulation (risk R-7).
 *
 * Mechanism: ratePeriod follows Glickman's "Example of the Glicko-2 system", steps 1 to 8. Ratings
 * move to the internal scale (mu, phi) by GLICKO2_SCALE; v and delta sum each result's terms times
 * its weight (default 1, O-251); the new volatility is the root of the paper's f(x), found by the
 * Illinois variant of regula falsi to GLICKO2_EPSILON; then phi and mu update and convert back. A
 * period with no weighted result is the inactivity step: RD becomes sqrt(phi^2 + sigma^2) on the
 * internal scale, rating and volatility unchanged. rateSession turns one session's graded
 * decisions into one period: only rated decisions with weight above 0 enter, each against an
 * opponent at the item's difficulty with ITEM_RD 0 (O-250); a session with none leaves the track
 * identical (O-251). Every function validates at the boundary and returns a new frozen object.
 */
import { requireBoolean, requireFinite, requireList, requireNonNegative, requireUnitInterval } from "./validate.js";

/** A track's Glicko-2 state on the Glicko scale. */
export type TrackRating = Readonly<{ rating: number; rd: number; volatility: number }>;

/** The other side of one result: a rating and its RD on the Glicko scale. */
export type Opponent = Readonly<{ rating: number; rd: number }>;

/** One result of a period: score in [0, 1], weight multiplying its terms in v and delta (default 1). */
export type PeriodResult = Readonly<{ opponent: Opponent; score: number; weight?: number }>;

/** One graded decision of a session, as grade() and the item's difficulty describe it. */
export type SessionDecision = Readonly<{ difficulty: number; score: number; rated: boolean; weight: number }>;

/** Starting state of a new track (06 section 3.3, ADR 0011, O-56). */
export const GLICKO2_DEFAULTS: TrackRating = Object.freeze({ rating: 1500, rd: 350, volatility: 0.06 });

/**
 * Ceiling inactivity can raise RD to: the starting RD of a new track, as in standard Glicko
 * practice, so an idle track is never less certain than a newcomer (O-259). Rating periods with
 * results are not capped; they shrink RD.
 */
export const GLICKO2_MAX_RD = GLICKO2_DEFAULTS.rd;

/** System constant tau, which limits how fast volatility moves (ADR 0011, O-56). */
export const GLICKO2_TAU = 0.5;

/** Conversion factor between the Glicko scale and the internal Glicko-2 scale (paper, step 2). */
export const GLICKO2_SCALE = 173.7178;

/** Convergence tolerance of the volatility iteration (paper, step 5). */
export const GLICKO2_EPSILON = 1e-6;

/** RD of an item opponent: the item's difficulty is treated as exact (O-250). */
export const ITEM_RD = 0;

/** Days of inactivity that make one empty rating period (O-251). */
export const INACTIVITY_PERIOD_DAYS = 7;

/** The rating at the centre of the scale, which maps to mu 0 (paper, step 2). */
const CENTER_RATING = 1500;

/** Weight of a result that names none (O-251). */
const DEFAULT_RESULT_WEIGHT = 1;

/** RDs subtracted from the rating for the conservative figure ranking uses (06 section 3.3). */
const CONSERVATIVE_RD_MULTIPLE = 2;

/** One result on the internal scale with its g and E (paper, step 3). */
type ScaledResult = Readonly<{ g: number; e: number; score: number; weight: number }>;

function validatePlayer(player: TrackRating): void {
  requireFinite(player.rating, "rating");
  requireNonNegative(player.rd, "rd");
  if (!(Number.isFinite(player.volatility) && player.volatility > 0)) {
    throw new RangeError(`volatility must be a finite number above 0, got ${player.volatility}`);
  }
}

function validateResult(result: PeriodResult, field: string): void {
  requireFinite(result.opponent.rating, `${field}.opponent.rating`);
  requireNonNegative(result.opponent.rd, `${field}.opponent.rd`);
  requireUnitInterval(result.score, `${field}.score`);
  requireNonNegative(result.weight ?? DEFAULT_RESULT_WEIGHT, `${field}.weight`);
}

/** g(phi) = 1 / sqrt(1 + 3 phi^2 / pi^2) (paper, step 3). */
function gOf(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function scaleResult(mu: number, result: PeriodResult): ScaledResult {
  const g = gOf(result.opponent.rd / GLICKO2_SCALE);
  const muOpponent = (result.opponent.rating - CENTER_RATING) / GLICKO2_SCALE;
  const e = 1 / (1 + Math.exp(-g * (mu - muOpponent)));
  return { g, e, score: result.score, weight: result.weight ?? DEFAULT_RESULT_WEIGHT };
}

/**
 * The new volatility sigma' (paper, step 5): the root of f(x) = e^x (delta^2 - phi^2 - v - e^x) /
 * (2 (phi^2 + v + e^x)^2) - (x - a) / tau^2 with a = ln(sigma^2), by the Illinois algorithm.
 */
function newVolatility(sigma: number, phi: number, v: number, delta: number, tau: number): number {
  const a = Math.log(sigma * sigma);
  const phiSquared = phi * phi;
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const denominator = phiSquared + v + ex;
    return (ex * (delta * delta - phiSquared - v - ex)) / (2 * denominator * denominator) - (x - a) / (tau * tau);
  };
  let lower = a;
  let upper = initialUpperBound(a, f, delta * delta - phiSquared - v, tau);
  let fLower = f(lower);
  let fUpper = f(upper);
  while (Math.abs(upper - lower) > GLICKO2_EPSILON) {
    const candidate = lower + ((lower - upper) * fLower) / (fUpper - fLower);
    const fCandidate = f(candidate);
    if (fCandidate * fUpper <= 0) {
      lower = upper;
      fLower = fUpper;
    } else {
      fLower = fLower / 2;
    }
    upper = candidate;
    fUpper = fCandidate;
  }
  return Math.exp(lower / 2);
}

/** The second bracket end B of step 5: ln(delta^2 - phi^2 - v) when positive, else a - k tau. */
function initialUpperBound(a: number, f: (x: number) => number, surplus: number, tau: number): number {
  if (surplus > 0) {
    return Math.log(surplus);
  }
  let k = 1;
  while (f(a - k * tau) < 0) {
    k += 1;
  }
  return a - k * tau;
}

/**
 * The inactivity step on the Glicko scale: RD^2 grows by (volatility x scale)^2 per period, up to
 * GLICKO2_MAX_RD (O-259). A track already above the ceiling keeps its RD: inactivity never lowers it.
 */
function inactiveRd(player: TrackRating, periods: number): number {
  const volatilityOnScale = player.volatility * GLICKO2_SCALE;
  const grown = Math.sqrt(player.rd * player.rd + periods * volatilityOnScale * volatilityOnScale);
  return Math.min(grown, Math.max(player.rd, GLICKO2_MAX_RD));
}

function withRd(player: TrackRating, rd: number): TrackRating {
  return Object.freeze({ rating: player.rating, rd, volatility: player.volatility });
}

/** One result's term of the information sum 1 / v (paper, step 3). */
function informationOf(result: ScaledResult): number {
  return result.weight * result.g * result.g * result.e * (1 - result.e);
}

/**
 * Steps 3 to 8 over results with a positive weight. A result whose information underflows to 0
 * (an opponent thousands of points away, so E is exactly 0 or 1 in a double) says nothing about
 * the player and is skipped; when every result is like that the player comes back unchanged, so
 * a session never loses its update to an error.
 */
function updateWithResults(player: TrackRating, scaled: readonly ScaledResult[], tau: number): TrackRating {
  const results = scaled.filter((result) => informationOf(result) > 0);
  if (results.length === 0) {
    return withRd(player, player.rd);
  }
  const mu = (player.rating - CENTER_RATING) / GLICKO2_SCALE;
  const phi = player.rd / GLICKO2_SCALE;
  const information = results.reduce((sum, result) => sum + informationOf(result), 0);
  const v = 1 / information;
  const improvement = results.reduce((sum, r) => sum + r.weight * r.g * (r.score - r.e), 0);
  const sigma = newVolatility(player.volatility, phi, v, v * improvement, tau);
  const phiStar = Math.sqrt(phi * phi + sigma * sigma);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * improvement;
  return Object.freeze({
    rating: GLICKO2_SCALE * muNew + CENTER_RATING,
    rd: GLICKO2_SCALE * phiNew,
    volatility: sigma,
  });
}

/** A new track at the defaults (ADR 0011, O-56). */
export function newTrackRating(): TrackRating {
  return Object.freeze({ ...GLICKO2_DEFAULTS });
}

/**
 * One Glicko-2 rating period (paper, steps 1 to 8). Results with weight 0 are dropped; when none
 * remain the period is the inactivity step. Throws a RangeError naming the field on a non-finite
 * rating, a negative RD, a volatility at or below 0, a score outside [0, 1], a negative weight or a
 * tau at or below 0. Results too far from the player to carry information are skipped, and a
 * period of only such results leaves the player unchanged.
 */
export function ratePeriod(player: TrackRating, results: readonly PeriodResult[], tau: number = GLICKO2_TAU): TrackRating {
  validatePlayer(player);
  requireList(results, "results");
  results.forEach((result, index) => validateResult(result, `results[${index}]`));
  if (!(Number.isFinite(tau) && tau > 0)) {
    throw new RangeError(`tau must be a finite number above 0, got ${tau}`);
  }
  const mu = (player.rating - CENTER_RATING) / GLICKO2_SCALE;
  const weighted = results
    .filter((result) => (result.weight ?? DEFAULT_RESULT_WEIGHT) > 0)
    .map((result) => scaleResult(mu, result));
  return weighted.length === 0 ? withRd(player, inactiveRd(player, 1)) : updateWithResults(player, weighted, tau);
}

/** periods empty rating periods at once: RD grows, rating and volatility never move (06 section 3.3). */
export function applyInactivity(player: TrackRating, periods: number): TrackRating {
  validatePlayer(player);
  if (!Number.isInteger(periods) || periods < 0) {
    throw new RangeError(`periods must be an integer at or above 0, got ${periods}`);
  }
  return withRd(player, inactiveRd(player, periods));
}

/** Whole empty periods since the track's last rated session: floor(days / 7) (O-251). */
export function inactivePeriods(daysSinceLastRatedSession: number): number {
  return Math.floor(requireNonNegative(daysSinceLastRatedSession, "daysSinceLastRatedSession") / INACTIVITY_PERIOD_DAYS);
}

function validateDecision(decision: SessionDecision, field: string): void {
  requireFinite(decision.difficulty, `${field}.difficulty`);
  requireUnitInterval(decision.score, `${field}.score`);
  requireBoolean(decision.rated, `${field}.rated`);
  requireNonNegative(decision.weight, `${field}.weight`);
}

/**
 * One session as one rating period (O-27). Only rated decisions with weight above 0 enter, each a
 * result against an opponent at the item's difficulty with ITEM_RD (O-250); with none the track
 * comes back identical, rating, RD and volatility alike (O-251). Participation, time and streaks
 * have no field here, so they cannot earn points (06 section 3.6 rule 6).
 */
export function rateSession(player: TrackRating, decisions: readonly SessionDecision[]): TrackRating {
  validatePlayer(player);
  requireList(decisions, "decisions");
  decisions.forEach((decision, index) => validateDecision(decision, `decisions[${index}]`));
  const results: PeriodResult[] = decisions
    .filter((decision) => decision.rated && decision.weight > 0)
    .map((decision) => ({
      opponent: { rating: decision.difficulty, rd: ITEM_RD },
      score: decision.score,
      weight: decision.weight,
    }));
  return results.length === 0 ? withRd(player, player.rd) : ratePeriod(player, results);
}

/** The conservative figure ranking uses: rating minus two RD (06 section 3.3). */
export function conservativeRating(rating: TrackRating): number {
  validatePlayer(rating);
  return rating.rating - CONSERVATIVE_RD_MULTIPLE * rating.rd;
}
