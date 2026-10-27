/**
 * CSRF (cross-site request forgery) guard on mutating routes (R3.1, A9 section 3, O-230).
 * Registered after authentication, so request.session is already set.
 *
 * Mechanism: an onRequest hook looks at POST, PUT, PATCH and DELETE only and reads the route's
 * policy (route-config.ts; "token" when a route says nothing). "none" skips; unknown paths are
 * skipped too, so they answer the 404 problem. Every other policy first checks where the request
 * came from: an Origin header must equal config.appOrigin exactly ("null" and foreign origins fail),
 * and with no Origin a Sec-Fetch-Site of cross-site fails; a request carrying neither comes from a
 * non-browser client, which a forged browser request cannot be, and passes this step. Both failures
 * are a 403 forbidden-origin problem. A "token" route then needs the x-csrf-token header to equal
 * the session's own csrf_token, compared in constant time (tokensEqual), else a 403 csrf problem.
 * "origin-only" is login's policy: there is no session to hold a token yet. The hook runs before
 * body parsing and validation, so a forged request costs no parsing and never reaches a handler.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import fastifyPlugin from "fastify-plugin";

import { tokensEqual } from "../auth/tokens.js";
import type { AppConfig } from "../config.js";
import { CSRF_HEADER } from "../http/headers.js";
import { PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { DEFAULT_CSRF_POLICY, isMutatingMethod } from "../http/route-config.js";

export interface CsrfOptions {
  config: AppConfig;
}

const FORBIDDEN_STATUS = 403;
const ORIGIN_HEADER = "origin";
const FETCH_SITE_HEADER = "sec-fetch-site";
const CROSS_SITE = "cross-site";

function singleHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

function forbiddenOrigin(detail: string): ProblemError {
  return new ProblemError(FORBIDDEN_STATUS, PROBLEM_SLUGS.forbiddenOrigin, { detail });
}

/** The forbidden-origin problem, or null when the request plausibly comes from the app origin. */
export function originFailure(request: FastifyRequest, appOrigin: string): ProblemError | null {
  const origin = request.headers[ORIGIN_HEADER];
  if (origin !== undefined) {
    return origin === appOrigin
      ? null
      : forbiddenOrigin("Mutating requests are accepted from the app's own origin only.");
  }
  return singleHeader(request, FETCH_SITE_HEADER) === CROSS_SITE
    ? forbiddenOrigin("Cross-site mutating requests are not accepted.")
    : null;
}

/** The csrf problem, or null when x-csrf-token equals the session's token. */
export function tokenFailure(request: FastifyRequest): ProblemError | null {
  const given = singleHeader(request, CSRF_HEADER);
  const expected = request.session?.csrfToken;
  if (given !== undefined && expected !== undefined && tokensEqual(expected, given)) {
    return null;
  }
  return new ProblemError(FORBIDDEN_STATUS, PROBLEM_SLUGS.csrf, {
    detail: `Send the session's csrf_token in the ${CSRF_HEADER} header.`,
  });
}

/** The first CSRF failure of a request, or null when it may proceed. */
export function csrfFailure(request: FastifyRequest, appOrigin: string): ProblemError | null {
  if (request.is404 || !isMutatingMethod(request.method)) {
    return null;
  }
  const policy = request.routeOptions.config.csrf ?? DEFAULT_CSRF_POLICY;
  if (policy === "none") {
    return null;
  }
  const failure = originFailure(request, appOrigin);
  if (failure !== null || policy === "origin-only") {
    return failure;
  }
  return tokenFailure(request);
}

function csrfPlugin(app: FastifyInstance, options: CsrfOptions, registered: (error?: Error) => void): void {
  const { appOrigin } = options.config;
  app.addHook("onRequest", (request, _reply, done) => {
    const failure = csrfFailure(request, appOrigin);
    if (failure === null) {
      done();
      return;
    }
    done(failure);
  });
  registered();
}

/** Not encapsulated (fastify-plugin), so the hook applies to every route registered after it. */
export const csrfGuard = fastifyPlugin(csrfPlugin, { name: "g-tee-oh-csrf" });
