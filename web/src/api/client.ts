/**
 * The app's api client (R3.13, O-115, O-230). createAppApi builds the typed openapi-fetch client
 * from @g-tee-oh/contracts over csrf-fetch.ts, paired with the in-memory CSRF (cross-site request
 * forgery) token holder it reads. Paths are "/api/v1/..." on the page's own origin: Caddy serves
 * the web and the api together, so the session cookie (HttpOnly, never visible to page code)
 * rides along same-origin. Tests pass their own fetch and base URL; the app uses getAppApi, one
 * client per page built on window.location.origin and the browser fetch.
 */
import { createApiClient } from "@g-tee-oh/contracts";

import { createCsrfFetch } from "./csrf-fetch.js";
import type { FetchFn } from "./csrf-fetch.js";
import { createCsrfTokenHolder } from "./csrf-token.js";
import type { CsrfTokenHolder } from "./csrf-token.js";

export type ApiClient = ReturnType<typeof createApiClient>;

export interface AppApi {
  client: ApiClient;
  tokens: CsrfTokenHolder;
}

export interface AppApiOptions {
  baseUrl: string;
  fetch: FetchFn;
  tokens?: CsrfTokenHolder;
}

export function createAppApi({ baseUrl, fetch, tokens = createCsrfTokenHolder() }: AppApiOptions): AppApi {
  const client = createApiClient(baseUrl, { fetch: createCsrfFetch({ fetch, tokens }) });
  return { client, tokens };
}

let appApi: AppApi | null = null;

/** The page's one api client, created on first use. */
export function getAppApi(): AppApi {
  if (appApi === null) {
    appApi = createAppApi({ baseUrl: window.location.origin, fetch: (request) => globalThis.fetch(request) });
  }
  return appApi;
}
