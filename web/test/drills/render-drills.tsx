/**
 * Test helper for /drills, /drills/new and /drills/$id (S26, R3.14): renders the whole app at a
 * path with a fetch that answers /me with the owner fixture and every catalog, drill and session
 * request from the mocked routes (e2e/support/mock-study.ts, mock-drills.ts, mock-sessions.ts), so
 * the screens meet the same synthetic api as the shots and the mocked flow 2. An override answers
 * first. Every request is kept with its method, path, query, headers and parsed body. The app is
 * wrapped in a LibraryDepsProvider with a counting Idempotency-Key factory (the intent mutations
 * read their key factory from it).
 */
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { expect } from "vitest";

import type { MockRequest } from "../../e2e/support/mock-api.js";
import { createMockDrillRoute, type MockDrillRoute } from "../../e2e/support/mock-drills.js";
import { createMockSessionRoute } from "../../e2e/support/mock-sessions.js";
import { mockStudyRoute } from "../../e2e/support/mock-study.js";
import { createAppApi } from "../../src/api/index.js";
import { App } from "../../src/app/index.js";
import { createQueryClient } from "../../src/auth/index.js";
import { fixtureSession } from "../../src/fixtures/index.js";
import { LibraryDepsProvider, openBrowserEvents } from "../../src/library/library-deps.js";
import { createAppRouter } from "../../src/router.js";
import { TEST_ORIGIN } from "../app/render-app.js";
import { jsonBody } from "../library/render-library.js";

export type DrillOverride = (request: MockRequest) => Response | undefined;

const UNROUTED_STATUS = 599;

export interface RenderedDrills extends RenderResult {
  requests: MockRequest[];
  /** Requests with this method and path, oldest first. */
  sent: (method: string, path: string) => MockRequest[];
  router: ReturnType<typeof createAppRouter>;
  drills: MockDrillRoute;
}

export interface RenderDrillsOptions {
  override?: DrillOverride;
}

async function toMockRequest(input: Request): Promise<MockRequest> {
  const url = new URL(input.url);
  const text = await input.text();
  let body: unknown;
  try {
    body = text === "" ? undefined : (JSON.parse(text) as unknown);
  } catch {
    // A body that is not JSON is kept as undefined; the mocked routes refuse it.
    body = undefined;
  }
  return { method: input.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(input.headers.entries()), body };
}

/**
 * Opens a builder page through the "Drill sections" list (S40, O-405) and waits for its card; the
 * link's name starts with the page label (a marked page adds ", needs a fix").
 */
export async function openSection(user: UserEvent, label: string): Promise<void> {
  const nav = screen.getByRole("navigation", { name: "Drill sections" });
  const link = within(nav).getAllByRole("link").find((candidate) => candidate.textContent?.startsWith(label) === true);
  if (link === undefined) throw new Error(`no builder page ${label}`);
  await user.click(link);
  await waitFor(() => expect(link).toHaveAttribute("aria-current", "page"));
}

export function renderDrills(path: string, options: RenderDrillsOptions = {}): RenderedDrills {
  const drills = createMockDrillRoute();
  const sessions = createMockSessionRoute({ drillOf: drills.drillOf });
  const requests: MockRequest[] = [];
  let keyCount = 0;
  const fetch = async (input: Request): Promise<Response> => {
    const request = await toMockRequest(input);
    requests.push(request);
    const custom = options.override?.(request);
    if (custom !== undefined) return custom;
    if (request.path === "/api/v1/me") return jsonBody(200, fixtureSession);
    const context = { signedIn: true };
    const routed = mockStudyRoute(request, context) ?? drills(request, context) ?? sessions(request, context);
    if (routed === undefined) return new Response("unrouted", { status: UNROUTED_STATUS });
    return routed.body === undefined ? new Response(null, { status: routed.status }) : jsonBody(routed.status, routed.body, routed.contentType);
  };
  const api = createAppApi({ baseUrl: TEST_ORIGIN, fetch });
  const queryClient = createQueryClient();
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter({ queryClient, api, history });
  const deps = {
    openEvents: openBrowserEvents,
    newKey: () => {
      keyCount += 1;
      return `test-key-${keyCount}`;
    },
  };
  const view = render(
    <LibraryDepsProvider deps={deps}>
      <App router={router} queryClient={queryClient} api={api} />
    </LibraryDepsProvider>,
  );
  const sent = (method: string, requestPath: string) => requests.filter((request) => request.method === method && request.path === requestPath);
  return { ...view, requests, sent, router, drills };
}
