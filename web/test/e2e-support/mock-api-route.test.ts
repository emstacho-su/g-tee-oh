// Tests for the page.route adapter of e2e/support/mock-api.ts (R3.13, O-264): installMockApi
// turns a Playwright request into a MockRequest and the handler's answer into route.fulfill.
// A fake page and route stand in for Playwright, so no browser starts.
import type { Page, Route } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { API_ROUTE_PATTERN, CSRF_HEADER, installMockApi } from "../../e2e/support/mock-api.js";
import { FIXTURE_CSRF_TOKEN, FIXTURE_USER_EMAIL, fixtureSession } from "../../src/fixtures/index.js";

type RouteHandler = (route: Route) => Promise<void>;

interface FakeRequestInit {
  method: string;
  url: string;
  headers?: Record<string, string>;
  postData?: string | null;
}

interface FulfilOptions {
  status: number;
  contentType?: string;
  body?: string;
}

function fakeRoute(init: FakeRequestInit): { route: Route; fulfilled: FulfilOptions[] } {
  const fulfilled: FulfilOptions[] = [];
  const postData = init.postData ?? null;
  const request = {
    method: () => init.method,
    url: () => init.url,
    allHeaders: () => Promise.resolve(init.headers ?? {}),
    postData: () => postData,
    postDataJSON: (): unknown => (postData === null ? null : JSON.parse(postData)),
  };
  const route = {
    request: () => request,
    fulfill: (options: FulfilOptions) => {
      fulfilled.push(options);
      return Promise.resolve();
    },
  };
  return { route: route as unknown as Route, fulfilled };
}

async function installed(): Promise<{ handler: RouteHandler; pattern: string }> {
  const captured: { handler?: RouteHandler; pattern?: string } = {};
  const page = {
    route: (pattern: string, handler: RouteHandler) => {
      captured.pattern = pattern;
      captured.handler = handler;
      return Promise.resolve();
    },
  };
  await installMockApi(page as unknown as Page);
  if (captured.handler === undefined || captured.pattern === undefined) throw new Error("route not installed");
  return { handler: captured.handler, pattern: captured.pattern };
}

const ORIGIN = "http://localhost:4173";

describe("R3.13 mock api page.route adapter", () => {
  it("R3.13 routes the /api/v1 pattern and answers a JSON login with the session", async () => {
    const { handler, pattern } = await installed();
    expect(pattern).toBe(API_ROUTE_PATTERN);
    const login = fakeRoute({
      method: "POST",
      url: `${ORIGIN}/api/v1/auth/login?probe=1`,
      postData: JSON.stringify({ email: FIXTURE_USER_EMAIL, password: "pw" }),
    });
    await handler(login.route);
    expect(login.fulfilled).toEqual([
      { status: 200, contentType: "application/json", body: JSON.stringify(fixtureSession) },
    ]);
  });

  it("R3.13 a body that is not JSON reaches the handler as no body: 400 problem", async () => {
    const { handler } = await installed();
    const garbled = fakeRoute({ method: "POST", url: `${ORIGIN}/api/v1/auth/login`, postData: "{not json" });
    await handler(garbled.route);
    expect(garbled.fulfilled[0]?.status).toBe(400);
    expect(garbled.fulfilled[0]?.contentType).toBe("application/problem+json");
  });

  it("R3.13 passes the headers through and sends a 204 with no body and no content type", async () => {
    const { handler } = await installed();
    await handler(
      fakeRoute({
        method: "POST",
        url: `${ORIGIN}/api/v1/auth/login`,
        postData: JSON.stringify({ email: FIXTURE_USER_EMAIL, password: "pw" }),
      }).route,
    );
    const logout = fakeRoute({
      method: "POST",
      url: `${ORIGIN}/api/v1/auth/logout`,
      headers: { [CSRF_HEADER]: FIXTURE_CSRF_TOKEN },
    });
    await handler(logout.route);
    expect(logout.fulfilled).toEqual([{ status: 204 }]);
  });
});
