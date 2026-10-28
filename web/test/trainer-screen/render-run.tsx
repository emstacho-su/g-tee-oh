/**
 * Test helper for the drill run screen (S25, R3.13, R3.11). Renders DrillRunPage inside the app's
 * providers (Query, api, an isolated hotkey store, injected trainer dependencies) over the scripted
 * fake fetch, and records every request with its Idempotency-Key header and body. The clock and
 * the key factory are injected (trainer-deps.tsx), so response_ms and the keys are exact. The page
 * renders inside a small memory router (screen-router.tsx, S26 review MEDIUM 4), since its notes
 * link to /library through the router Link.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";

import { createAppApi } from "../../src/api/index.js";
import { ApiProvider, createQueryClient } from "../../src/auth/index.js";
import { FIXTURE_CSRF_TOKEN } from "../../src/fixtures/index.js";
import { FIXTURE_DRILL_ID, fixtureDrill, fixturePracticeSession } from "../../src/fixtures/trainer.js";
import { HotkeyRoot, createHotkeyStore } from "../../src/hotkeys/index.js";
import { DrillRunPage } from "../../src/routes/drill-run/DrillRunPage.js";
import { TrainerDepsProvider, type Scheduler, type TrainerDeps } from "../../src/trainer/trainer-deps.js";
import { createFakeFetch, jsonResponse, type FetchScript } from "../api/fake-fetch.js";
import { createScreenRouter, ScreenRouterView, type ScreenRouter } from "./screen-router.js";

export const ORIGIN = "http://localhost:4173";
export const SESSION_ID = fixturePracticeSession.session_id;
export const DRILL_PATH = `GET /api/v1/drills/${FIXTURE_DRILL_ID}`;
export const START_PATH = "POST /api/v1/sessions";
export const NEXT_PATH = `GET /api/v1/sessions/${SESSION_ID}/next`;
export const DECIDE_PATH = `POST /api/v1/sessions/${SESSION_ID}/decisions`;
export const END_PATH = `POST /api/v1/sessions/${SESSION_ID}/end`;

export interface SentRequest {
  key: string;
  idempotencyKey: string | null;
  csrf: string | null;
  body: unknown;
}

export interface Clock {
  now: number;
}

export interface RunView extends RenderResult {
  sent: SentRequest[];
  clock: Clock;
  /** The requests sent to one "METHOD /path" key, in order. */
  sentTo: (key: string) => SentRequest[];
  queryClient: ReturnType<typeof createQueryClient>;
  api: ReturnType<typeof createAppApi>;
  /** The test router the page renders in, so a test can follow the library link (MEDIUM 4). */
  router: ScreenRouter;
}

export interface RenderRunOptions {
  script: FetchScript;
  seed?: string;
  drillId?: string;
  /** The timer for the automatic continue (S26, O-314); the app's setTimeout when absent. */
  schedule?: Scheduler;
}

/** The drill read plus a 201 session, the usual first two answers. */
export const BASE_SCRIPT: FetchScript = {
  [DRILL_PATH]: [jsonResponse(200, fixtureDrill)],
  [START_PATH]: [jsonResponse(201, fixturePracticeSession)],
};

function parseBody(text: string): unknown {
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function renderRun({ script, seed, drillId = FIXTURE_DRILL_ID, schedule }: RenderRunOptions): RunView {
  const fake = createFakeFetch({ ...BASE_SCRIPT, ...script });
  const sent: SentRequest[] = [];
  const fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const body = parseBody(await request.clone().text());
    sent.push({
      key: `${request.method} ${url.pathname}`,
      idempotencyKey: request.headers.get("idempotency-key"),
      csrf: request.headers.get("x-csrf-token"),
      body,
    });
    return fake.fetch(request);
  };
  const api = createAppApi({ baseUrl: ORIGIN, fetch });
  api.tokens.set(FIXTURE_CSRF_TOKEN);
  const queryClient = createQueryClient();
  const clock: Clock = { now: 0 };
  let keyCount = 0;
  const deps: TrainerDeps = {
    now: () => clock.now,
    newKey: () => {
      keyCount += 1;
      return `key-${keyCount}`;
    },
    ...(schedule === undefined ? {} : { schedule }),
  };
  const router = createScreenRouter();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <HotkeyRoot store={createHotkeyStore()}>
          <TrainerDepsProvider deps={deps}>
            <ScreenRouterView router={router}>
              <DrillRunPage drillId={drillId} {...(seed === undefined ? {} : { seed })} />
            </ScreenRouterView>
          </TrainerDepsProvider>
        </HotkeyRoot>
      </ApiProvider>
    </QueryClientProvider>,
  );
  return { ...view, sent, clock, queryClient, api, router, sentTo: (key) => sent.filter((request) => request.key === key) };
}
