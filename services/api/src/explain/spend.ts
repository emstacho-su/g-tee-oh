/**
 * The monthly Ask spend (R3.20, O-306, O-5, A5 section 5): one llm_spend row per UTC calendar
 * month holding the cents spent and reserved.
 *
 * Mechanism: before a model call, reserveSpend adds the call's worst case to the month's row in
 * its own short transaction, under a row lock (insert the month if absent, then select ... for
 * update), and refuses when spent plus the reservation would pass the cap. Two concurrent asks at
 * the cap edge therefore serialize on the lock and only one fits. The reservation commits before
 * the call, so every later ask sees it. After the calls, settleSpend swaps the reservation for
 * what they may have cost (ask.ts, PR #29 review HIGH 1): an answer's usage priced in pricing.ts;
 * for a failed call, the usage its reply reported, nothing for a non-2xx status (the only full
 * refund), or the call's whole reservation when it was sent and no usage came back. Each Ask
 * settles once. The cents never go below zero.
 */
import { type RawBuilder, sql } from "kysely";

import type { Database } from "../db.js";

const MONTH_INDEX_PAD = 2;
const FIRST_DAY = "01";

/** The first day of `now`'s UTC month as an ISO date, the llm_spend key. */
export function monthOf(now: Date): string {
  const month = String(now.getUTCMonth() + 1).padStart(MONTH_INDEX_PAD, "0");
  return `${now.getUTCFullYear()}-${month}-${FIRST_DAY}`;
}

/** The month key as a SQL date, so the comparison is date to date in any server time zone. */
function monthDate(month: string): RawBuilder<Date> {
  return sql<Date>`cast(${month} as date)`;
}

/** Cents spent and reserved in the month; 0 when the month has no row yet. */
export async function spentCents(database: Database, month: string): Promise<number> {
  const row = await database.selectFrom("llm_spend").select("cents").where("month", "=", monthDate(month)).executeTakeFirst();
  return row?.cents ?? 0;
}

/** Whether a reservation of `cents` fits under the cap after `spent` (reserveSpend and the status). */
export function fitsCap(spentSoFar: number, cents: number, capCents: number): boolean {
  return spentSoFar + cents <= capCents;
}

/**
 * Adds `cents` to the month under a row lock unless the month would then pass `capCents`.
 * Returns true when reserved.
 */
export async function reserveSpend(database: Database, month: string, cents: number, capCents: number): Promise<boolean> {
  return database
    .transaction()
    .execute(async (transaction) => {
      await transaction
        .insertInto("llm_spend")
        .values({ month, cents: 0 })
        .onConflict((conflict) => conflict.column("month").doNothing())
        .execute();
      const row = await transaction
        .selectFrom("llm_spend")
        .select("cents")
        .where("month", "=", monthDate(month))
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (!fitsCap(row.cents, cents, capCents)) {
        return false;
      }
      await transaction.updateTable("llm_spend").set({ cents: row.cents + cents }).where("month", "=", monthDate(month)).execute();
      return true;
    });
}

/** Replaces a reservation with the real cost (0 refunds it in full); never below zero. */
export async function settleSpend(database: Database, month: string, reservedCents: number, actualCents: number): Promise<void> {
  await database
    .updateTable("llm_spend")
    .set({ cents: sql<number>`greatest(0, cents - ${reservedCents} + ${actualCents})` })
    .where("month", "=", monthDate(month))
    .execute();
}
