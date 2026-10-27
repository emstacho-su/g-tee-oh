/**
 * Idempotency-Key handling on mutating routes (R3.1, A5 section 3, O-232): claim, run once,
 * store, replay. Registered after authentication and the CSRF (cross-site request forgery) guard.
 *
 * Mechanism: a preHandler hook (after validation, so the parsed body is what gets hashed) acts on
 * POST, PUT, PATCH and DELETE routes whose policy does not set idempotent false, when the request
 * has a session and an Idempotency-Key header. The key is checked against IDEMPOTENCY_KEY_PATTERN
 * even when the route schema already did. The request hash covers the method, the route pattern,
 * the params and the canonical JSON of the body (canonical-json.ts). claimKey (idempotency-store.ts)
 * then decides: claimed, so the claim is put on request.idempotencyClaim and the handler runs; a
 * different request under the same key, a 422 idempotency-mismatch problem; the first request
 * still running, a 409 idempotency-in-flight problem; or a replay of the stored status and body
 * with idempotent-replayed: true, sent as stored JSON text so the route's serializer never
 * reshapes it (204 has no body).
 *
 * A handler with a side effect writes through idempotentWrite (http/idempotent-write.ts), which
 * stores the response in the same transaction as the side effect: once the write commits, the
 * stored response exists, so a later failure (a reply that cannot be sent, a store call that
 * fails) can never free the key and let a retry write twice. For every other claimed request the
 * response is settled in onSend: a status below 500 is stored, 500 or above releases the claim so
 * a retry can run. Store and release match the claim token and a null status, so after an
 * in-transaction store both are no-ops. onResponse is the safety net that releases a claim still
 * unsettled (onSend failed, or never ran). Keys belong to the session user, so two users may use
 * the same key.
 */
import "fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyPlugin from "fastify-plugin";

import { requestHash } from "../http/canonical-json.js";
import { requireDatabase } from "../http/database.js";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_KEY_PATTERN, IDEMPOTENCY_REPLAYED_HEADER } from "../http/headers.js";
import { HTTP_STATUS, PROBLEM_CONTENT_TYPE, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { isMutatingMethod } from "../http/route-config.js";
import { claimKey, completeKey, type IdempotencyClaim, releaseKey } from "./idempotency-store.js";

declare module "fastify" {
  interface FastifyRequest {
    /** The Idempotency-Key claim this request owns, or null when the hooks do not apply. */
    idempotencyClaim: IdempotencyClaim | null;
  }
}

const JSON_CONTENT_TYPE = "application/json";

/** The Idempotency-Key of a request the hooks apply to, or undefined when they do not apply. */
function idempotencyKeyOf(request: FastifyRequest): string | undefined {
  if (request.is404 || !isMutatingMethod(request.method) || request.session === null) {
    return undefined;
  }
  if (request.routeOptions.config.idempotent === false) {
    return undefined;
  }
  const key = request.headers[IDEMPOTENCY_HEADER];
  if (key === undefined) {
    return undefined;
  }
  if (typeof key !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.validation, {
      errors: [{ path: `headers.${IDEMPOTENCY_HEADER}`, message: "1 to 255 visible ASCII characters" }],
    });
  }
  return key;
}

function sendReplay(reply: FastifyReply, statusCode: number, body: unknown): FastifyReply {
  reply.code(statusCode).header(IDEMPOTENCY_REPLAYED_HEADER, "true");
  if (statusCode === HTTP_STATUS.noContent || body === null || body === undefined) {
    return reply.send();
  }
  const contentType = statusCode >= HTTP_STATUS.badRequest ? PROBLEM_CONTENT_TYPE : JSON_CONTENT_TYPE;
  return reply.type(contentType).send(JSON.stringify(body));
}

/** The response body as JSON text, null for no body; undefined when it is not JSON at all. */
function payloadJson(payload: unknown): string | null | undefined {
  if (payload === null || payload === undefined || payload === "") {
    return null;
  }
  const text = typeof payload === "string" ? payload : Buffer.isBuffer(payload) ? payload.toString("utf8") : undefined;
  if (text === undefined) {
    return undefined;
  }
  try {
    JSON.parse(text);
    return text;
  } catch {
    // Not JSON (the caller logs and releases the claim); the parse error itself carries nothing more.
    return undefined;
  }
}

async function settleClaim(
  app: FastifyInstance,
  request: FastifyRequest,
  claim: IdempotencyClaim,
  statusCode: number,
  payload: unknown,
): Promise<void> {
  const database = requireDatabase(app);
  if (statusCode >= HTTP_STATUS.internal) {
    // A no-op when idempotentWrite already stored the response in the handler's transaction.
    await releaseKey(database, claim);
    return;
  }
  const bodyJson = payloadJson(payload);
  if (bodyJson === undefined) {
    request.log.error({ statusCode }, "idempotent response is not JSON; releasing the key instead of storing it");
    await releaseKey(database, claim);
    return;
  }
  await completeKey(database, claim, statusCode, bodyJson);
}

async function claimFor(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = idempotencyKeyOf(request);
  if (key === undefined || request.session === null) {
    return;
  }
  const method = request.method.toUpperCase();
  const route = request.routeOptions.url ?? request.url;
  const hash = requestHash({ method, route, params: request.params, body: request.body });
  const outcome = await claimKey(requireDatabase(app), {
    userId: request.session.userId,
    key,
    method,
    route,
    requestHash: hash,
  });
  switch (outcome.kind) {
    case "claimed":
      request.idempotencyClaim = outcome.claim;
      return;
    case "mismatch":
      throw new ProblemError(HTTP_STATUS.unprocessable, PROBLEM_SLUGS.idempotencyMismatch);
    case "in-flight":
      throw new ProblemError(HTTP_STATUS.conflict, PROBLEM_SLUGS.idempotencyInFlight);
    case "replay":
      await sendReplay(reply, outcome.statusCode, outcome.body);
      return;
  }
}

function idempotencyPlugin(app: FastifyInstance, _options: unknown, registered: (error?: Error) => void): void {
  const settled = new WeakSet<FastifyRequest>();
  app.decorateRequest("idempotencyClaim", null);

  app.addHook("preHandler", async (request, reply) => {
    await claimFor(app, request, reply);
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const claim = request.idempotencyClaim;
    if (claim !== null && !settled.has(request)) {
      // Marked only once settled: if settling throws, onResponse still releases the claim.
      await settleClaim(app, request, claim, reply.statusCode, payload);
      settled.add(request);
    }
    return payload;
  });

  app.addHook("onResponse", async (request) => {
    const claim = request.idempotencyClaim;
    if (claim === null || settled.has(request)) {
      return;
    }
    settled.add(request);
    try {
      await releaseKey(requireDatabase(app), claim);
    } catch (error) {
      // The response is already sent, so logging is the only thing left to do with the failure.
      request.log.error({ err: error }, "could not release an unsettled Idempotency-Key claim");
    }
  });

  registered();
}

/** Not encapsulated (fastify-plugin), so the hooks apply to every route registered after it. */
export const idempotency = fastifyPlugin(idempotencyPlugin, { name: "g-tee-oh-idempotency" });
