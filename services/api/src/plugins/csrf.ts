/**
 * CSRF (cross-site request forgery) guard on mutating routes (R3.1, A9 section 3, O-230): the
 * Origin check on every mutating route and the per-session x-csrf-token check where the route
 * policy is "token" (route-config.ts). Registered after authentication, so request.session is set.
 *
 * S21 lane C fills this in; until then it installs nothing.
 */
import type { FastifyInstance } from "fastify";
import fastifyPlugin from "fastify-plugin";

import type { AppConfig } from "../config.js";

export interface CsrfOptions {
  config: AppConfig;
}

async function csrfPlugin(app: FastifyInstance, options: CsrfOptions): Promise<void> {
  await Promise.resolve([app, options]);
}

export const csrfGuard = fastifyPlugin(csrfPlugin, { name: "g-tee-oh-csrf" });
