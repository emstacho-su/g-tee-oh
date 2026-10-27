/**
 * Training session routes (R3.6, R3.7): POST /sessions, GET /sessions/{id}/next,
 * POST /sessions/{id}/decisions and POST /sessions/{id}/end. Lane B of S23 builds them; until
 * then they answer 501 problems through the S21 planned-route table.
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { registerPlannedRoutes, S23_STUBS } from "./planned.js";
import type { ConfiguredRouteOptions } from "./route-options.js";

export const sessionRoutes: FastifyPluginCallbackZod<ConfiguredRouteOptions> = (app, _options, done) => {
  registerPlannedRoutes(app, S23_STUBS.sessions);
  done();
};
