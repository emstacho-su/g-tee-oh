// Client factory tests (R0.7, O-115): the openapi-fetch clients are typed by the generated
// paths, so a route the service does not serve is a compile error and a health body comes back
// typed; a base URL that is not an absolute http(s) URL is refused with a named error. The fetch
// stand-in answers one JSON body and records the request it was handed, so no port is opened.
import { describe, expect, expectTypeOf, it } from "vitest";

import type { paths as ApiPaths } from "../src/api.generated.js";
import {
  InvalidBaseUrlError,
  assertHttpBaseUrl,
  createApiClient,
  createSolverQueryClient,
} from "../src/index.js";
import type { components as SolverQueryComponents } from "../src/solver-query.generated.js";

const API_BASE_URL = "http://api.test";
const SOLVER_QUERY_BASE_URL = "https://solver-query.test:7070";
const API_HEALTH_PATH = "/api/v1/healthz";
const SOLVER_QUERY_HEALTH_PATH = "/healthz";
const HTTP_OK = 200;
const REJECTED_BASE_URLS = ["/api/v1", "api.test", "ftp://api.test", "", "http//api.test"];
// A query string or a fragment on the base: openapi-fetch appends the route path to the base
// as text, so the path would land inside the query or the fragment instead of on the host.
const DECORATED_BASE_URLS = [
  "https://host/api?x=1",
  "https://host/api#frag",
  "https://host/?",
  "https://host/#",
];

type ApiHealth = ApiPaths[typeof API_HEALTH_PATH]["get"]["responses"][typeof HTTP_OK]["content"]["application/json"];
type SolverQueryHealth = SolverQueryComponents["schemas"]["Healthz"];

const apiHealth: ApiHealth = { status: "ok", service: "api", version: "0.0.0" };
const solverQueryHealth: SolverQueryHealth = {
  status: "ok",
  service: "solver-query",
  version: "0.1.0",
  fixture_library: { path: "/fixtures/library", present: true },
};

interface RecordedFetch {
  readonly fetch: (input: Request) => Promise<Response>;
  readonly requests: readonly Request[];
}

/** A fetch that answers `body` as JSON with status 200 and keeps every request it was given. */
function jsonFetch(body: unknown): RecordedFetch {
  const requests: Request[] = [];
  const fetch = (input: Request): Promise<Response> => {
    requests.push(input);
    const response = new Response(JSON.stringify(body), {
      status: HTTP_OK,
      headers: { "content-type": "application/json" },
    });
    return Promise.resolve(response);
  };
  return { fetch, requests };
}

describe("R0.7 contract clients", () => {
  it("R0.7 the api client types GET /api/v1/healthz against the generated paths", async () => {
    const { fetch } = jsonFetch(apiHealth);
    const client = createApiClient(API_BASE_URL, { fetch });

    const { data } = await client.GET(API_HEALTH_PATH);

    expectTypeOf(data).toEqualTypeOf<ApiHealth | undefined>();
    expect(data).toEqual(apiHealth);
    // Compile-time only: a path the api does not serve must not type-check, so the call sits in a
    // function that is never run.
    function unservedPath(): void {
      // @ts-expect-error /api/v1/nope is not in the generated paths
      void client.GET("/api/v1/nope");
    }
    expect(typeof unservedPath).toBe("function");
  });

  it("R0.7 both factories reject a relative base URL with InvalidBaseUrlError", () => {
    for (const baseUrl of REJECTED_BASE_URLS) {
      expect(() => createApiClient(baseUrl), baseUrl).toThrow(InvalidBaseUrlError);
      expect(() => createSolverQueryClient(baseUrl), baseUrl).toThrow(InvalidBaseUrlError);
    }
    expect(() => createApiClient(API_BASE_URL)).not.toThrow();
    expect(() => createSolverQueryClient(SOLVER_QUERY_BASE_URL)).not.toThrow();
  });

  it("R0.7 both factories reject a base URL carrying a query string or a fragment", () => {
    for (const baseUrl of DECORATED_BASE_URLS) {
      expect(() => assertHttpBaseUrl(baseUrl), baseUrl).toThrow(InvalidBaseUrlError);
      expect(() => createApiClient(baseUrl), baseUrl).toThrow(InvalidBaseUrlError);
      expect(() => createSolverQueryClient(baseUrl), baseUrl).toThrow(InvalidBaseUrlError);
    }
    expect(assertHttpBaseUrl("https://host/api")).toBe("https://host/api");
    expect(assertHttpBaseUrl("https://host/api/")).toBe("https://host/api/");
  });

  it("R0.7 a mocked fetch round trip returns the typed body through the api client", async () => {
    const { fetch, requests } = jsonFetch(apiHealth);
    const client = createApiClient(API_BASE_URL, { fetch });

    const { data, error, response } = await client.GET(API_HEALTH_PATH);

    expect(error).toBeUndefined();
    expect(response.status).toBe(HTTP_OK);
    expect(data).toEqual(apiHealth);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([`GET ${API_BASE_URL}${API_HEALTH_PATH}`]);
  });

  it("R0.7 a mocked fetch round trip returns the typed body through the solver-query client", async () => {
    const { fetch, requests } = jsonFetch(solverQueryHealth);
    const client = createSolverQueryClient(SOLVER_QUERY_BASE_URL, { fetch });

    const { data, error } = await client.GET(SOLVER_QUERY_HEALTH_PATH);

    expectTypeOf(data).toEqualTypeOf<SolverQueryHealth | undefined>();
    expect(error).toBeUndefined();
    expect(data).toEqual(solverQueryHealth);
    expect(data?.fixture_library.present).toBe(true);
    expect(requests.map((request) => request.url)).toEqual([`${SOLVER_QUERY_BASE_URL}${SOLVER_QUERY_HEALTH_PATH}`]);
  });
});
