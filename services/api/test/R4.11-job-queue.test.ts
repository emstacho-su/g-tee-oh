/**
 * The app_job queue (R4.11, O-275, ADR 0005, PM conditions) against the Postgres test container as
 * the app role: a claimed job whose worker died is claimed again once its lease runs out and not
 * before; concurrent workers never claim one job (SKIP LOCKED); a failing job backs off by its
 * attempt count and is marked failed after JOB_MAX_ATTEMPTS; a handler's writes commit with its
 * completion and roll back with its failure; a period is scheduled once; and the worker started
 * from an app runs a due job. Every test uses its own job kinds, so test files sharing the database
 * never claim each other's jobs.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { NO_LEARNING_HOOKS } from "../src/learning/effects.js";
import type { JobHandler, JobServices } from "../src/jobs/registry.js";
import { runDueJobs, startJobWorker, type JobRunOptions } from "../src/jobs/worker.js";
import {
  JOB_LEASE_MS,
  JOB_MAX_ATTEMPTS,
  JOB_RETRY_BACKOFF_MS,
  JobLeaseLostError,
  claimJob,
  completeJob,
} from "../src/jobs/repository.js";
import { ensureScheduled } from "../src/jobs/schedule.js";
import { TEST_CONFIG } from "./support/app.js";
import { appDatabase } from "./support/database.js";

const T0 = new Date("2026-11-02T00:00:00.000Z");
const ONE_MS = 1;
const CONCURRENT_WORKERS = 8;
const WORKER_WAIT_MS = 5_000;
const WORKER_POLL_MS = 20;

let database: Database;
let services: JobServices;

beforeAll(() => {
  database = appDatabase();
  services = { solverQuery: null, learningHooks: NO_LEARNING_HOOKS, log: buildApp().log };
});

afterAll(async () => {
  await database.destroy();
});

function uniqueKind(label: string): string {
  return `test_${label}_${randomUUID()}`;
}

function at(offsetMs: number): Date {
  return new Date(T0.getTime() + offsetMs);
}

async function insertJob(kind: string, runAt: Date = T0, periodKey = "p1"): Promise<string> {
  const row = await database
    .insertInto("app_job")
    .values({ kind, period_key: periodKey, run_at: runAt })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function jobRow(id: string) {
  return database.selectFrom("app_job").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

function runOptions(workerId = "worker-a"): JobRunOptions {
  return { workerId, timeZone: TEST_CONFIG.timeZone, services };
}

describe("R4.11 app job queue", () => {
  it("R4.11 a claimed and abandoned job is claimed again after its lease and not before", async () => {
    const kind = uniqueKind("lease");
    const id = await insertJob(kind);
    const first = await claimJob(database, { now: T0, workerId: "crashed", kinds: [kind] });
    expect(first).toMatchObject({ id, attempts: 1, lockedBy: "crashed" });

    expect(await claimJob(database, { now: at(JOB_LEASE_MS - ONE_MS), workerId: "b", kinds: [kind] })).toBeUndefined();
    expect(await claimJob(database, { now: at(JOB_LEASE_MS), workerId: "b", kinds: [kind] })).toBeUndefined();

    const again = await claimJob(database, { now: at(JOB_LEASE_MS + ONE_MS), workerId: "b", kinds: [kind] });
    expect(again).toMatchObject({ id, attempts: 2, lockedBy: "b" });
    if (first === undefined) {
      throw new Error("the first claim took the job");
    }
    // The crashed worker's late completion commits nothing: its lease was taken over.
    await expect(database.transaction().execute((transaction) => completeJob(transaction, first, at(JOB_LEASE_MS)))).rejects.toThrow(
      JobLeaseLostError,
    );
    expect((await jobRow(id)).status).toBe("running");
  });

  it("R4.11 concurrent workers never claim one job, and a locked row is skipped, not waited on", async () => {
    const kind = uniqueKind("race");
    const id = await insertJob(kind);
    const claims = await Promise.all(
      Array.from({ length: CONCURRENT_WORKERS }, (_, index) => claimJob(database, { now: T0, workerId: `w${index}`, kinds: [kind] })),
    );
    expect(claims.filter((claim) => claim !== undefined).map((claim) => claim?.id)).toEqual([id]);

    const pairKind = uniqueKind("skip");
    const ids = [await insertJob(pairKind, T0, "p1"), await insertJob(pairKind, at(ONE_MS), "p2")];
    await database.transaction().execute(async (transaction) => {
      const held = await claimJob(transaction, { now: at(ONE_MS), workerId: "holder", kinds: [pairKind] });
      const other = await claimJob(database, { now: at(ONE_MS), workerId: "other", kinds: [pairKind] });
      const none = await claimJob(database, { now: at(ONE_MS), workerId: "third", kinds: [pairKind] });
      expect([held?.id, other?.id]).toEqual(ids);
      expect(none).toBeUndefined();
    });
  });

  it("R4.11 a failing job backs off by its attempts and is marked failed after the last one", async () => {
    const kind = uniqueKind("backoff");
    const id = await insertJob(kind);
    const failing: JobHandler = () => Promise.reject(new Error("upstream down"));
    let now = T0;
    for (let attempt = 1; attempt <= JOB_MAX_ATTEMPTS; attempt += 1) {
      const report = await runDueJobs(database, now, { [kind]: failing }, runOptions());
      expect(report.failed, `attempt ${attempt}`).toEqual([id]);
      const row = await jobRow(id);
      expect(row.attempts).toBe(attempt);
      expect(row.last_error).toContain("upstream down");
      if (attempt < JOB_MAX_ATTEMPTS) {
        expect(row.status).toBe("queued");
        const due = new Date(now.getTime() + JOB_RETRY_BACKOFF_MS * attempt);
        expect(row.run_at).toEqual(due);
        const early = await runDueJobs(database, new Date(due.getTime() - ONE_MS), { [kind]: failing }, runOptions());
        expect(early.failed).toEqual([]);
        now = due;
      } else {
        expect(row.status).toBe("failed");
      }
    }
    const later = await runDueJobs(database, at(JOB_LEASE_MS * JOB_MAX_ATTEMPTS * 10), { [kind]: failing }, runOptions());
    expect(later).toEqual({ done: [], failed: [] });
  });

  it("R4.11 a lease that runs out after the last attempt marks the job failed", async () => {
    const kind = uniqueKind("exhausted");
    const id = await insertJob(kind);
    await database
      .updateTable("app_job")
      .set({ status: "running", attempts: JOB_MAX_ATTEMPTS, locked_by: "crashed", locked_at: T0 })
      .where("id", "=", id)
      .execute();
    const never: JobHandler = () => Promise.reject(new Error("must not run"));
    const report = await runDueJobs(database, at(JOB_LEASE_MS + ONE_MS), { [kind]: never }, runOptions());
    expect(report).toEqual({ done: [], failed: [] });
    expect((await jobRow(id)).status).toBe("failed");
  });

  it("R4.11 a handler's writes commit with its completion and roll back with its failure", async () => {
    const kind = uniqueKind("tx");
    const marker = uniqueKind("marker");
    const writes: JobHandler = async ({ transaction, job }) => {
      await transaction.insertInto("app_job").values({ kind: marker, period_key: job.periodKey, run_at: T0 }).execute();
    };
    const doneId = await insertJob(kind, T0, "ok");
    const report = await runDueJobs(database, T0, { [kind]: writes }, runOptions());
    expect(report.done).toEqual([doneId]);
    expect((await jobRow(doneId)).status).toBe("done");

    const failingKind = uniqueKind("tx_fail");
    const failedId = await insertJob(failingKind, T0, "bad");
    const writesThenThrows: JobHandler = async (context) => {
      await writes(context);
      throw new Error("after the write");
    };
    const failed = await runDueJobs(database, T0, { [failingKind]: writesThenThrows }, runOptions());
    expect(failed.failed).toEqual([failedId]);
    const markers = await database.selectFrom("app_job").select("period_key").where("kind", "=", marker).execute();
    expect(markers.map((row) => row.period_key)).toEqual(["ok"]);
  });

  it("R4.11 a period is scheduled once however often it is ensured", async () => {
    const kind = uniqueKind("schedule");
    const schedule = { kind, nextPeriod: () => ({ periodKey: "2026-W45", runAt: T0 }) };
    await ensureScheduled(database, [schedule], T0, TEST_CONFIG.timeZone);
    await ensureScheduled(database, [schedule], at(ONE_MS), TEST_CONFIG.timeZone);
    const rows = await database.selectFrom("app_job").select(["period_key", "status"]).where("kind", "=", kind).execute();
    expect(rows).toEqual([{ period_key: "2026-W45", status: "queued" }]);
    await ensureScheduled(database, [], T0, TEST_CONFIG.timeZone);
  });

  it("R4.11 the worker an app starts schedules and runs a due job, then stops", async () => {
    const kind = uniqueKind("worker");
    const ran: string[] = [];
    const app = buildApp({ database, config: TEST_CONFIG });
    const worker = startJobWorker(app, {
      timeZone: TEST_CONFIG.timeZone,
      clock: () => T0,
      intervalMs: WORKER_POLL_MS,
      definitions: [
        {
          kind,
          nextPeriod: () => ({ periodKey: "once", runAt: T0 }),
          handler: ({ job }) => {
            ran.push(job.periodKey);
            return Promise.resolve();
          },
        },
      ],
    });
    const deadline = Date.now() + WORKER_WAIT_MS;
    while (ran.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, WORKER_POLL_MS));
    }
    await worker.stop();
    await app.close();
    expect(ran).toEqual(["once"]);
    const rows = await database.selectFrom("app_job").select("status").where("kind", "=", kind).execute();
    expect(rows).toEqual([{ status: "done" }]);
  });
});
