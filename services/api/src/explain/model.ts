/**
 * The model port of Ask (R3.20, O-305, ADR 0016): the only external call the api makes goes
 * through ModelClient.complete, so the route never knows which SDK answers and tests inject a
 * scripted mock (test/support/mock-model.ts). The real adapter is anthropic-model.ts, built by
 * main.ts only when EXPLAIN_ASK_ENABLED is on and a key is configured.
 *
 * buildApp decorates the app with the client, or null when there is none (the flag is off, the
 * OpenAPI export, most tests); Ask then answers 503 ask-disabled. A request carries one system
 * prompt (instructions plus the grounding JSON) and one user turn (the question only, PM3).
 */
import "fastify";

import type { TokenUsage } from "./pricing.js";

export interface ModelRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export interface ModelResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

/**
 * What a failed call may have cost (PR #29 review HIGH 1), so the spend is settled to it and the
 * cap holds even when calls fail:
 * - none: the API answered a non-2xx status, which it does not bill; the call is refunded.
 * - usage: a 2xx body was read and reported its usage (a refusal, a reply with thinking only, a
 *   reply of the wrong shape whose usage still parsed); the call is settled at that usage.
 * - unknown: the request was sent but no usage was read (a timeout, a dropped connection, a body
 *   that was not JSON); the API may have billed it, so the call keeps its full reservation.
 */
export type ModelCharge = { kind: "none" } | { kind: "usage"; usage: TokenUsage } | { kind: "unknown" };

const UNKNOWN_CHARGE: ModelCharge = { kind: "unknown" };

/**
 * A model call that failed. It carries the HTTP status when there was one and what the call may
 * have cost, nothing else: its message is fixed text, never the upstream body or the key, and it
 * has no cause. An error built without a charge is unknown, the safe default for the cap.
 */
export class ModelCallError extends Error {
  readonly status: number | null;
  readonly charge: ModelCharge;

  constructor(reason: string, options: { status?: number; charge?: ModelCharge } = {}) {
    super(`the model call failed: ${reason}`);
    this.name = "ModelCallError";
    this.status = options.status ?? null;
    this.charge = options.charge ?? UNKNOWN_CHARGE;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    modelClient: ModelClient | null;
  }
}
