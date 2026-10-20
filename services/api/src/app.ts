/**
 * Fastify application factory (R0.7, ADR 0004, A5 section 1). buildApp wires the Zod type
 * provider, the OpenAPI (Open Application Programming Interface) generator and the routes, and
 * returns an instance that tests drive with app.inject and main.ts binds to a port.
 *
 * Security middleware (helmet, cors, rate limiting, CSRF (cross-site request forgery)
 * protection) is deliberately out of scope for this skeleton: R3.1 in session S21 adds it
 * together with the first authenticated routes. Until then the only surface is the health probe
 * and this document.
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
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";

import { healthzRoutes } from "./routes/healthz.js";
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

  void app.register(fastifySwagger, {
    openapi: {
      openapi: OPENAPI_VERSION,
      info: { title: OPENAPI_TITLE, version: API_VERSION },
    },
    transform: jsonSchemaTransform,
  });

  void app.register(healthzRoutes, { prefix: API_PREFIX, documented: true });
  void app.register(healthzRoutes, { documented: false });

  // The document describes the routes above; it does not describe itself.
  app.get(OPENAPI_PATH, { schema: { hide: true } }, () => app.swagger());

  return app;
}
