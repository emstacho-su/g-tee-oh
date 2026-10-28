/**
 * The payloads the builder sends on each LISTEN channel (R3.4, A4 section 4, O-243), as Zod
 * schemas. The shapes mirror the builder's notify module: coverage_added {config_id, pair, flop,
 * build_id, scenario_count}, builder_state {state, reason}, build_progress {job_id, line,
 * iteration, exploitability}, where exploitability is both seats' gains in percent of the pot or
 * null before the first measurement. A payload that fails its schema is dropped by the hub with a
 * warn log; nothing unvalidated reaches a client.
 */
import { z } from "zod";

import type { NotifyChannel } from "./source.js";

/** The states the builder reports (running, throttled, paused, idle). */
export const BUILDER_REPORTED_STATES = ["running", "throttled", "paused", "idle"] as const;

export const coverageAddedPayloadSchema = z.object({
  config_id: z.string().min(1),
  pair: z.string().min(1),
  flop: z.string().min(1),
  build_id: z.string().min(1),
  scenario_count: z.int().nonnegative(),
});

export const builderStatePayloadSchema = z.object({
  state: z.enum(BUILDER_REPORTED_STATES),
  reason: z.string(),
});

export const buildProgressPayloadSchema = z.object({
  job_id: z.string().min(1),
  line: z.string(),
  iteration: z.int().nonnegative(),
  exploitability: z.tuple([z.number(), z.number()]).nullable(),
});

export type CoverageAddedPayload = z.infer<typeof coverageAddedPayloadSchema>;
export type BuilderStatePayload = z.infer<typeof builderStatePayloadSchema>;
export type BuildProgressPayload = z.infer<typeof buildProgressPayloadSchema>;

export const PAYLOAD_SCHEMAS = {
  coverage_added: coverageAddedPayloadSchema,
  builder_state: builderStatePayloadSchema,
  build_progress: buildProgressPayloadSchema,
} as const satisfies Record<NotifyChannel, z.ZodType>;

/** Channels only admins receive (O-243): build progress is for the admin screen. */
export const ADMIN_ONLY_CHANNELS: ReadonlySet<NotifyChannel> = new Set(["build_progress"]);

export type ParsedEvent =
  | { channel: "coverage_added"; data: CoverageAddedPayload }
  | { channel: "builder_state"; data: BuilderStatePayload }
  | { channel: "build_progress"; data: BuildProgressPayload };

export type ParseOutcome = { ok: true; event: ParsedEvent } | { ok: false; reason: string };

function isNotifyChannel(channel: string): channel is NotifyChannel {
  return Object.hasOwn(PAYLOAD_SCHEMAS, channel);
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Validates one notification; the reason names what was wrong, never echoing the payload. */
export function parseNotification(channel: string, payload: string): ParseOutcome {
  if (!isNotifyChannel(channel)) {
    return { ok: false, reason: "unknown channel" };
  }
  const json = parseJson(payload);
  if (!json.ok) {
    return { ok: false, reason: "payload is not JSON" };
  }
  const parsed = PAYLOAD_SCHEMAS[channel].safeParse(json.value);
  if (!parsed.success) {
    return { ok: false, reason: `payload does not match the ${channel} schema` };
  }
  return { ok: true, event: { channel, data: parsed.data } as ParsedEvent };
}
