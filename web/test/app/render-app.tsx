/**
 * Test helper: renders the whole app (providers, router, routes) at a path over a memory history
 * and an injected fake fetch (R3.13, R0.7). Each call builds a fresh api client, token holder,
 * QueryClient and router, so no test sees another test's session or cache.
 */
import { createMemoryHistory } from "@tanstack/react-router";
import { render } from "@testing-library/react";

import { createAppApi } from "../../src/api/index.js";
import { App } from "../../src/app/index.js";
import { createQueryClient } from "../../src/auth/index.js";
import { createAppRouter } from "../../src/router.js";
import { createFakeFetch, problemResponse, sessionResponse } from "../api/fake-fetch.js";
import type { FetchScript } from "../api/fake-fetch.js";

export const TEST_ORIGIN = "http://localhost:4173";

export const SIGNED_IN: FetchScript = { "GET /api/v1/me": [sessionResponse()] };
export const SIGNED_OUT: FetchScript = { "GET /api/v1/me": [problemResponse(401, "unauthenticated")] };

export function renderApp(path: string, script: FetchScript) {
  const fake = createFakeFetch(script);
  const api = createAppApi({ baseUrl: TEST_ORIGIN, fetch: fake.fetch });
  const queryClient = createQueryClient();
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter({ queryClient, api, history });
  const view = render(<App router={router} queryClient={queryClient} api={api} />);
  return { ...view, fake, api, queryClient, router, history };
}
