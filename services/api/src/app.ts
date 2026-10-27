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

import { SECURITY_SCHEMES } from "./http/openapi.js";
import { problemErrorHandler, problemNotFoundHandler } from "./http/problem.js";
import { RATE_LIMIT_EXEMPT } from "./http/rate-limits.js";
import { authRoutes } from "./routes/auth.js";
import { catalogRoutes } from "./routes/catalog.js";
import { drillRoutes } from "./routes/drills.js";
import { healthzRoutes } from "./routes/healthz.js";
import { plannedRoutes } from "./routes/planned.js";
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
}

export function buildApp(options: BuildAppOptions = {}): ApiApp {
  const app = Fastify({ logger: options.logger ?? false }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(problemErrorHandler);
  app.setNotFoundHandler(problemNotFoundHandler);

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
  void app.register(authRoutes, { prefix: API_PREFIX });
  void app.register(catalogRoutes, { prefix: API_PREFIX });
  void app.register(drillRoutes, { prefix: API_PREFIX });
  void app.register(plannedRoutes, { prefix: API_PREFIX });

  // The document describes the routes above; it does not describe itself.
  app.get(
    OPENAPI_PATH,
    { config: { auth: "none", rateLimit: RATE_LIMIT_EXEMPT }, schema: { hide: true } },
    () => app.swagger(),
  );

  return app;
}
