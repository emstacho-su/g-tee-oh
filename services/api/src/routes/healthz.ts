/**
 * Health route (R0.7, A5 section 3). Registered twice by app.ts: documented under the /api/v1
 * prefix for clients, and hidden at the root as the container probe alias. The Zod response
 * schema is what fastify-type-provider-zod turns into the OpenAPI (Open Application
 * Programming Interface) document, so the committed contract and the served JSON cannot drift.
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { RATE_LIMIT_EXEMPT } from "../http/rate-limits.js";
import "../http/route-config.js";
import { API_SERVICE_NAME, API_VERSION } from "../version.js";

export const HEALTHZ_PATH = "/healthz";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal(API_SERVICE_NAME),
  version: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export interface HealthzRouteOptions {
  /** false keeps the route out of the OpenAPI document (the container probe alias). */
  documented: boolean;
}

export function healthResponse(): HealthResponse {
  return { status: "ok", service: API_SERVICE_NAME, version: API_VERSION };
}

export const healthzRoutes: FastifyPluginCallbackZod<HealthzRouteOptions> = (app, options, done) => {
  app.get(
    HEALTHZ_PATH,
    {
      // A probe: no session, and exempt from the global rate limit (O-236).
      config: { auth: "none", rateLimit: RATE_LIMIT_EXEMPT },
      schema: {
        hide: !options.documented,
        summary: "Liveness probe",
        response: { 200: healthResponseSchema },
      },
    },
    () => healthResponse(),
  );
  done();
};
