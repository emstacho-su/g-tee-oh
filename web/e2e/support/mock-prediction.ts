/**
 * Mocked S27 routes for the shots and mock projects (S27 lane A, R3.16, O-264): GET /prediction/{session}/next and POST /prediction/{session}/answer.
 * Scaffold: answers nothing yet, so createMockApi tries the next route; lane A fills it with
 * stateful, pure responses over the contract-typed fixtures.
 */
import type { MockRoute } from "./mock-api.js";

export function createMockPredictionRoute(): MockRoute {
  return () => undefined;
}
