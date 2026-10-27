/**
 * Request-level security controls (R3.1, A9 section 3): helmet headers, CORS (cross-origin
 * resource sharing) locked to the app origin, the global and login rate limits (O-236).
 *
 * S21 lane C fills this in; until then it installs nothing.
 */
import type { FastifyInstance } from "fastify";
import fastifyPlugin from "fastify-plugin";

import type { AppConfig } from "../config.js";

export interface SecurityOptions {
  config: AppConfig;
}

async function securityPlugin(app: FastifyInstance, options: SecurityOptions): Promise<void> {
  await Promise.resolve([app, options]);
}

export const security = fastifyPlugin(securityPlugin, { name: "g-tee-oh-security" });
