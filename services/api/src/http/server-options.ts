/**
 * Fastify server options (R3.1, A9 section 3, O-158, O-236): the request body limit, the proxy
 * trust (by address, config.trustedProxies: X-Forwarded-For counts only when the connection comes
 * from a trusted proxy such as Caddy), the request id and the pino logger with secrets redacted.
 *
 * Mechanism: Fastify's built-in x-request-id handling is turned off (requestIdHeader false), so
 * genReqId alone decides the id. It keeps an incoming x-request-id only when it matches
 * REQUEST_ID_PATTERN (letters, digits, dot, underscore, colon, hyphen; 1 to 128 characters), which
 * lets a caller correlate its own logs (O-158) without being able to inject line breaks, markup or
 * oversized values into ours; anything else gets a random UUID. The security plugin echoes the id
 * on every response. When logging is on, pino redacts the cookie, the CSRF (cross-site request
 * forgery) token, authorization and set-cookie wherever a request or response is logged, so a
 * session never reaches a log file. S27 adds the model SDK's auth headers (x-api-key and
 * authorization, at the request and the bare headers path) so a model key could not reach one either
 * (O-305); the api never logs an outbound request, a prompt or an answer. A test may pass its own
 * log destination to capture lines.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import type { FastifyServerOptions } from "fastify";

import type { AppConfig } from "../config.js";
import { REQUEST_ID_HEADER } from "./headers.js";

/** 64 KiB: the largest body v1 accepts (a drill is a few KiB). */
export const BODY_LIMIT_BYTES = 64 * 1024;

/** A caller-supplied request id we are willing to log and echo. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** Log paths pino replaces with REDACTED_VALUE. */
export const REDACTED_LOG_PATHS: readonly string[] = [
  "req.headers.cookie",
  'req.headers["x-csrf-token"]',
  "req.headers.authorization",
  // The model SDK's auth headers (S27, O-305): never logged by the api, redacted should one ever be.
  'req.headers["x-api-key"]',
  'headers["x-api-key"]',
  "headers.authorization",
  'res.headers["set-cookie"]',
];
export const REDACTED_VALUE = "[redacted]";

/** The request id: the caller's x-request-id when well formed, else a random UUID. */
export function requestIdFor(request: Pick<IncomingMessage, "headers">): string {
  const incoming = request.headers[REQUEST_ID_HEADER];
  return typeof incoming === "string" && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
}

/** A destination for log lines (pino's DestinationStream shape); stdout when none is given. */
export interface LogStream {
  write(message: string): void;
}

function loggerOptions(logging: boolean, stream: LogStream | undefined): NonNullable<FastifyServerOptions["logger"]> {
  if (!logging) {
    return false;
  }
  const redact = { paths: [...REDACTED_LOG_PATHS], censor: REDACTED_VALUE };
  return stream === undefined ? { redact } : { redact, stream };
}

export function serverOptions(config: AppConfig, logging: boolean, stream?: LogStream): FastifyServerOptions {
  return {
    logger: loggerOptions(logging, stream),
    bodyLimit: BODY_LIMIT_BYTES,
    // Trust X-Forwarded-For only from the configured proxy addresses (O-236), never from a direct client.
    trustProxy: [...config.trustedProxies],
    requestIdHeader: false,
    genReqId: requestIdFor,
  };
}
