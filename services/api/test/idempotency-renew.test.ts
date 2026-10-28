/**
 * renewKey at the database level (R3.20, PR #29 re-review LOW 4): only the request that owns an
 * in-flight claim can restart its lease; a stale token, a settled claim and another user's key
 * are refused and leave the row unchanged.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db.js";
import { claimKey, completeKey, renewKey, type IdempotencyClaim } from "../src/plugins/idempotency-store.js";
import { adminPool, appDatabase, createTestUser } from "./support/database.js";

const HASH_BYTES = 32;
/** Backdated claims are 600 s old; a renewed one is a few seconds old at most. */
const STALE_AGE_SECONDS = 500;
const BACKDATE_SQL = "update idempotency_key set created_at = now() - make_interval(mins => 10) where user_id = $1 and key = $2";
const AGE_SQL = "select extract(epoch from now() - created_at)::float8 as age from idempotency_key where user_id = $1 and key = $2";

let database: Database;
let pool: pg.Pool;

beforeAll(() => {
  database = appDatabase();
  pool = adminPool();
});

afterAll(async () => {
  await pool.end();
  await database.destroy();
});

async function freshClaim(): Promise<IdempotencyClaim> {
  const user = await createTestUser(database);
  const outcome = await claimKey(database, {
    userId: user.id,
    key: randomUUID(),
    method: "POST",
    route: "/api/v1/explain/:attempt_id/ask",
    requestHash: Buffer.alloc(HASH_BYTES, 1),
  });
  if (outcome.kind !== "claimed") {
    throw new Error(`expected a fresh claim, got ${outcome.kind}`);
  }
  return outcome.claim;
}

async function backdate(claim: IdempotencyClaim): Promise<void> {
  await pool.query(BACKDATE_SQL, [claim.userId, claim.key]);
}

async function ageSeconds(claim: IdempotencyClaim): Promise<number> {
  const result = await pool.query<{ age: number }>(AGE_SQL, [claim.userId, claim.key]);
  return result.rows[0]?.age ?? Number.NaN;
}

describe("R3.20 renewKey (PR #29 re-review LOW 4)", () => {
  it("R3.20 the owning token restarts the lease", async () => {
    const claim = await freshClaim();
    await backdate(claim);
    expect(await renewKey(database, claim)).toBe(true);
    expect(await ageSeconds(claim)).toBeLessThan(STALE_AGE_SECONDS);
  });

  it("R3.20 a stale token is refused and the row keeps its age", async () => {
    const claim = await freshClaim();
    await backdate(claim);
    expect(await renewKey(database, { ...claim, token: randomUUID() })).toBe(false);
    expect(await ageSeconds(claim)).toBeGreaterThan(STALE_AGE_SECONDS);
  });

  it("R3.20 a settled claim and another user's key are refused", async () => {
    const claim = await freshClaim();
    const other = await freshClaim();
    expect(await renewKey(database, { ...claim, userId: other.userId })).toBe(false);
    expect(await completeKey(database, claim, 200, null)).toBe(true);
    expect(await renewKey(database, claim)).toBe(false);
  });
});
