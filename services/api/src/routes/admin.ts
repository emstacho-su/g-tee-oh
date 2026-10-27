/**
 * Admin builder routes (R3.5, O-36, O-242): GET /admin/builder, PATCH /admin/builder/settings,
 * POST /admin/builder/pause and POST /admin/builder/resume. Lane C of S23 builds them; until then
 * they answer 501 problems through the S21 planned-route table.
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { registerPlannedRoutes, S23_STUBS } from "./planned.js";
import type { ConfiguredRouteOptions } from "./route-options.js";

export const adminRoutes: FastifyPluginCallbackZod<ConfiguredRouteOptions> = (app, _options, done) => {
  registerPlannedRoutes(app, S23_STUBS.admin);
  done();
};
