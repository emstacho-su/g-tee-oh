/**
 * Mocked S27 insight routes for the shots and mock projects (S27 lane C, R3.18, O-264, O-304):
 * GET /insights/drift.
 *
 * Mechanism: createMockInsightsRoute returns a pure route checking what the api checks, in its
 * order: sign-in (401), then the query (spot_class_key of 1 to 128 characters, else 400
 * validation). It answers the shown fixture drift for the fixture spot class
 * (FIXTURE_SPOT_CLASS_KEY, the spot class of fixtureFeedback, so the feedback panel in the shots
 * shows a drift table) and a hidden drift for any other class. Every other path or method returns
 * undefined, so createMockApi tries the next route. Bodies come from the contract-typed fixtures
 * (src/fixtures/insights.ts). Drift only reads, so the route keeps no state.
 */
import { fixtureDriftFor } from "../../src/fixtures/insights.js";
import { UNAUTHENTICATED, json, problem, type MockRoute, type ProblemSpec } from "./mock-api.js";

export const DRIFT_PATH = "/api/v1/insights/drift";
/** The api's limit on spot_class_key (services/api schemas/explain.ts SPOT_CLASS_KEY_MAX_CHARS). */
export const MOCK_SPOT_CLASS_KEY_MAX_CHARS = 128;
const STATUS_OK = 200;
const VALIDATION: ProblemSpec = { status: 400, slug: "validation", title: "Request validation failed" };

function validSpotClassKey(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && value.length <= MOCK_SPOT_CLASS_KEY_MAX_CHARS;
}

export function createMockInsightsRoute(): MockRoute {
  return (request, context) => {
    if (request.method !== "GET" || request.path !== DRIFT_PATH) return undefined;
    if (!context.signedIn) return problem(UNAUTHENTICATED, request.path);
    const spotClassKey = request.query["spot_class_key"];
    if (!validSpotClassKey(spotClassKey)) return problem(VALIDATION, request.path);
    return json(STATUS_OK, fixtureDriftFor(spotClassKey));
  };
}
