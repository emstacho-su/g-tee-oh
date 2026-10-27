/**
 * Idempotency-Key handling on mutating routes (R3.1, A5 section 3, O-232): claim, run once,
 * store, replay. Registered after authentication and the CSRF (cross-site request forgery) guard.
 *
 * Mechanism: a preHandler hook (after validation, so the parsed body is what gets hashed) acts on
 * POST, PUT, PATCH and DELETE routes whose policy does not set idempotent false, when the request
 * has a session and an Idempotency-Key header. The key is checked against IDEMPOTENCY_KEY_PATTERN
 * even when the route schema already did. The request hash covers the method, the route pattern,
 * the params and the canonical JSON of the body (canonical-json.ts). claimKey (idempotency-store.ts)
 * then decides: claimed, so the handler runs; a different request under the same key, a 422
 * idempotency-mismatch problem; the first request still running, a 409 idempotency-in-flight
 * problem; or a replay of the stored status and body with idempotent-replayed: true, sent as stored
 * JSON text so the route's serializer never reshapes it (204 has no body).
 *
 * A claimed request settles in onSend: a status below 500 stores the status and the JSON body,
 * 500 or above deletes the claim so a retry can run. onResponse is the safety net: a claim still
 * open there (onSend failed, or never ran for the request) is released, so a failed request never
 * leaves its key in flight. Keys belong to the session user, so two users may use the same key.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyPlugin from "fastify-plugin";

import { requestHash } from "../http/canonical-json.js";
import { requireDatabase } from "../http/database.js";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_KEY_PATTERN, IDEMPOTENCY_REPLAYED_HEADER } from "../http/headers.js";
import { PROBLEM_CONTENT_TYPE, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { isMutatingMethod } from "../http/route-config.js";
import {
  claimKey,
  completeKey,
  type IdempotencyClaim,
  releaseKey,
} from "./idempotency-store.js";

const BAD_REQUEST_STATUS = 400;
const CONFLICT_STATUS = 409;
const UNPROCESSABLE_STATUS = 422;
const NO_CONTENT_STATUS = 204;
const SERVER_ERROR_STATUS = 500;
const FIRST_CLIENT_ERROR_STATUS = 400;
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
    throw new ProblemError(BAD_REQUEST_STATUS, PROBLEM_SLUGS.validation, {
      errors: [{ path: `headers.${IDEMPOTENCY_HEADER}`, message: "1 to 255 visible ASCII characters" }],
    });
  }
  return key;
}

function sendReplay(reply: FastifyReply, statusCode: number, body: unknown): FastifyReply {
  reply.code(statusCode).header(IDEMPOTENCY_REPLAYED_HEADER, "true");
  if (statusCode === NO_CONTENT_STATUS || body === null || body === undefined) {
    return reply.send();
  }
  const contentType = statusCode >= FIRST_CLIENT_ERROR_STATUS ? PROBLEM_CONTENT_TYPE : JSON_CONTENT_TYPE;
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
  if (statusCode >= SERVER_ERROR_STATUS) {
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

function idempotencyPlugin(app: FastifyInstance, _options: unknown, registered: (error?: Error) => void): void {
  const openClaims = new WeakMap<FastifyRequest, IdempotencyClaim>();

  app.addHook("preHandler", async (request, reply) => {
    const key = idempotencyKeyOf(request);
    if (key === undefined || request.session === null) {
      return;
    }
    const method = request.method.toUpperCase();
    const route = request.routeOptions.url ?? request.url;
    const claim: IdempotencyClaim = { userId: request.session.userId, key };
    const hash = requestHash({ method, route, params: request.params, body: request.body });
    const outcome = await claimKey(requireDatabase(app), { ...claim, method, route, requestHash: hash });
    switch (outcome.kind) {
      case "claimed":
        openClaims.set(request, claim);
        return;
      case "mismatch":
        throw new ProblemError(UNPROCESSABLE_STATUS, PROBLEM_SLUGS.idempotencyMismatch);
      case "in-flight":
        throw new ProblemError(CONFLICT_STATUS, PROBLEM_SLUGS.idempotencyInFlight);
      case "replay":
        return sendReplay(reply, outcome.statusCode, outcome.body);
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const claim = openClaims.get(request);
    if (claim !== undefined) {
      // Forgotten only once settled: if settling throws, onResponse still releases the claim.
      await settleClaim(app, request, claim, reply.statusCode, payload);
      openClaims.delete(request);
    }
    return payload;
  });

  app.addHook("onResponse", async (request) => {
    const claim = openClaims.get(request);
    if (claim === undefined) {
      return;
    }
    openClaims.delete(request);
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
