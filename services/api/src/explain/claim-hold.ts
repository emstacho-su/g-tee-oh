/**
 * Keeps an Ask's Idempotency-Key claim alive for the whole Ask (R3.20, PR #29 review HIGH 2).
 *
 * An Ask can run two model calls of up to ASK_REQUEST_TIMEOUT_MS each, longer than the 60 s
 * IDEMPOTENCY_LEASE_SECONDS after which a same-key retry may take a claim over. So the Ask renews
 * its claim (idempotency-store.ts renewKey) before each model call, and a timer renews it every
 * CLAIM_RENEW_INTERVAL_MS while a call runs; the interval is a third of the lease, so two renewals
 * can fail in a row before the lease could lapse. A retry during the Ask therefore always finds
 * the claim in flight (409) and never reserves or calls again.
 *
 * renew() reports whether the claim is still this request's. When it is not (the lease lapsed
 * anyway, for example after a long database stall, and a retry took it over), the Ask stops before
 * its next call and answers 409, and idempotentWrite would refuse to commit for it too. A request
 * without an Idempotency-Key has no claim and nothing to renew. The timer is unref'd, so it never
 * keeps the process alive, and stop() must be called when the Ask ends.
 */
import type { FastifyBaseLogger } from "fastify";

import type { Database } from "../db.js";
import { IDEMPOTENCY_LEASE_SECONDS, type IdempotencyClaim, renewKey } from "../plugins/idempotency-store.js";

const MS_PER_SECOND = 1000;
const RENEWALS_PER_LEASE = 3;

/** How often a running Ask renews its claim: a third of the lease, 20 s. */
export const CLAIM_RENEW_INTERVAL_MS = (IDEMPOTENCY_LEASE_SECONDS * MS_PER_SECOND) / RENEWALS_PER_LEASE;

export interface ClaimHold {
  /** Renews now; false when the claim is no longer this request's. */
  renew(): Promise<boolean>;
  stop(): void;
}

const NO_CLAIM: ClaimHold = { renew: () => Promise.resolve(true), stop: () => undefined };

export interface ClaimHoldOptions {
  renewKey?: (database: Database, claim: IdempotencyClaim) => Promise<boolean>;
  intervalMs?: number;
}

/** Holds `claim` until stop(); a null claim (no Idempotency-Key) holds nothing. */
export function holdClaim(
  database: Database,
  claim: IdempotencyClaim | null,
  log: FastifyBaseLogger,
  options: ClaimHoldOptions = {},
): ClaimHold {
  if (claim === null) {
    return NO_CLAIM;
  }
  const renewOnce = options.renewKey ?? renewKey;
  let held = true;
  const renew = async (): Promise<boolean> => {
    if (held) {
      held = await renewOnce(database, claim);
    }
    return held;
  };
  const timer = setInterval(() => {
    renew().catch((error: unknown) => {
      // The next renewal (or the one before the next call) tries again; the lease covers a miss.
      log.warn({ error_name: error instanceof Error ? error.name : typeof error }, "could not renew an Ask's Idempotency-Key claim");
    });
  }, options.intervalMs ?? CLAIM_RENEW_INTERVAL_MS);
  timer.unref();
  return { renew, stop: () => clearInterval(timer) };
}
