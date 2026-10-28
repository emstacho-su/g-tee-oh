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
 * A model call that failed. It carries the HTTP status when there was one and nothing else: its
 * message is fixed text, never the upstream body or the key, and it has no cause.
 */
export class ModelCallError extends Error {
  readonly status: number | null;

  constructor(reason: string, options: { status?: number } = {}) {
    super(`the model call failed: ${reason}`);
    this.name = "ModelCallError";
    this.status = options.status ?? null;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    modelClient: ModelClient | null;
  }
}
