/**
 * Coverage routes (R3.4, ADR 0018): GET /coverage and POST /coverage/requests. Lane A of S23
 * builds them; until then they answer 501 problems through the S21 planned-route table.
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { registerPlannedRoutes, S23_STUBS } from "./planned.js";
import type { ConfiguredRouteOptions } from "./route-options.js";

export const coverageRoutes: FastifyPluginCallbackZod<ConfiguredRouteOptions> = (app, _options, done) => {
  registerPlannedRoutes(app, S23_STUBS.coverage);
  done();
};
