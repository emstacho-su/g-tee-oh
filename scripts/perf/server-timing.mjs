// The Server-Timing reader of just perf (R3.3, O-248). The api reports its own solver-query grade
// call on every decision response as `Server-Timing: sq-grade;dur=<ms>`
// (services/api/src/http/server-timing.ts), because solver-query publishes no port on the dev
// stack. A header is a comma-separated list of entries `name;param=value;...`; only dur is read.
// Node joins repeated headers with ", ", and an array is accepted too, so both forms parse alike.

import { PerfError } from "./errors.mjs";

const ENTRY_SEPARATOR = ",";
const PARAM_SEPARATOR = ";";
const VALUE_SEPARATOR = "=";
const DURATION_PARAM = "dur";
const DURATION_NUMBER = /^[0-9]+(\.[0-9]+)?$/;

function parseEntry(text) {
  const [rawName, ...params] = text.split(PARAM_SEPARATOR);
  const durParam = params
    .map((param) => param.trim())
    .find((param) => param.split(VALUE_SEPARATOR)[0].trim() === DURATION_PARAM);
  const durText = durParam === undefined ? "" : durParam.slice(durParam.indexOf(VALUE_SEPARATOR) + 1).trim();
  return { name: rawName.trim(), dur: DURATION_NUMBER.test(durText) ? Number(durText) : null };
}

/** Every entry of a Server-Timing header as { name, dur }, dur null when absent or not a number. */
export function parseServerTiming(header) {
  const text = Array.isArray(header) ? header.join(ENTRY_SEPARATOR) : String(header ?? "");
  return text
    .split(ENTRY_SEPARATOR)
    .filter((entry) => entry.trim() !== "")
    .map(parseEntry);
}

/** The duration in milliseconds of `metric`; throws when the header, the entry or its dur is missing. */
export function serverTimingDuration(header, metric) {
  if (header === undefined || header === null || header === "") {
    throw new PerfError(`the response carries no Server-Timing header (expected ${metric};dur=<ms>, O-248)`);
  }
  const entry = parseServerTiming(header).find((candidate) => candidate.name === metric);
  if (entry === undefined) {
    throw new PerfError(`the Server-Timing header has no ${metric} entry: ${JSON.stringify(header)}`);
  }
  if (entry.dur === null) {
    throw new PerfError(`the ${metric} Server-Timing entry has no duration: ${JSON.stringify(header)}`);
  }
  return entry.dur;
}
