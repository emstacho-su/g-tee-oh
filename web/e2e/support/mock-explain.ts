/**
 * Mocked S27 routes for the shots and mock projects (S27 lane D, R3.19, R3.20, O-264): GET /explain/status, GET /explain/{attempt_id}/more-info and POST /explain/{attempt_id}/ask.
 * Scaffold: answers nothing yet, so createMockApi tries the next route; lane D fills it with
 * stateful, pure responses over the contract-typed fixtures.
 */
import type { MockRoute } from "./mock-api.js";

export function createMockExplainRoute(): MockRoute {
  return () => undefined;
}
