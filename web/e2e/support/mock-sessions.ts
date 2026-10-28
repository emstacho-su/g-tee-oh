/**
 * Mocked drill and session routes for the shots and mock projects (S25, R3.13, O-264): GET
 * /drills/{id}, POST /sessions, GET /sessions/{id}/next, POST /sessions/{id}/decisions and POST
 * /sessions/{id}/end over the synthetic fixtures in src/fixtures/trainer.ts.
 * SCAFFOLD: Lane B implements the routes.
 */
import type { MockRoute } from "./mock-api.js";

export const mockSessionRoute: MockRoute = () => undefined;
