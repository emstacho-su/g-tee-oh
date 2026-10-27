/**
 * Idempotency-Key handling on mutating routes (R3.1, A5 section 3, O-232), over the
 * idempotency_key table: claim, run once, store, replay. Registered after authentication and the
 * CSRF guard.
 *
 * S21 lane C fills this in; until then it installs nothing.
 */
import type { FastifyInstance } from "fastify";
import fastifyPlugin from "fastify-plugin";

async function idempotencyPlugin(app: FastifyInstance): Promise<void> {
  await Promise.resolve(app);
}

export const idempotency = fastifyPlugin(idempotencyPlugin, { name: "g-tee-oh-idempotency" });
