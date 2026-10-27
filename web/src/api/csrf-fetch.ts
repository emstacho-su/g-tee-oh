/**
 * The fetch the app api client sends through (R3.13, O-230, A9 section 3). It is a thin wrapper
 * around the real (or a test's injected) fetch rather than an openapi-fetch middleware, because
 * the retry below needs to send a second request and read its own GET /me, which a wrapper
 * around fetch does without re-entering the client's middleware chain.
 *
 * Mechanism, for POST, PUT, PATCH and DELETE except login (login has no session yet):
 * 1. If the in-memory holder is empty (after a page reload), GET /me first and keep its
 *    csrf_token; concurrent mutations share that one /me request. A /me that fails leaves the
 *    holder empty and the mutation goes out without a token, so the server answers for itself.
 * 2. Send the request with x-csrf-token set from the holder.
 * 3. If the answer is a 403 problem with slug csrf (the token rotated or expired), refetch /me
 *    once and resend a copy of the original request, body included, with the new token. Whatever
 *    that retry answers goes back to the caller: there is no second refetch and no loop. Any other
 *    403, forbidden-origin included, is returned as is. If the refetch fails, the first 403 is
 *    returned.
 * GET and HEAD pass straight through untouched.
 */
import type { CsrfTokenHolder } from "./csrf-token.js";
import { API_PATHS, CSRF_HEADER } from "./paths.js";
import { PROBLEM_SLUG, problemFromResponse } from "./problem.js";

export type FetchFn = (input: Request) => Promise<Response>;

export interface CsrfFetchOptions {
  fetch: FetchFn;
  tokens: CsrfTokenHolder;
}

const MUTATING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const TOKEN_EXEMPT_PATHS: ReadonlySet<string> = new Set([API_PATHS.login]);
const HTTP_FORBIDDEN = 403;

function needsToken(request: Request): boolean {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return false;
  return !TOKEN_EXEMPT_PATHS.has(new URL(request.url).pathname);
}

/** The csrf_token string of an untrusted /me body, or null. */
export function csrfTokenOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const token: unknown = (body as Record<string, unknown>)["csrf_token"];
  return typeof token === "string" && token !== "" ? token : null;
}

/**
 * The contract marks x-csrf-token as a required header parameter on the token routes, so typed
 * callers pass this placeholder; csrfFetch always replaces it with the held token (or drops it).
 */
export const AUTO_CSRF_HEADER = { [CSRF_HEADER]: "" } as const satisfies Record<typeof CSRF_HEADER, string>;

/** The request with x-csrf-token set to the token, or removed when there is none. */
function withToken(request: Request, token: string | null): Request {
  const headers = new Headers(request.headers);
  if (token === null) headers.delete(CSRF_HEADER);
  else headers.set(CSRF_HEADER, token);
  return new Request(request, { headers });
}

async function isCsrfFailure(response: Response): Promise<boolean> {
  if (response.status !== HTTP_FORBIDDEN) return false;
  const problem = await problemFromResponse(response);
  return problem.slug === PROBLEM_SLUG.csrf;
}

export function createCsrfFetch({ fetch: baseFetch, tokens }: CsrfFetchOptions): FetchFn {
  let inFlight: Promise<string | null> | null = null;

  async function loadToken(origin: string): Promise<string | null> {
    const response = await baseFetch(
      new Request(new URL(API_PATHS.me, origin), { method: "GET", headers: { accept: "application/json" } }),
    );
    const body: unknown = response.ok ? await response.json().catch(() => null) : null;
    const token = csrfTokenOf(body);
    if (token === null) tokens.clear();
    else tokens.set(token);
    return token;
  }

  /** One /me request at a time; callers that arrive while it runs share its answer. */
  function refreshToken(request: Request): Promise<string | null> {
    if (inFlight === null) {
      inFlight = loadToken(request.url).finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  return async function csrfFetch(request: Request): Promise<Response> {
    if (!needsToken(request)) return baseFetch(request);
    const retryCopy = request.clone();
    const token = tokens.get() ?? (await refreshToken(request));
    const response = await baseFetch(withToken(request, token));
    if (!(await isCsrfFailure(response))) return response;
    const fresh = await refreshToken(retryCopy);
    if (fresh === null) return response;
    return baseFetch(withToken(retryCopy, fresh));
  };
}
