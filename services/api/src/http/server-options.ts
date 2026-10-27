/**
 * Fastify server options (R3.1, A9 section 3): the request body limit, the proxy trust for Caddy
 * (O-236), the request id taken from a well-formed x-request-id or generated, and the pino
 * logger with secrets redacted.
 *
 * S21 lane C completes the request id and redaction parts; the limits are fixed here.
 */
import type { FastifyServerOptions } from "fastify";

import type { AppConfig } from "../config.js";

/** 64 KiB: the largest body v1 accepts (a drill is a few KiB). */
export const BODY_LIMIT_BYTES = 64 * 1024;

export function serverOptions(config: AppConfig, logger: boolean): FastifyServerOptions {
  return {
    logger,
    bodyLimit: BODY_LIMIT_BYTES,
    // Trust the nearest trustProxyHops proxies (Caddy is one), so request.ip is the client's address.
    trustProxy: (_address: string, hop: number) => hop < config.trustProxyHops,
  };
}
