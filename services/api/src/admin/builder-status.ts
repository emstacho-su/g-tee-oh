/**
 * The builder status the admin screen shows (R3.5, A5 section 3, O-36, O-188), read from the
 * builder's tables with the app role's select grant and from the event hub's last builder_state.
 *
 * - state: paused when the stored paused setting is true (the builder reads it on its next claim),
 *   else the last builder_state the hub saw since the api started, else unknown.
 * - queue: build_job rows by status; done rows are throughput, not queue.
 * - throughput_per_hour: build_job rows done within the last THROUGHPUT_WINDOW_HOURS, divided by
 *   that window. done rows carry their completion time in updated_at.
 * - storage: the latest storage_ledger row, zeros before the builder has written one.
 * - settings: the stored overrides only; an absent key means the builder's default (O-188).
 */
import type { DB } from "@g-tee-oh/contracts";
import { sql } from "kysely";
import type { z } from "zod";

import type { Database } from "../db.js";
import type { BuilderStatePayload } from "../events/payloads.js";
import type { builderStatusSchema } from "../schemas/insights.js";
import { PAUSED_KEY } from "./settings-keys.js";

export type BuilderStatus = z.infer<typeof builderStatusSchema>;
export type StoredSettings = Readonly<Record<string, unknown>>;
type StoredValue = DB["builder_setting"]["value"];

/** The window throughput is measured over, in hours. */
export const THROUGHPUT_WINDOW_HOURS = 24;
const MS_PER_HOUR = 3_600_000;
const PAUSED_REASON = "The paused setting is on.";

const QUEUE_STATUSES = ["queued", "running", "failed", "blocked_budget"] as const;
type QueueCounts = Record<(typeof QUEUE_STATUSES)[number], number>;

/** Every stored override, as key to JSON value. */
export async function readStoredSettings(database: Database): Promise<StoredSettings> {
  const rows = await database.selectFrom("builder_setting").select(["key", "value"]).orderBy("key").execute();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

async function readQueueCounts(database: Database): Promise<QueueCounts> {
  const rows = await database
    .selectFrom("build_job")
    .select(["status", (eb) => eb.fn.countAll<string>().as("count")])
    .where("status", "in", QUEUE_STATUSES)
    .groupBy("status")
    .execute();
  const counted = new Map(rows.map((row) => [row.status, Number(row.count)]));
  return {
    queued: counted.get("queued") ?? 0,
    running: counted.get("running") ?? 0,
    failed: counted.get("failed") ?? 0,
    blocked_budget: counted.get("blocked_budget") ?? 0,
  };
}

async function readThroughputPerHour(database: Database, now: Date): Promise<number> {
  const since = new Date(now.getTime() - THROUGHPUT_WINDOW_HOURS * MS_PER_HOUR);
  const row = await database
    .selectFrom("build_job")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("status", "=", "done")
    .where("updated_at", ">", since)
    .where("updated_at", "<=", now)
    .executeTakeFirstOrThrow();
  return Number(row.count) / THROUGHPUT_WINDOW_HOURS;
}

async function readStorage(database: Database): Promise<BuilderStatus["storage"]> {
  const row = await database
    .selectFrom("storage_ledger")
    .select(["library_bytes", "reference_bytes"])
    .orderBy("day", "desc")
    .limit(1)
    .executeTakeFirst();
  return row === undefined
    ? { library_bytes: 0, reference_bytes: 0 }
    : { library_bytes: Number(row.library_bytes), reference_bytes: Number(row.reference_bytes) };
}

function currentState(
  settings: StoredSettings,
  last: BuilderStatePayload | null,
): Pick<BuilderStatus, "state" | "reason"> {
  if (settings[PAUSED_KEY] === true) {
    return { state: "paused", reason: PAUSED_REASON };
  }
  return last === null ? { state: "unknown", reason: null } : { state: last.state, reason: last.reason };
}

/** The status, from `database` (the request's handle or a write transaction). */
export async function readBuilderStatus(
  database: Database,
  lastState: BuilderStatePayload | null,
  now: Date = new Date(),
): Promise<BuilderStatus> {
  const [settings, queue, throughput, storage] = await Promise.all([
    readStoredSettings(database),
    readQueueCounts(database),
    readThroughputPerHour(database, now),
    readStorage(database),
  ]);
  return { ...currentState(settings, lastState), queue, throughput_per_hour: throughput, storage, settings };
}

/** Upserts each setting in one statement; the caller runs it inside its transaction (O-241). */
export async function upsertSettings(database: Database, settings: StoredSettings): Promise<void> {
  const rows = Object.entries(settings).map(([key, value]) => ({
    key,
    // jsonb from the JSON text: pg would send a JavaScript array as a Postgres array otherwise.
    value: sql<StoredValue>`cast(${JSON.stringify(value)} as jsonb)`,
  }));
  if (rows.length === 0) {
    return;
  }
  await database
    .insertInto("builder_setting")
    .values(rows)
    .onConflict((conflict) => conflict.column("key").doUpdateSet((eb) => ({ value: eb.ref("excluded.value") })))
    .execute();
}
