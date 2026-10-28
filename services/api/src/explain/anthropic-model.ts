/**
 * The real model adapter of Ask (R3.20, O-305, ADR 0016): one POST to the Claude Messages API over
 * the platform fetch, with no SDK dependency (the lead's call for supply-chain surface, A9
 * section 3). The endpoint, headers, version, model id and prices come from the claude-api skill:
 * POST https://api.anthropic.com/v1/messages with x-api-key, anthropic-version 2026-10-21 and a
 * JSON content type; a body of model, max_tokens, system and one user message; no tools.
 *
 * Choices the skill settled for the default model, Claude Opus 5.5:
 * - Thinking cannot be turned off on it, so output_config.effort is low; there is no temperature,
 *   because sampling parameters return a 400 on API version 2026-10-21. The reply can open with a
 *   thinking block, so the text is every text block joined, not content[0].
 * - No server-side refusal fallback: a fallback model bills at its own prices, which the monthly
 *   cap reserves in advance and could not bound (O-306). A refusal is a failed call, refunded.
 *
 * The reply is untrusted input and is parsed with Zod. Every failure (a non-2xx status, a network
 * error, the timeout, a refusal, a body of the wrong shape) is a ModelCallError carrying at most
 * the status: never the response body, never the key, and no cause object a logger could
 * serialize. Each call is aborted after ASK_REQUEST_TIMEOUT_MS. Tests inject fetch.
 */
import { z } from "zod";

import { ModelCallError, type ModelClient, type ModelRequest, type ModelResponse } from "./model.js";

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2026-10-21";
/** Explanations are short and grounded; low effort keeps thinking, and so cost, small. */
export const ASK_EFFORT = "low";
/** How long one model call may take before it is aborted. */
export const ASK_REQUEST_TIMEOUT_MS = 30_000;

const API_KEY_HEADER = "x-api-key";
const VERSION_HEADER = "anthropic-version";
const CONTENT_TYPE_HEADER = "content-type";
const JSON_CONTENT_TYPE = "application/json";
const REFUSAL = "refusal";
const NO_TEXT = "";

const messageSchema = z.object({
  model: z.string(),
  stop_reason: z.string().nullable(),
  content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
  usage: z.looseObject({ input_tokens: z.number().int().min(0), output_tokens: z.number().int().min(0) }),
});

export interface AnthropicModelOptions {
  apiKey: string;
  model: string;
  /** Lets a test answer the call without a socket. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function requestInit(options: AnthropicModelOptions, request: ModelRequest): RequestInit {
  return {
    method: "POST",
    headers: {
      [API_KEY_HEADER]: options.apiKey,
      [VERSION_HEADER]: ANTHROPIC_VERSION,
      [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE,
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
      output_config: { effort: ASK_EFFORT },
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? ASK_REQUEST_TIMEOUT_MS),
  };
}

/** Sends the request; network failures and timeouts become a ModelCallError with no status. */
async function send(fetchImpl: typeof fetch, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(ANTHROPIC_MESSAGES_URL, init);
  } catch (error: unknown) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new ModelCallError(timedOut ? "it timed out" : "the connection failed");
  }
}

async function bodyOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ModelCallError("the reply was not JSON", { status: response.status });
  }
}

function responseOf(body: unknown, status: number): ModelResponse {
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) {
    throw new ModelCallError("the reply had an unexpected shape", { status });
  }
  const message = parsed.data;
  if (message.stop_reason === REFUSAL) {
    throw new ModelCallError("the model refused", { status });
  }
  const text = message.content.map((block) => (block.type === "text" ? (block.text ?? NO_TEXT) : NO_TEXT)).join(NO_TEXT);
  if (text.trim() === NO_TEXT) {
    throw new ModelCallError("the reply held no text", { status });
  }
  return { text, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens, model: message.model };
}

export function createAnthropicModel(options: AnthropicModelOptions): ModelClient {
  const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  return {
    complete: async (request: ModelRequest): Promise<ModelResponse> => {
      const response = await send(fetchImpl, requestInit(options, request));
      if (!response.ok) {
        // The body is never read into the error: it could echo the request.
        throw new ModelCallError(`the API answered ${response.status}`, { status: response.status });
      }
      return responseOf(await bodyOf(response), response.status);
    },
  };
}
