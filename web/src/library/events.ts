/**
 * The server-sent events (SSE) the library screen reads from GET /api/v1/events (S28, R3.4, R3.5,
 * A4 section 4, O-243, O-297): coverage_added and builder_state to every signed-in user,
 * build_progress to admins only.
 *
 * Mechanism: each event's data line is untrusted JSON. A parser returns the typed payload only
 * when every field has the shape the api's payload schemas guarantee, and null otherwise (bad
 * JSON included), so a malformed event is ignored and never reaches the screen.
 */
export const EVENTS_PATH = "/api/v1/events";

export const EVENT_NAMES = {
  coverageAdded: "coverage_added",
  builderState: "builder_state",
  buildProgress: "build_progress",
} as const;

export const BUILDER_REPORTED_STATES = ["running", "throttled", "paused", "idle"] as const;
export type BuilderReportedState = (typeof BUILDER_REPORTED_STATES)[number];

export interface CoverageAddedEvent {
  readonly config_id: string;
  readonly pair: string;
  readonly flop: string;
  readonly build_id: string;
  readonly scenario_count: number;
}

export interface BuilderStateEvent {
  readonly state: BuilderReportedState;
  readonly reason: string;
}

export interface BuildProgressEvent {
  readonly job_id: string;
  readonly line: string;
  readonly iteration: number;
  /** Both seats' gains in percent of the pot, or null before the first measurement. */
  readonly exploitability: readonly [number, number] | null;
}

type Fields = Record<string, unknown>;

function objectOf(data: string): Fields | null {
  try {
    const value: unknown = JSON.parse(data);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : null;
  } catch {
    // Malformed event data is dropped by design: the caller treats null as "ignore this event".
    return null;
  }
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function parseCoverageAdded(data: string): CoverageAddedEvent | null {
  const fields = objectOf(data);
  if (fields === null) return null;
  const { config_id: configId, pair, flop, build_id: buildId, scenario_count: scenarios } = fields;
  if (!isText(configId) || !isText(pair) || !isText(flop) || !isText(buildId) || !isCount(scenarios)) return null;
  return { config_id: configId, pair, flop, build_id: buildId, scenario_count: scenarios };
}

export function parseBuilderState(data: string): BuilderStateEvent | null {
  const fields = objectOf(data);
  if (fields === null) return null;
  const state = BUILDER_REPORTED_STATES.find((candidate) => candidate === fields["state"]);
  const reason = fields["reason"];
  if (state === undefined || typeof reason !== "string") return null;
  return { state, reason };
}

function isGainPair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((gain) => typeof gain === "number" && Number.isFinite(gain));
}

export function parseBuildProgress(data: string): BuildProgressEvent | null {
  const fields = objectOf(data);
  if (fields === null) return null;
  const { job_id: jobId, line, iteration, exploitability } = fields;
  if (!isText(jobId) || typeof line !== "string" || !isCount(iteration)) return null;
  if (exploitability !== null && !isGainPair(exploitability)) return null;
  return { job_id: jobId, line, iteration, exploitability };
}
