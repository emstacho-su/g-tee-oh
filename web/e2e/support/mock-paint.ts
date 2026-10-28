/**
 * Mocked S27 routes for the shots and mock projects (S27 lane B, R3.17, O-264): GET /range-paint/{session}/next and POST /range-paint/submit.
 * Scaffold: answers nothing yet, so createMockApi tries the next route; lane B fills it with
 * stateful, pure responses over the contract-typed fixtures.
 */
import type { MockRoute } from "./mock-api.js";

export function createMockPaintRoute(): MockRoute {
  return () => undefined;
}
