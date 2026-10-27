/**
 * Access to the fixture solver-query from a test (O-53, O-244). A test that needs it calls
 * fixtureSolverQueryUrl or fixtureSolverQuery; when the global setup could not start it, the test
 * fails with the recorded cause instead of being skipped.
 */
import { inject } from "vitest";

import { buildApp, type ApiApp, type BuildAppOptions } from "../../src/app.js";
import type { Database } from "../../src/db.js";
import { createSolverQuery, type SolverQuery } from "../../src/solver-query/client.js";
import { TEST_CONFIG } from "./app.js";

export function fixtureSolverQueryUrl(): string {
  const url = inject("solverQueryUrl");
  if (url === "") {
    throw new Error(inject("solverQueryError") || "the fixture solver-query is not available");
  }
  return url;
}

/** A client over the fixture solver-query; `fetch` lets a test count or delay the calls. */
export function fixtureSolverQuery(fetchImpl?: typeof fetch): SolverQuery {
  return createSolverQuery(fixtureSolverQueryUrl(), fetchImpl === undefined ? {} : { fetch: fetchImpl });
}

/** The api over the test database and the fixture solver-query. */
export function buildTrainerApp(database: Database, options: Omit<BuildAppOptions, "database"> = {}): ApiApp {
  return buildApp({ config: TEST_CONFIG, solverQuery: fixtureSolverQuery(), ...options, database });
}

/** A fetch that counts the solver-query paths it was asked for, then calls the real fetch. */
export function countingFetch(): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const counted: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(new URL(url).pathname);
    return fetch(input, init);
  };
  return { fetch: counted, calls };
}
