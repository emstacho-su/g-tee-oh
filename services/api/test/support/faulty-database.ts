/**
 * A Kysely handle over the test database whose connections can fail on cue (R3.20, PR #29
 * re-review LOW 2 and 3), so a test can prove what the Ask does when the database misbehaves at
 * one exact point. Each fault fires once and then disarms:
 * - commitThenFail(pattern): on the first connection that runs a statement matching `pattern`,
 *   the next COMMIT is executed (the transaction really commits) and then reported as an error,
 *   the case where the database committed but the client never heard back;
 * - failNext(pattern): the next statement matching `pattern` throws without running.
 *
 * It wraps pg's client.query, which Kysely's Postgres driver calls with (sql, parameters), and
 * changes nothing else.
 */
import pg from "pg";
import { Kysely, PostgresDialect } from "kysely";
import { inject } from "vitest";

import type { DB } from "@g-tee-oh/contracts";
import type { Database } from "../../src/db.js";

const COMMIT = /^\s*commit\s*;?\s*$/i;
const POOL_MAX = 4;

export interface FaultyDatabase {
  database: Database;
  commitThenFail(pattern: RegExp): void;
  failNext(pattern: RegExp): void;
  /** How many faults have fired. */
  fired(): number;
}

type QueryFunction = (text: unknown, ...rest: unknown[]) => Promise<unknown>;

export function faultyDatabase(): FaultyDatabase {
  const pool = new pg.Pool({ connectionString: inject("appDatabaseUrl"), max: POOL_MAX });
  let commitPattern: RegExp | null = null;
  let failPattern: RegExp | null = null;
  let firedCount = 0;
  const marked = new WeakSet<object>();
  const wrapped = new WeakSet<object>();

  const wrap = (client: pg.PoolClient): void => {
    if (wrapped.has(client)) {
      return;
    }
    wrapped.add(client);
    const original = client.query.bind(client) as QueryFunction;
    const replacement: QueryFunction = async (text, ...rest) => {
      const sql = typeof text === "string" ? text : "";
      if (failPattern?.test(sql) === true) {
        failPattern = null;
        firedCount += 1;
        throw new Error("injected query failure");
      }
      if (commitPattern?.test(sql) === true) {
        marked.add(client);
      }
      const result = await original(text, ...rest);
      if (COMMIT.test(sql) && marked.has(client)) {
        marked.delete(client);
        commitPattern = null;
        firedCount += 1;
        throw new Error("injected failure after a commit that succeeded");
      }
      return result;
    };
    (client as unknown as { query: QueryFunction }).query = replacement;
  };

  const connect = pool.connect.bind(pool) as () => Promise<pg.PoolClient>;
  (pool as unknown as { connect: () => Promise<pg.PoolClient> }).connect = async () => {
    const client = await connect();
    wrap(client);
    return client;
  };

  return {
    database: new Kysely<DB>({ dialect: new PostgresDialect({ pool }) }),
    commitThenFail: (pattern) => {
      commitPattern = pattern;
    },
    failNext: (pattern) => {
      failPattern = pattern;
    },
    fired: () => firedCount,
  };
}
