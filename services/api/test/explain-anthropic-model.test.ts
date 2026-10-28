/**
 * The Anthropic adapter of the model port (R3.20, O-305), exercised only through an injected
 * fetch: no network, no real key. It checks the request it builds (the Messages endpoint, the
 * x-api-key, anthropic-version and content-type headers, model, max tokens, the system prompt and
 * one user turn, low effort, no tools and no sampling parameters, a timeout signal), how it reads
 * the reply and its usage, and that every failure is a ModelCallError carrying at most the status,
 * never the key or the upstream body.
 */
import { describe, expect, it } from "vitest";

import {
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_VERSION,
  ASK_EFFORT,
  ASK_MIN_OUTPUT_TOKENS_PER_SECOND,
  ASK_REQUEST_TIMEOUT_MS,
  createAnthropicModel,
} from "../src/explain/anthropic-model.js";
import { ASK_MAX_TOKENS } from "../src/explain/prompt.js";

const MS_PER_SECOND = 1000;
import { ModelCallError } from "../src/explain/model.js";

// A made-up value shaped like no real key (O-54).
const FAKE_KEY = "test-only-not-a-key-anthropic-adapter";
const MODEL = "claude-opus-5-5";
const REQUEST = { system: "SYSTEM", user: "QUESTION", maxTokens: 900 };

interface Captured {
  url: string;
  init: RequestInit;
  body: string;
}

function messageBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: MODEL,
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: "Call is played " },
      { type: "text", text: "50.2% of the time." },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 812, output_tokens: 95, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    ...overrides,
  };
}

function fakeFetch(status: number, replyBody: string, captured: Captured[]): typeof fetch {
  return (input, init) => {
    const sent = init?.body;
    const url = input instanceof Request ? input.url : input.toString();
    captured.push({ url, init: init ?? {}, body: typeof sent === "string" ? sent : "" });
    return Promise.resolve(new Response(replyBody, { status, headers: { "content-type": "application/json" } }));
  };
}

function adapter(status: number, body: unknown, captured: Captured[] = []) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return createAnthropicModel({ apiKey: FAKE_KEY, model: MODEL, fetch: fakeFetch(status, text, captured) });
}

async function failureOf(promise: Promise<unknown>): Promise<ModelCallError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof ModelCallError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
}

describe("R3.20 Anthropic model adapter", () => {
  it("R3.20 sends one Messages request with the skill's headers, the system prompt, one user turn and low effort", async () => {
    const captured: Captured[] = [];
    const reply = await adapter(200, messageBody(), captured).complete(REQUEST);

    expect(captured).toHaveLength(1);
    const call = captured[0];
    expect(call?.url).toBe(ANTHROPIC_MESSAGES_URL);
    expect(call?.init.method).toBe("POST");
    expect(call?.init.headers).toEqual({ "x-api-key": FAKE_KEY, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" });
    expect(ANTHROPIC_VERSION).toBe("2026-10-21");
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(call?.body ?? "") as Record<string, unknown>;
    expect(body).toEqual({
      model: MODEL,
      max_tokens: 900,
      system: "SYSTEM",
      messages: [{ role: "user", content: "QUESTION" }],
      output_config: { effort: ASK_EFFORT },
    });
    expect(call?.body).not.toContain(FAKE_KEY);
    expect(reply).toEqual({ text: "Call is played 50.2% of the time.", inputTokens: 812, outputTokens: 95, model: MODEL });
  });

  it("R3.20 a non-2xx answer is a ModelCallError with the status only, never the key or the body", async () => {
    const error = await failureOf(
      adapter(500, { type: "error", error: { type: "api_error", message: "upstream secret detail" } }).complete(REQUEST),
    );
    expect(error.status).toBe(500);
    expect(error.message).toMatch(/500/);
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("upstream secret detail");
    expect(error.cause).toBeUndefined();
  });

  it("R3.20 a refusal, a reply without text, a body that is not JSON and a wrong shape are ModelCallErrors", async () => {
    const refusal = await failureOf(adapter(200, messageBody({ stop_reason: "refusal", content: [] })).complete(REQUEST));
    expect(refusal.message).toMatch(/refused/);
    const noText = await failureOf(adapter(200, messageBody({ content: [{ type: "thinking", thinking: "" }] })).complete(REQUEST));
    expect(noText.message).toMatch(/no text/);
    const notJson = await failureOf(adapter(200, "<html>gateway</html>").complete(REQUEST));
    expect(notJson.message).toMatch(/not JSON/);
    const wrongShape = await failureOf(adapter(200, { usage: "none" }).complete(REQUEST));
    expect(wrongShape.message).toMatch(/unexpected shape/);
    expect(wrongShape.status).toBe(200);
  });

  it("R3.20 a network failure is a ModelCallError with no status", async () => {
    const failing: typeof fetch = () => Promise.reject(new TypeError(`connect refused ${FAKE_KEY}`));
    const error = await failureOf(createAnthropicModel({ apiKey: FAKE_KEY, model: MODEL, fetch: failing }).complete(REQUEST));
    expect(error.status).toBeNull();
    expect(error.message).toMatch(/connection failed/);
    expect(error.message).not.toContain(FAKE_KEY);
  });

  it("R3.20 a call past the timeout is aborted and is a ModelCallError", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "TimeoutError")));
      });
    const model = createAnthropicModel({ apiKey: FAKE_KEY, model: MODEL, fetch: hanging, timeoutMs: 20 });
    const error = await failureOf(model.complete(REQUEST));
    expect(error.message).toMatch(/timed out/);
  });
});

describe("R3.20 what a failed call costs (PR #29 review HIGH 1)", () => {
  const USAGE = { input_tokens: 700, output_tokens: 410 };

  it("R3.20 a non-2xx answer charges nothing: the API did not bill it", async () => {
    const error = await failureOf(adapter(529, { type: "error", error: { type: "overloaded_error" } }).complete(REQUEST));
    expect(error.charge).toEqual({ kind: "none" });
  });

  it("R3.20 a refusal carries the usage the reply reported", async () => {
    const error = await failureOf(adapter(200, messageBody({ stop_reason: "refusal", content: [], usage: USAGE })).complete(REQUEST));
    expect(error.charge).toEqual({ kind: "usage", usage: { inputTokens: 700, outputTokens: 410 } });
  });

  it("R3.20 a thinking-only reply carries the usage the reply reported", async () => {
    const thinkingOnly = messageBody({ stop_reason: "max_tokens", content: [{ type: "thinking", thinking: "" }], usage: USAGE });
    const error = await failureOf(adapter(200, thinkingOnly).complete(REQUEST));
    expect(error.charge).toEqual({ kind: "usage", usage: { inputTokens: 700, outputTokens: 410 } });
  });

  it("R3.20 a wrong shape with a readable usage carries it; without one the charge is unknown", async () => {
    const withUsage = await failureOf(adapter(200, { content: "not a list", usage: USAGE }).complete(REQUEST));
    expect(withUsage.charge).toEqual({ kind: "usage", usage: { inputTokens: 700, outputTokens: 410 } });
    const withoutUsage = await failureOf(adapter(200, { usage: "none" }).complete(REQUEST));
    expect(withoutUsage.charge).toEqual({ kind: "unknown" });
    const notJson = await failureOf(adapter(200, "<html>gateway</html>").complete(REQUEST));
    expect(notJson.charge).toEqual({ kind: "unknown" });
  });

  it("R3.20 a timeout or network failure after the request was sent may have been billed: the charge is unknown", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "TimeoutError")));
      });
    const timedOut = await failureOf(createAnthropicModel({ apiKey: FAKE_KEY, model: MODEL, fetch: hanging, timeoutMs: 20 }).complete(REQUEST));
    expect(timedOut.charge).toEqual({ kind: "unknown" });
    const failing: typeof fetch = () => Promise.reject(new TypeError("socket hang up"));
    const dropped = await failureOf(createAnthropicModel({ apiKey: FAKE_KEY, model: MODEL, fetch: failing }).complete(REQUEST));
    expect(dropped.charge).toEqual({ kind: "unknown" });
  });

  it("R3.20 the timeout fits max_tokens at the slowest output rate assumed", () => {
    const slowestSeconds = ASK_MAX_TOKENS / ASK_MIN_OUTPUT_TOKENS_PER_SECOND;
    expect(slowestSeconds * MS_PER_SECOND).toBeLessThan(ASK_REQUEST_TIMEOUT_MS);
  });
});
