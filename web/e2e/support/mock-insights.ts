/**
 * Mocked S27 routes for the shots and mock projects (S27 lane C, R3.18, O-264): GET /insights/drift.
 * Scaffold: answers nothing yet, so createMockApi tries the next route; lane C fills it with
 * stateful, pure responses over the contract-typed fixtures.
 */
import type { MockRoute } from "./mock-api.js";

export function createMockInsightsRoute(): MockRoute {
  return () => undefined;
}
