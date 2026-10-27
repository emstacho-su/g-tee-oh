/**
 * Study routes (R3.3): GET /study/node and GET /study/insights over solver-query. Lane A of S23
 * builds them; until then they answer 501 problems through the S21 planned-route table.
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { registerPlannedRoutes, S23_STUBS } from "./planned.js";
import type { ConfiguredRouteOptions } from "./route-options.js";

export const studyRoutes: FastifyPluginCallbackZod<ConfiguredRouteOptions> = (app, _options, done) => {
  registerPlannedRoutes(app, S23_STUBS.study);
  done();
};
