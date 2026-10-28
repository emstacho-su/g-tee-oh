/**
 * Test helper for the study screen (S25, R3.12): renders the whole app at a path with a fetch that
 * answers /me as signed in and every catalog and study read from the mocked study route
 * (e2e/support/mock-study.ts), so the screen meets the same synthetic api as the shots. An
 * override answers first, which is how a test injects a 404, 502 or 503. Every request is kept
 * with its query, so a test can assert what the screen asked for (the fake fetch of
 * test/api/fake-fetch.ts keys by path only).
 */
import { createMemoryHistory } from "@tanstack/react-router";
import { render, type RenderResult } from "@testing-library/react";

import type { MockRequest } from "../../e2e/support/mock-api.js";
import { mockStudyRoute } from "../../e2e/support/mock-study.js";
import { createAppApi } from "../../src/api/index.js";
import { App } from "../../src/app/index.js";
import { createQueryClient } from "../../src/auth/index.js";
import { fixtureSession } from "../../src/fixtures/index.js";
import { createAppRouter } from "../../src/router.js";
import { TEST_ORIGIN } from "../app/render-app.js";

/** Answers a request first; a promise holds the answer back until the test resolves it (S39). */
export type StudyOverride = (request: MockRequest) => Response | Promise<Response> | undefined;

const UNROUTED_STATUS = 599;

function jsonBody(status: number, body: unknown, contentType = "application/json"): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": contentType } });
}

/** A problem+json response like the api's, with a detail text the screen must never show. */
export function problemOf(status: number, slug: string): Response {
  return jsonBody(
    status,
    { type: `urn:g-tee-oh:problem:${slug}`, title: `title of ${slug}`, status, detail: "server detail text" },
    "application/problem+json",
  );
}

export function nodeJson(body: unknown): Response {
  return jsonBody(200, body);
}

export interface RenderedStudy extends RenderResult {
  requests: MockRequest[];
  nodeRequests: () => MockRequest[];
  queryClient: ReturnType<typeof createQueryClient>;
  router: ReturnType<typeof createAppRouter>;
}

export function renderStudy(path: string, override?: StudyOverride): RenderedStudy {
  const requests: MockRequest[] = [];
  const fetch = (input: Request): Promise<Response> => {
    const url = new URL(input.url);
    const request: MockRequest = {
      method: input.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: {},
      body: undefined,
    };
    requests.push(request);
    const custom = override?.(request);
    if (custom !== undefined) return Promise.resolve(custom);
    if (request.path === "/api/v1/me") return Promise.resolve(jsonBody(200, fixtureSession));
    const routed = mockStudyRoute(request, { signedIn: true });
    if (routed === undefined) return Promise.resolve(new Response("unrouted", { status: UNROUTED_STATUS }));
    return Promise.resolve(jsonBody(routed.status, routed.body, routed.contentType));
  };
  const api = createAppApi({ baseUrl: TEST_ORIGIN, fetch });
  const queryClient = createQueryClient();
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter({ queryClient, api, history });
  const view: RenderResult = render(<App router={router} queryClient={queryClient} api={api} />);
  const nodeRequests = () => requests.filter((request) => request.path === "/api/v1/study/node");
  return { ...view, requests, nodeRequests, queryClient, router };
}
