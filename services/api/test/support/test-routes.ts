/**
 * Test-only routes for the cross-cutting hook tests (R3.1, A5 section 3, A9 section 3).
 *
 * Mechanism: the security, authentication, CSRF (cross-site request forgery) and idempotency
 * plugins are fastify-plugin plugins, so their hooks live on the root instance and apply to every
 * route registered after them, including routes registered in an encapsulated child plugin. A test
 * builds the real app, registers its routes under TEST_PREFIX through withTestRoutes before
 * app.ready(), and so exercises the hooks exactly as the production routes meet them, without
 * depending on handlers other sessions are still writing.
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

import type { ApiApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config.js";
import type { Database } from "../../src/db.js";
import { buildTestApp, TEST_CONFIG } from "./app.js";

export const TEST_PREFIX = "/api/v1/__test";

/** Counts how often a test handler ran, so a test can prove a side effect happened once. */
export class SideEffectCounter {
  #count = 0;

  increment(): number {
    this.#count += 1;
    return this.#count;
  }

  get count(): number {
    return this.#count;
  }
}

/** Builds the app with the given test routes registered after every app plugin. */
export function buildAppWithTestRoutes(
  database: Database,
  routes: FastifyPluginAsyncZod,
  config: AppConfig = TEST_CONFIG,
): ApiApp {
  const app = buildTestApp(database, config);
  void app.register(routes, { prefix: TEST_PREFIX });
  return app;
}
