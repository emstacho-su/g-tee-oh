/**
 * Mocked catalog and study routes for the shots and mock projects (S25, R3.12, O-264): GET
 * /stakes, /configs, /configs/{id}/pairs, /study/node and /study/insights over the synthetic
 * fixtures in src/fixtures/study.ts.
 *
 * Mechanism: mockStudyRoute is a pure function of the request and the shared sign-in state. It
 * answers only GET requests on its five paths and returns undefined for everything else, so
 * createMockApi tries the next feature route. Signed out, each of its paths answers the 401
 * problem the api sends. Lists filter by the query parameters the api takes (format, table_size,
 * stake_id) and come back as one page ({ items, next_cursor: null }). A node is found by
 * (config_id, pair, line) in FIXTURE_STUDY_LINES; an unknown configuration, pair or line is a 404
 * not-found problem, as the api answers when the library holds no solution or a token runs past
 * the tree. Insights answer per hand, with the hand-not-in-range 404 for the one fixture hand
 * outside the range, and a 400 validation problem when a required parameter is missing.
 */
import {
  FIXTURE_OUT_OF_RANGE_HAND,
  FIXTURE_STUDY_LINES,
  findFixtureNode,
  fixtureConfigs,
  fixtureInsightsFor,
  fixturePairsByConfig,
  fixtureStakes,
} from "../../src/fixtures/study.js";
import { json, problem, UNAUTHENTICATED, type MockRequest, type MockResponse, type MockRoute, type ProblemSpec } from "./mock-api.js";

const OK = 200;
const PATHS = {
  stakes: "/api/v1/stakes",
  configs: "/api/v1/configs",
  node: "/api/v1/study/node",
  insights: "/api/v1/study/insights",
} as const;
const PAIRS_PATH = /^\/api\/v1\/configs\/([^/]+)\/pairs$/;

const NOT_FOUND: ProblemSpec = { status: 404, slug: "not-found", title: "Not found" };
const HAND_NOT_IN_RANGE: ProblemSpec = { status: 404, slug: "hand-not-in-range", title: "The hand is not in the range" };
const VALIDATION: ProblemSpec = { status: 400, slug: "validation", title: "Request validation failed" };

function page(items: readonly unknown[]): MockResponse {
  return json(OK, { items, next_cursor: null });
}

/** True when the query leaves the field unset or names exactly this value. */
function matches(query: MockRequest["query"], name: string, value: string | number): boolean {
  const asked = query[name];
  return asked === undefined || asked === String(value);
}

function stakes(request: MockRequest): MockResponse {
  return page(fixtureStakes.filter((stake) => matches(request.query, "format", stake.format)));
}

function configs(request: MockRequest): MockResponse {
  const { query } = request;
  return page(
    fixtureConfigs.filter(
      (config) =>
        matches(query, "format", config.format) &&
        matches(query, "table_size", config.table_size) &&
        matches(query, "stake_id", config.stake_id),
    ),
  );
}

function pairs(request: MockRequest, configId: string): MockResponse {
  const entries = fixturePairsByConfig[configId];
  return entries === undefined ? problem(NOT_FOUND, request.path) : page(entries);
}

function node(request: MockRequest): MockResponse {
  const { config_id: configId, pair, line } = request.query;
  if (configId === undefined || pair === undefined) return problem(VALIDATION, request.path);
  const found = findFixtureNode(configId, pair, line ?? "");
  return found === undefined ? problem(NOT_FOUND, request.path) : json(OK, found);
}

function insights(request: MockRequest): MockResponse {
  const { solution_id: solutionId, node_key: nodeKey, hand } = request.query;
  if (solutionId === undefined || nodeKey === undefined || hand === undefined) return problem(VALIDATION, request.path);
  const known = FIXTURE_STUDY_LINES.some((entry) => entry.node.solution_id === solutionId && entry.node.node_key === nodeKey);
  if (!known) return problem(NOT_FOUND, request.path);
  if (hand === FIXTURE_OUT_OF_RANGE_HAND) return problem(HAND_NOT_IN_RANGE, request.path);
  return json(OK, fixtureInsightsFor(hand));
}

function routeSignedIn(request: MockRequest): MockResponse | undefined {
  switch (request.path) {
    case PATHS.stakes:
      return stakes(request);
    case PATHS.configs:
      return configs(request);
    case PATHS.node:
      return node(request);
    case PATHS.insights:
      return insights(request);
    default: {
      const configId = PAIRS_PATH.exec(request.path)?.[1];
      return configId === undefined ? undefined : pairs(request, decodeURIComponent(configId));
    }
  }
}

function ownsPath(path: string): boolean {
  return Object.values<string>(PATHS).includes(path) || PAIRS_PATH.test(path);
}

export const mockStudyRoute: MockRoute = (request, context) => {
  if (request.method.toUpperCase() !== "GET" || !ownsPath(request.path)) return undefined;
  if (!context.signedIn) return problem(UNAUTHENTICATED, request.path);
  return routeSignedIn(request);
};
