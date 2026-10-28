/**
 * Tests for the explain query factories, the ask call, the fixed texts and the two Ask problem
 * kinds (S27 lane D, R3.19, R3.20, O-305 to O-307). Every request goes through an injected fake
 * fetch; nothing opens a socket.
 */
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { ApiProblem, createAppApi } from "../../src/api/index.js";
import { isAskCapReached, isAskDisabled } from "../../src/api/problem-kinds.js";
import { askQuestion, askStatusKey, askStatusQuery, moreInfoKey, moreInfoQuery } from "../../src/explain/queries.js";
import { askProblemText, askUnavailableText, EXPLAIN_TEXT } from "../../src/explain/texts.js";
import { fixtureFeedback } from "../../src/fixtures/index.js";
import {
  fixtureAskAnswer,
  fixtureAskStatus,
  fixtureAskStatusCapReached,
  fixtureAskStatusFlagOff,
  fixtureMoreInfo,
} from "../../src/fixtures/explain.js";
import { createFakeFetch, jsonResponse, problemResponse, sessionResponse } from "../api/fake-fetch.js";
import type { FetchScript } from "../api/fake-fetch.js";

const ORIGIN = "http://localhost:4173";
const ATTEMPT = fixtureFeedback.attempt_id;
const STATUS_PATH = "GET /api/v1/explain/status";
const MORE_INFO_PATH = `GET /api/v1/explain/${ATTEMPT}/more-info`;
const ASK_PATH = `POST /api/v1/explain/${ATTEMPT}/ask`;
const ME_PATH = "GET /api/v1/me";

function apiWith(script: FetchScript) {
  const fake = createFakeFetch(script);
  const idempotencyKeys: (string | null)[] = [];
  const api = createAppApi({
    baseUrl: ORIGIN,
    fetch: (request) => {
      idempotencyKeys.push(request.headers.get("idempotency-key"));
      return fake.fetch(request);
    },
  });
  return { api, fake, idempotencyKeys };
}

describe("R3.20 Ask problem kinds", () => {
  it("R3.20 isAskDisabled is true only for a 503 ask-disabled problem", () => {
    expect(isAskDisabled(new ApiProblem({ status: 503, slug: "ask-disabled", title: "t" }))).toBe(true);
    expect(isAskDisabled(new ApiProblem({ status: 503, slug: "solver-query-unavailable", title: "t" }))).toBe(false);
    expect(isAskDisabled(new ApiProblem({ status: 429, slug: "ask-disabled", title: "t" }))).toBe(false);
    expect(isAskDisabled(new Error("ask-disabled"))).toBe(false);
  });

  it("R3.20 isAskCapReached is true only for a 429 ask-cap-reached problem", () => {
    expect(isAskCapReached(new ApiProblem({ status: 429, slug: "ask-cap-reached", title: "t" }))).toBe(true);
    expect(isAskCapReached(new ApiProblem({ status: 429, slug: "rate-limited", title: "t" }))).toBe(false);
    expect(isAskCapReached(new ApiProblem({ status: 503, slug: "ask-cap-reached", title: "t" }))).toBe(false);
    expect(isAskCapReached(null)).toBe(false);
  });
});

describe("R3.20 Ask fixed texts", () => {
  it("R3.20 the status gives no reason when Ask is available", () => {
    expect(askUnavailableText(fixtureAskStatus)).toBeNull();
  });

  it("R3.20 flag_off and cap_reached map to their fixed texts", () => {
    expect(askUnavailableText(fixtureAskStatusFlagOff)).toBe("Ask is off until a model key is configured");
    expect(askUnavailableText(fixtureAskStatusCapReached)).toBe("This month's Ask budget is used");
  });

  it("R3.20 an unavailable status whose reason is ok still names a reason", () => {
    expect(askUnavailableText({ ...fixtureAskStatus, available: false })).toBe(EXPLAIN_TEXT.unavailable);
  });

  it("R3.20 the ask-disabled and ask-cap-reached problems map to the same fixed texts, others to null", () => {
    expect(askProblemText(new ApiProblem({ status: 503, slug: "ask-disabled", title: "t" }))).toBe(EXPLAIN_TEXT.flagOff);
    expect(askProblemText(new ApiProblem({ status: 429, slug: "ask-cap-reached", title: "t" }))).toBe(EXPLAIN_TEXT.capReached);
    expect(askProblemText(new ApiProblem({ status: 502, slug: "upstream", title: "t" }))).toBeNull();
  });
});

describe("R3.20 askStatusQuery", () => {
  it("R3.20 reads GET /explain/status under a stable key and is always refetched on mount", async () => {
    const { api, fake } = apiWith({ [STATUS_PATH]: [jsonResponse(200, fixtureAskStatus)] });
    const options = askStatusQuery(api);
    expect(options.queryKey).toEqual(askStatusKey());
    expect(options.queryKey).toEqual(["explain", "status"]);
    expect(options.staleTime).toBe(0);
    await expect(new QueryClient().fetchQuery(options)).resolves.toEqual(fixtureAskStatus);
    expect(fake.keys()).toEqual([STATUS_PATH]);
  });

  it("R3.20 a failure becomes an ApiProblem", async () => {
    const { api } = apiWith({ [STATUS_PATH]: [problemResponse(500, "internal")] });
    await expect(new QueryClient().fetchQuery(askStatusQuery(api))).rejects.toMatchObject({ status: 500, slug: "internal" });
  });
});

describe("R3.19 moreInfoQuery", () => {
  it("R3.19 reads GET /explain/{attempt_id}/more-info keyed by the attempt", async () => {
    const { api, fake } = apiWith({ [MORE_INFO_PATH]: [jsonResponse(200, fixtureMoreInfo)] });
    const options = moreInfoQuery(api, ATTEMPT);
    expect(options.queryKey).toEqual(moreInfoKey(ATTEMPT));
    expect(options.queryKey).toEqual(["explain", "more-info", ATTEMPT]);
    await expect(new QueryClient().fetchQuery(options)).resolves.toEqual(fixtureMoreInfo);
    expect(fake.keys()).toEqual([MORE_INFO_PATH]);
  });

  it("R3.19 a failure becomes an ApiProblem", async () => {
    const { api } = apiWith({ [MORE_INFO_PATH]: [problemResponse(404, "not-found")] });
    await expect(new QueryClient().fetchQuery(moreInfoQuery(api, ATTEMPT))).rejects.toMatchObject({ status: 404, slug: "not-found" });
  });
});

describe("R3.20 askQuestion", () => {
  it("R3.20 posts the question with the CSRF token and the Idempotency-Key", async () => {
    const { api, fake, idempotencyKeys } = apiWith({ [ME_PATH]: [sessionResponse("token-1")], [ASK_PATH]: [jsonResponse(200, fixtureAskAnswer)] });
    const result = await askQuestion(api, { attemptId: ATTEMPT, question: "Why raise?", idempotencyKey: "key-1" });
    expect(result).toEqual(fixtureAskAnswer);
    expect(fake.keys()).toEqual([ME_PATH, ASK_PATH]);
    const ask = fake.calls[1];
    expect(ask?.csrf).toBe("token-1");
    expect(JSON.parse(ask?.body ?? "{}")).toEqual({ question: "Why raise?" });
    expect(idempotencyKeys.at(-1)).toBe("key-1");
  });

  it("R3.20 a 503 ask-disabled answer rejects with that problem", async () => {
    const { api } = apiWith({ [ME_PATH]: [sessionResponse()], [ASK_PATH]: [problemResponse(503, "ask-disabled")] });
    const failure = askQuestion(api, { attemptId: ATTEMPT, question: "Why?", idempotencyKey: "key-2" });
    await expect(failure).rejects.toMatchObject({ status: 503, slug: "ask-disabled" });
  });
});
