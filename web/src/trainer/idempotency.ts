/**
 * Idempotency-Key factory for the trainer's POST requests (S25, R3.13, O-232). The api replays the
 * first answer to a repeat with the same key, so a retried decision is graded once. The factory is
 * injected (trainer-deps.tsx): the app uses crypto.randomUUID, tests a counter.
 */
export type KeyFactory = () => string;

/** The header the api reads the key from (A5 section 3). */
export const IDEMPOTENCY_HEADER = "idempotency-key";

export function createKeyFactory(randomUuid: () => string = () => crypto.randomUUID()): KeyFactory {
  return () => randomUuid();
}
