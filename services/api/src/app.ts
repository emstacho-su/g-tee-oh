/**
 * Fastify application factory (R0.7, R3.1, ADR 0004, A5 sections 1 and 3). buildApp wires the Zod
 * type provider, the OpenAPI (Open Application Programming Interface) generator, the RFC 9457
 * problem handlers and every v1 route, and returns an instance that tests drive with app.inject
 * and main.ts binds to a port.
 *
 * The whole A5 section 3 surface is registered here (O-38): routes S21 builds and routes later
 * sessions build, the latter answering 501 problems until then (routes/planned.ts). The served
 * document is what the contracts job commits as packages/contracts/api.openapi.json.
 */
import fastifySwagger from "@fastify/swagger";
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from "fastify";
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";

import "./auth/session-context.js";
import { type AppConfig, defaultAppConfig } from "./config.js";
import type { Database } from "./db.js";
import "./http/database.js";
import { SECURITY_SCHEMES } from "./http/openapi.js";
import { problemErrorHandler, problemNotFoundHandler } from "./http/problem.js";
import { RATE_LIMIT_EXEMPT } from "./http/rate-limits.js";
import { serverOptions } from "./http/server-options.js";
import { authentication } from "./plugins/authenticate.js";
import { csrfGuard } from "./plugins/csrf.js";
import { idempotency } from "./plugins/idempotency.js";
import { security } from "./plugins/security.js";
import type { NotificationSource } from "./events/source.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { catalogRoutes } from "./routes/catalog.js";
import { coverageRoutes } from "./routes/coverage.js";
import { drillRoutes } from "./routes/drills.js";
import { eventRoutes } from "./routes/events.js";
import { healthzRoutes } from "./routes/healthz.js";
import { plannedRoutes } from "./routes/planned.js";
import { sessionRoutes } from "./routes/sessions.js";
import { studyRoutes } from "./routes/study.js";
import type { SolverQuery } from "./solver-query/client.js";
import { API_VERSION } from "./version.js";

export const API_PREFIX = "/api/v1";
export const OPENAPI_PATH = `${API_PREFIX}/openapi.json`;

const OPENAPI_VERSION = "3.1.0";
const OPENAPI_TITLE = "g-tee-oh api";

export type ApiApp = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  ZodTypeProvider
>;

export interface BuildAppOptions {
  /** Turns the pino logger on; off by default so tests stay quiet. */
  logger?: boolean;
  /** Origin, session lifetime and proxy trust; the dev profile's values when absent. */
  config?: AppConfig;
  /**
   * The Kysely handle the handlers use. Absent for the OpenAPI export and the HTTP-layer unit
   * tests: every route still registers, and a handler that needs the database answers 503.
   */
  database?: Database;
  /**
   * The solver-query client (S23, ADR 0004). Absent for the OpenAPI export and unit tests; a
   * handler that needs it then answers 503.
   */
  solverQuery?: SolverQuery;
  /**
   * Database notifications relayed over GET /events (S23, O-243). Absent for the OpenAPI export
   * and tests that do not open the stream; the stream then carries heartbeats only.
   */
  notifications?: NotificationSource;
}

export function buildApp(options: BuildAppOptions = {}): ApiApp {
  const config = options.config ?? defaultAppConfig();
  const app = Fastify(serverOptions(config, options.logger ?? false)).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(problemErrorHandler);
  app.setNotFoundHandler(problemNotFoundHandler);
  app.decorate("database", options.database ?? null);
  app.decorate("solverQuery", options.solverQuery ?? null);
  app.decorate("notifications", options.notifications ?? null);

  // Order matters: each plugin's hooks run in registration order, before any route below.
  void app.register(security, { config });
  void app.register(authentication);
  void app.register(csrfGuard, { config });
  void app.register(idempotency);

  void app.register(fastifySwagger, {
    openapi: {
      openapi: OPENAPI_VERSION,
      info: { title: OPENAPI_TITLE, version: API_VERSION },
      components: { securitySchemes: SECURITY_SCHEMES },
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  void app.register(healthzRoutes, { prefix: API_PREFIX, documented: true });
  void app.register(healthzRoutes, { documented: false });
  void app.register(authRoutes, { prefix: API_PREFIX, config });
  void app.register(catalogRoutes, { prefix: API_PREFIX });
  void app.register(drillRoutes, { prefix: API_PREFIX });
  void app.register(studyRoutes, { prefix: API_PREFIX, config });
  void app.register(coverageRoutes, { prefix: API_PREFIX, config });
  void app.register(sessionRoutes, { prefix: API_PREFIX, config });
  void app.register(eventRoutes, { prefix: API_PREFIX, config });
  void app.register(adminRoutes, { prefix: API_PREFIX, config });
  void app.register(plannedRoutes, { prefix: API_PREFIX });

  // The document describes the routes above; it does not describe itself.
  app.get(
    OPENAPI_PATH,
    { config: { auth: "none", rateLimit: RATE_LIMIT_EXEMPT }, schema: { hide: true } },
    () => app.swagger(),
  );

  return app;
}
