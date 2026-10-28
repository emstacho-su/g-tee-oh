/**
 * Mocked S31 progress routes for the shots and mock projects (S32, R4.12, O-264): GET
 * /progress/rating, /tracks, /leaks, /heatmap, /holdout and /streak.
 *
 * Mechanism: createMockProgressRoute returns a route with one piece of state, the learner: "fresh"
 * (a new account, no rated session) or "seasoned" (eight weeks of history), both from the
 * contract-typed fixtures (src/fixtures/progress.ts). It checks what the api checks, in its order:
 * sign-in (401), then the leaks query (weeks an integer from 1 to 52, else 400 validation). The
 * leak series always answers the fixture's eight weeks, since the view only reads what it is
 * given. The returned control lets a mocked session end move the learner from fresh to seasoned,
 * which is what mock flow 1 checks on the rating card. Every other path returns undefined.
 */
import {
  fixtureFreshHeatmap,
  fixtureFreshHoldout,
  fixtureFreshLeaks,
  fixtureFreshRating,
  fixtureFreshStreak,
  fixtureFreshTracks,
  fixtureHeatmap,
  fixtureHoldout,
  fixtureLeaks,
  fixtureRating,
  fixtureStreak,
  fixtureTracks,
} from "../../src/fixtures/progress.js";
import { UNAUTHENTICATED, json, problem, type MockRoute, type ProblemSpec } from "./mock-api.js";

export type MockLearner = "fresh" | "seasoned";

export const PROGRESS_PATH_PREFIX = "/api/v1/progress/";
const STATUS_OK = 200;
const MIN_WEEKS = 1;
const MAX_WEEKS = 52;
const VALIDATION: ProblemSpec = { status: 400, slug: "validation", title: "Request validation failed" };

export interface MockProgress {
  readonly route: MockRoute;
  learner(): MockLearner;
  setLearner(learner: MockLearner): void;
}

function validWeeks(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (!/^\d{1,2}$/.test(value)) return false;
  const weeks = Number(value);
  return weeks >= MIN_WEEKS && weeks <= MAX_WEEKS;
}

function body(path: string, learner: MockLearner): unknown {
  const seasoned = learner === "seasoned";
  switch (path) {
    case "rating":
      return seasoned ? fixtureRating : fixtureFreshRating;
    case "tracks":
      return { items: [...(seasoned ? fixtureTracks : fixtureFreshTracks)], next_cursor: null };
    case "leaks":
      return seasoned ? fixtureLeaks : fixtureFreshLeaks;
    case "heatmap":
      return seasoned ? fixtureHeatmap : fixtureFreshHeatmap;
    case "holdout":
      return seasoned ? fixtureHoldout : fixtureFreshHoldout;
    case "streak":
      return seasoned ? fixtureStreak : fixtureFreshStreak;
    default:
      return undefined;
  }
}

export function createMockProgressRoute(initial: MockLearner = "seasoned"): MockProgress {
  let learner = initial;
  const route: MockRoute = (request, context) => {
    if (request.method !== "GET" || !request.path.startsWith(PROGRESS_PATH_PREFIX)) return undefined;
    const name = request.path.slice(PROGRESS_PATH_PREFIX.length);
    const answer = body(name, learner);
    if (answer === undefined) return undefined;
    if (!context.signedIn) return problem(UNAUTHENTICATED, request.path);
    if (name === "leaks" && !validWeeks(request.query["weeks"])) return problem(VALIDATION, request.path);
    return json(STATUS_OK, answer);
  };
  return {
    route,
    learner: () => learner,
    setLearner: (next) => {
      learner = next;
    },
  };
}
