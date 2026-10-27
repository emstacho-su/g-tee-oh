/**
 * The mocked api for the Playwright mock project (R3.13, O-264). The mock project runs the
 * sign-in flow against `vite preview` of the harness build with no Docker: page.route answers
 * every /api/v1/** request from here, so the app under test is the real production bundle and
 * only the network is fake.
 *
 * Mechanism: createMockApi returns a pure handler with its own state, one per page. GET /me
 * answers a 401 problem until a successful login, then the fixture SessionInfo. POST /auth/login
 * accepts owner@example.com (surrounding spaces and capitals ignored, as the api does) with any
 * non-empty password; anything else gets the same 401 problem, and a body that is not the
 * contract shape a 400 validation problem. POST /auth/logout requires the x-csrf-token header to
 * equal the fixture csrf_token (O-230): a 403 csrf problem otherwise, else 204 and the session
 * ends. Every other /api/v1 path answers 501, as unbuilt api routes do. Bodies are typed by the
 * contract (src/contracts.ts and the generated paths) and the session is the shared fixture, so
 * the mock, the unit tests and the gallery agree on every shape. Every request is recorded, in
 * order, so a test can assert what the app sent. installMockApi wires a handler to a page.
 */
import type { ApiPaths } from "@g-tee-oh/contracts";
import type { Page, Request, Route } from "@playwright/test";

import { HTTP_STATUS } from "../../src/api/http-status.js";
import { API_PATHS, CSRF_HEADER } from "../../src/api/paths.js";
import type { Problem, SessionInfo } from "../../src/contracts.js";
import { FIXTURE_CSRF_TOKEN, FIXTURE_USER_EMAIL, fixtureSession } from "../../src/fixtures/index.js";

// The paths and the header come from the app's own module, so the mock and the app can never
// disagree on a name.
export { CSRF_HEADER };
export const API_ROUTE_PATTERN = "**/api/v1/**";
export const LOGIN_PATH = API_PATHS.login;
export const LOGOUT_PATH = API_PATHS.logout;
export const ME_PATH = API_PATHS.me;

const JSON_TYPE = "application/json";
const PROBLEM_TYPE = "application/problem+json";
const PROBLEM_PREFIX = "urn:g-tee-oh:problem:";

const STATUS = {
  ok: 200,
  noContent: 204,
  badRequest: 400,
  unauthorized: HTTP_STATUS.unauthorized,
  forbidden: HTTP_STATUS.forbidden,
  notImplemented: 501,
} as const;

type LoginBody = ApiPaths["/api/v1/auth/login"]["post"]["requestBody"]["content"]["application/json"];

export interface MockRequest {
  readonly method: string;
  /** The URL path without the query string. */
  readonly path: string;
  /** Header names in lower case, as Playwright reports them. */
  readonly headers: Readonly<Record<string, string>>;
  /** The parsed JSON body, or undefined when there is none or it is not JSON. */
  readonly body: unknown;
}

export interface MockResponse {
  readonly status: number;
  readonly contentType?: string;
  readonly body?: SessionInfo | Problem;
}

export interface MockApi {
  handle(request: MockRequest): MockResponse;
  /** Every request handled so far, oldest first. */
  requests(): readonly MockRequest[];
}

interface ProblemSpec {
  readonly status: number;
  readonly slug: string;
  readonly title: string;
}

const UNAUTHENTICATED: ProblemSpec = {
  status: STATUS.unauthorized,
  slug: "unauthenticated",
  title: "Authentication required",
};
const VALIDATION: ProblemSpec = { status: STATUS.badRequest, slug: "validation", title: "Request validation failed" };
const CSRF: ProblemSpec = {
  status: STATUS.forbidden,
  slug: "csrf",
  title: "Cross-site request forgery check failed",
};
const NOT_IMPLEMENTED: ProblemSpec = { status: STATUS.notImplemented, slug: "not-implemented", title: "Not implemented" };

function problem(spec: ProblemSpec, path: string): MockResponse {
  const body: Problem = { type: `${PROBLEM_PREFIX}${spec.slug}`, title: spec.title, status: spec.status, instance: path };
  return { status: spec.status, contentType: PROBLEM_TYPE, body };
}

function session(): MockResponse {
  return { status: STATUS.ok, contentType: JSON_TYPE, body: fixtureSession };
}

function isLoginBody(body: unknown): body is LoginBody {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as Record<string, unknown>;
  return typeof candidate.email === "string" && typeof candidate.password === "string";
}

function acceptsLogin(body: LoginBody): boolean {
  return body.email.trim().toLowerCase() === FIXTURE_USER_EMAIL && body.password !== "";
}

/** A fresh mocked api, signed out, with an empty request log. */
export function createMockApi(): MockApi {
  let signedIn = false;
  let log: readonly MockRequest[] = [];

  function route(request: MockRequest): MockResponse {
    const key = `${request.method.toUpperCase()} ${request.path}`;
    if (key === `GET ${ME_PATH}`) return signedIn ? session() : problem(UNAUTHENTICATED, request.path);
    if (key === `POST ${LOGIN_PATH}`) {
      if (!isLoginBody(request.body)) return problem(VALIDATION, request.path);
      if (!acceptsLogin(request.body)) return problem(UNAUTHENTICATED, request.path);
      signedIn = true;
      return session();
    }
    if (key === `POST ${LOGOUT_PATH}`) {
      if (request.headers[CSRF_HEADER] !== FIXTURE_CSRF_TOKEN) return problem(CSRF, request.path);
      signedIn = false;
      return { status: STATUS.noContent };
    }
    return problem(NOT_IMPLEMENTED, request.path);
  }

  return {
    handle(request) {
      log = [...log, request];
      return route(request);
    },
    requests: () => log,
  };
}

function parseBody(request: Request): unknown {
  if (request.postData() === null) return undefined;
  try {
    return request.postDataJSON() as unknown;
  } catch {
    // A body that is not JSON reaches the handler as undefined, which the login route refuses.
    return undefined;
  }
}

async function toMockRequest(request: Request): Promise<MockRequest> {
  return {
    method: request.method(),
    path: new URL(request.url()).pathname,
    headers: await request.allHeaders(),
    body: parseBody(request),
  };
}

async function fulfil(route: Route, api: MockApi): Promise<void> {
  const response = api.handle(await toMockRequest(route.request()));
  await route.fulfill({
    status: response.status,
    ...(response.contentType === undefined ? {} : { contentType: response.contentType }),
    ...(response.body === undefined ? {} : { body: JSON.stringify(response.body) }),
  });
}

/** Routes every /api/v1 request of `page` to `api` (a fresh one by default) and returns it. */
export async function installMockApi(page: Page, api: MockApi = createMockApi()): Promise<MockApi> {
  await page.route(API_ROUTE_PATTERN, (route) => fulfil(route, api));
  return api;
}
