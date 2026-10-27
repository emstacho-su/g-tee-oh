/**
 * Server-sent events (R3.4, A4 section 4, O-243): GET /events. Lane C of S23 builds it; until
 * then it answers a 501 problem through the S21 planned-route table.
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { registerPlannedRoutes, S23_STUBS } from "./planned.js";
import type { ConfiguredRouteOptions } from "./route-options.js";

export const eventRoutes: FastifyPluginCallbackZod<ConfiguredRouteOptions> = (app, _options, done) => {
  registerPlannedRoutes(app, S23_STUBS.events);
  done();
};
