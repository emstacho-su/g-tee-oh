/**
 * Test helper for /train (S32, R4.10, R4.12). Renders TrainPage inside the app's providers (Query,
 * api, an isolated hotkey store, injected trainer dependencies) and the drill run tests' small
 * memory router (its notes and links need a router), over the scripted fake fetch, and records
 * every request with its Idempotency-Key and body, as render-run.tsx does for the drill run. The
 * session defaults store is the app's singleton; setDefaults replaces its state for one test and
 * resetDefaults puts the plain defaults back.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, type RenderResult } from "@testing-library/react";

import { createAppApi } from "../../src/api/index.js";
import { ApiProvider, createQueryClient } from "../../src/auth/index.js";
import { FIXTURE_CSRF_TOKEN } from "../../src/fixtures/index.js";
import { FIXTURE_AUTOMATED_SESSION_ID, FIXTURE_HOLDOUT_SESSION_ID } from "../../src/fixtures/automated.js";
import { fixtureHeatmap, fixtureTracks } from "../../src/fixtures/progress.js";
import { HotkeyRoot, createHotkeyStore } from "../../src/hotkeys/index.js";
import { TrainPage } from "../../src/routes/train/TrainPage.js";
import type { TrainMode } from "../../src/routes/train/train-text.js";
import { DEFAULT_SESSION_DEFAULTS, useSessionDefaultsStore, type SessionDefaults } from "../../src/store/session-defaults.js";
import { TrainerDepsProvider, type TrainerDeps } from "../../src/trainer/trainer-deps.js";
import { createFakeFetch, jsonResponse, type FetchScript } from "../api/fake-fetch.js";
import { createScreenRouter, ScreenRouterView, type ScreenRouter } from "../trainer-screen/screen-router.js";

const ORIGIN = "http://localhost:4173";
export const START_PATH = "POST /api/v1/sessions";
export const TRACKS_PATH = "GET /api/v1/progress/tracks";
export const HEATMAP_PATH = "GET /api/v1/progress/heatmap";
export const CONFIGS_PATH = "GET /api/v1/configs";

export function sessionPaths(sessionId: string) {
  return {
    next: `GET /api/v1/sessions/${sessionId}/next`,
    decide: `POST /api/v1/sessions/${sessionId}/decisions`,
    end: `POST /api/v1/sessions/${sessionId}/end`,
  } as const;
}

export const AUTOMATED_PATHS = sessionPaths(FIXTURE_AUTOMATED_SESSION_ID);
export const HOLDOUT_PATHS = sessionPaths(FIXTURE_HOLDOUT_SESSION_ID);

/** The two side reads the screen makes: track names and the heat map's families. */
export const SIDE_READS: FetchScript = {
  [TRACKS_PATH]: [jsonResponse(200, { items: [...fixtureTracks], next_cursor: null })],
  [HEATMAP_PATH]: [jsonResponse(200, fixtureHeatmap)],
};

export interface SentRequest {
  key: string;
  idempotencyKey: string | null;
  body: unknown;
}

export interface TrainView extends RenderResult {
  sentTo: (key: string) => SentRequest[];
  queryClient: ReturnType<typeof createQueryClient>;
  router: ScreenRouter;
}

function parseBody(text: string): unknown {
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function setDefaults(defaults: Partial<SessionDefaults>): void {
  useSessionDefaultsStore.setState({ defaults: { ...DEFAULT_SESSION_DEFAULTS, ...defaults } });
}

export function resetDefaults(): void {
  useSessionDefaultsStore.setState({ defaults: DEFAULT_SESSION_DEFAULTS });
}

/** Renders the page and waits until the router has shown its heading. */
export async function renderTrain(mode: TrainMode, script: FetchScript): Promise<TrainView> {
  const fake = createFakeFetch({ ...SIDE_READS, ...script });
  const sent: SentRequest[] = [];
  const fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    sent.push({ key: `${request.method} ${url.pathname}`, idempotencyKey: request.headers.get("idempotency-key"), body: parseBody(await request.clone().text()) });
    return fake.fetch(request);
  };
  const api = createAppApi({ baseUrl: ORIGIN, fetch });
  api.tokens.set(FIXTURE_CSRF_TOKEN);
  const queryClient = createQueryClient();
  let keyCount = 0;
  const deps: TrainerDeps = {
    now: () => 0,
    newKey: () => {
      keyCount += 1;
      return `key-${keyCount}`;
    },
  };
  const router = createScreenRouter();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <HotkeyRoot store={createHotkeyStore()}>
          <TrainerDepsProvider deps={deps}>
            <ScreenRouterView router={router}>
              <TrainPage mode={mode} />
            </ScreenRouterView>
          </TrainerDepsProvider>
        </HotkeyRoot>
      </ApiProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { level: 1 });
  return { ...view, queryClient, router, sentTo: (key) => sent.filter((request) => request.key === key) };
}
