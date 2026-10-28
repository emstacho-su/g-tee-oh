/**
 * Test helper for the /predict screen (S27 lane A, R3.16). Renders the whole app at a path over a
 * memory history (so the picker's links and the route's search validation are the real ones) and
 * an injected fake fetch, signed in, and records every request with its Idempotency-Key and csrf
 * headers and its parsed body.
 */
import { createMemoryHistory } from "@tanstack/react-router";
import { render, type RenderResult } from "@testing-library/react";

import { createAppApi } from "../../src/api/index.js";
import { App } from "../../src/app/index.js";
import { createQueryClient } from "../../src/auth/index.js";
import { fixturePredictionSession } from "../../src/fixtures/prediction.js";
import { createAppRouter } from "../../src/router.js";
import { createFakeFetch, jsonResponse, sessionResponse, type FetchScript } from "../api/fake-fetch.js";

export const ORIGIN = "http://localhost:4173";
export const SESSION_ID = fixturePredictionSession.session_id;
export const DRILLS_PATH = "GET /api/v1/drills";
export const START_PATH = "POST /api/v1/sessions";
export const NEXT_PATH = `GET /api/v1/prediction/${SESSION_ID}/next`;
export const ANSWER_PATH = `POST /api/v1/prediction/${SESSION_ID}/answer`;

export interface SentRequest {
  key: string;
  idempotencyKey: string | null;
  csrf: string | null;
  body: unknown;
}

export interface PredictView extends RenderResult {
  sent: SentRequest[];
  sentTo: (key: string) => SentRequest[];
  history: ReturnType<typeof createMemoryHistory>;
}

function parseBody(text: string): unknown {
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function renderPredict(path: string, script: FetchScript): PredictView {
  const fake = createFakeFetch({
    "GET /api/v1/me": [sessionResponse()],
    [START_PATH]: [jsonResponse(201, fixturePredictionSession)],
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
  return { ...view, sent, history, sentTo: (key) => sent.filter((request) => request.key === key) };
}
