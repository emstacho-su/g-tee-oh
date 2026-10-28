/**
 * Test helper for the /quiz screen (S27 lane A, S41, R3.16). Renders the whole app at a path over
 * a memory history (so the route's search validation and the /predict redirect are the real ones)
 * and an injected fake fetch, signed in, with the catalog reads the start screen needs, and records
 * every request with its Idempotency-Key and csrf headers and its parsed body.
 */
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { createAppApi } from "../../src/api/index.js";
import { App } from "../../src/app/index.js";
import { createQueryClient } from "../../src/auth/index.js";
import { fixturePredictionSession } from "../../src/fixtures/prediction.js";
import { fixtureConfigs, fixturePairsByConfig } from "../../src/fixtures/study.js";
import { createAppRouter } from "../../src/router.js";
import { createFakeFetch, jsonResponse, sessionResponse, type FetchScript, type ResponseFactory } from "../api/fake-fetch.js";

export const ORIGIN = "http://localhost:4173";
export const SESSION_ID = fixturePredictionSession.session_id;
export const START_PATH = "POST /api/v1/sessions";
export const NEXT_PATH = `GET /api/v1/prediction/${SESSION_ID}/next`;
export const ANSWER_PATH = `POST /api/v1/prediction/${SESSION_ID}/answer`;
export const END_PATH = `POST /api/v1/sessions/${SESSION_ID}/end`;
export const CONFIGS_PATH = "GET /api/v1/configs";
export const REASON = "Facing a small open, the price is good.";

export interface SentRequest {
  key: string;
  idempotencyKey: string | null;
  csrf: string | null;
  body: unknown;
}

export interface QuizView extends RenderResult {
  sent: SentRequest[];
  sentTo: (key: string) => SentRequest[];
  history: ReturnType<typeof createMemoryHistory>;
  router: ReturnType<typeof createAppRouter>;
  queryClient: ReturnType<typeof createQueryClient>;
}

function parseBody(text: string): unknown {
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** GET /configs and every fixture configuration's pairs, one page each. */
export function catalogScript(): Record<string, readonly ResponseFactory[]> {
  const pairs = Object.entries(fixturePairsByConfig).map(([id, items]): [string, readonly ResponseFactory[]] => [
    `GET /api/v1/configs/${id}/pairs`,
    [jsonResponse(200, { config_id: id, items, next_cursor: null })],
  ]);
  return { [CONFIGS_PATH]: [jsonResponse(200, { items: fixtureConfigs, next_cursor: null })], ...Object.fromEntries(pairs) };
}

export function renderQuiz(path: string, script: FetchScript): QuizView {
  const fake = createFakeFetch({
    "GET /api/v1/me": [sessionResponse()],
    [START_PATH]: [jsonResponse(201, fixturePredictionSession)],
    ...catalogScript(),
    ...script,
  });
  const sent: SentRequest[] = [];
  const fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    sent.push({
      key: `${request.method} ${url.pathname}`,
      idempotencyKey: request.headers.get("idempotency-key"),
      csrf: request.headers.get("x-csrf-token"),
      body: parseBody(await request.clone().text()),
    });
    return fake.fetch(request);
  };
  const api = createAppApi({ baseUrl: ORIGIN, fetch });
  const queryClient = createQueryClient();
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter({ queryClient, api, history });
  const view = render(<App router={router} queryClient={queryClient} api={api} />);
  return { ...view, sent, history, router, queryClient, sentTo: (key) => sent.filter((request) => request.key === key) };
}

/** Types the required reason into the reason field. */
export async function typeReason(text: string = REASON): Promise<void> {
  await userEvent.type(screen.getByRole("textbox", { name: "Your reason (required)" }), text);
}
