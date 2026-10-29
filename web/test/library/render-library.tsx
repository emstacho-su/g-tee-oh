/**
 * Test helper for /library, /settings and the home card (S28, R3.4, R3.5): renders the whole app
 * at a path with a fetch that answers /me with the owner (admin) or member fixture and every
 * catalog, coverage and admin request from the mocked routes (e2e/support/mock-study.ts and
 * mock-library.ts), so the screens meet the same synthetic api as the shots. An override answers
 * first. Every request is kept with its method, path, query, headers and parsed body. The app is
 * wrapped in a LibraryDepsProvider with a fake event stream (jsdom has no EventSource) and a
 * counting Idempotency-Key factory.
 */
import { createMemoryHistory } from "@tanstack/react-router";
import { act, render, type RenderResult } from "@testing-library/react";

import { createMockLibraryRoute } from "../../e2e/support/mock-library.js";
import type { MockRequest } from "../../e2e/support/mock-api.js";
import { mockStudyRoute } from "../../e2e/support/mock-study.js";
import { createAppApi } from "../../src/api/index.js";
import { App } from "../../src/app/index.js";
import { createQueryClient } from "../../src/auth/index.js";
import { fixtureMemberSession, fixtureSession } from "../../src/fixtures/index.js";
import { LibraryDepsProvider, type EventSourceLike } from "../../src/library/library-deps.js";
import type { LibrarySectionSlug } from "../../src/library/sections.js";
import { EVENT_SOURCE_CLOSED } from "../../src/library/use-server-events.js";
import { createAppRouter } from "../../src/router.js";
import { TEST_ORIGIN } from "../app/render-app.js";

export type LibraryOverride = (request: MockRequest) => Response | undefined;

const OPEN = 1;
const UNROUTED_STATUS = 599;

/** A fake EventSource a test drives: open, emit a named event, or fail. */
export class FakeEventStream implements EventSourceLike {
  readyState = 0;
  closed = false;
  readonly url: string;
  private listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
    this.readyState = EVENT_SOURCE_CLOSED;
  }

  private dispatch(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data }));
  }

  open(): void {
    act(() => {
      this.readyState = OPEN;
      this.dispatch("open", "");
    });
  }

  emit(type: string, payload: unknown): void {
    act(() => this.dispatch(type, typeof payload === "string" ? payload : JSON.stringify(payload)));
  }

  fail(closed: boolean): void {
    act(() => {
      this.readyState = closed ? EVENT_SOURCE_CLOSED : 0;
      this.dispatch("error", "");
    });
  }
}

export function jsonBody(status: number, body: unknown, contentType = "application/json"): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": contentType } });
}

export interface RenderedLibrary extends RenderResult {
  requests: MockRequest[];
  /** Requests with this method and path, oldest first. */
  sent: (method: string, path: string) => MockRequest[];
  streams: FakeEventStream[];
  router: ReturnType<typeof createAppRouter>;
}

export interface RenderLibraryOptions {
  admin?: boolean;
  /** Whether /me answers the admin fixture now; lets a test revoke the flag mid-test. */
  isAdminNow?: () => boolean;
  override?: LibraryOverride;
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
  return {
    method: input.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: Object.fromEntries(input.headers.entries()),
    body,
  };
}

export function renderLibrary(path: string, options: RenderLibraryOptions = {}): RenderedLibrary {
  const admin = options.admin ?? true;
  const libraryRoute = createMockLibraryRoute({ admin });
  const requests: MockRequest[] = [];
  const streams: FakeEventStream[] = [];
  let keyCount = 0;
  const fetch = async (input: Request): Promise<Response> => {
    const request = await toMockRequest(input);
    requests.push(request);
    const custom = options.override?.(request);
    if (custom !== undefined) return custom;
    const adminNow = options.isAdminNow?.() ?? admin;
    if (request.path === "/api/v1/me") return jsonBody(200, adminNow ? fixtureSession : fixtureMemberSession);
    const routed = mockStudyRoute(request, { signedIn: true }) ?? libraryRoute(request, { signedIn: true });
    if (routed === undefined) return new Response("unrouted", { status: UNROUTED_STATUS });
    return jsonBody(routed.status, routed.body, routed.contentType);
  };
  const api = createAppApi({ baseUrl: TEST_ORIGIN, fetch });
  const queryClient = createQueryClient();
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter({ queryClient, api, history });
  const deps = {
    openEvents: (url: string) => {
      const stream = new FakeEventStream(url);
      streams.push(stream);
      return stream;
    },
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
  const sent = (method: string, requestPath: string) =>
    requests.filter((request) => request.method === method && request.path === requestPath);
  return { ...view, requests, sent, streams, router };
}

/**
 * A /library page URL at the fixture online 6-max 100bb configuration, optionally with a pair. The
 * section is the open page (S40, O-406): coverage by default, builder or settings for the admin pages.
 */
export function libraryPath(onlineStakeId: string, pair?: string, section: LibrarySectionSlug = "coverage"): string {
  const base = `/library/${section}?format=online&table_size=6&stake=${onlineStakeId}&depth=10000`;
  return pair === undefined ? base : `${base}&pair=${pair}`;
}
