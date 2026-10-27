/**
 * Server-Timing entries (R3.3, O-248, O-40). just perf drives the api through Caddy on the dev
 * stack, where solver-query publishes no port, so the api reports how long its own solver-query
 * grade call took as `Server-Timing: sq-grade;dur=<ms>` on the decision response, and the perf
 * script reads the grade p95 from there. Only durations leave the process: no names of hosts,
 * queries or ids.
 */
import type { FastifyReply } from "fastify";

export const SERVER_TIMING_HEADER = "server-timing";
/** The metric name of the solver-query grade call on POST /sessions/{id}/decisions. */
export const SQ_GRADE_METRIC = "sq-grade";

const METRIC_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const DURATION_DECIMALS = 2;

/** Appends one `name;dur=ms` entry to the response's Server-Timing header. */
export function addServerTiming(reply: FastifyReply, name: string, durationMs: number): void {
  if (!METRIC_NAME.test(name) || !Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error(`invalid Server-Timing entry ${JSON.stringify(name)} ${durationMs}`);
  }
  const entry = `${name};dur=${durationMs.toFixed(DURATION_DECIMALS)}`;
  const existing = reply.getHeader(SERVER_TIMING_HEADER);
  const value = typeof existing === "string" && existing !== "" ? `${existing}, ${entry}` : entry;
  reply.header(SERVER_TIMING_HEADER, value);
}

/** Runs `work`, then records its wall time under `name`, whether it resolved or threw. */
export async function timed<T>(reply: FastifyReply, name: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await work();
  } finally {
    addServerTiming(reply, name, performance.now() - started);
  }
}
