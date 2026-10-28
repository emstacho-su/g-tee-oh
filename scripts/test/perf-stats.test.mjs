// R3.3, O-40, O-248: the pure parts of just perf (scripts/perf.mjs): the nearest-rank percentile,
// the Server-Timing parser and the argument parser. node:test, run by `pnpm run test:scripts`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePerfArgs, DEFAULT_BASE_URL } from "../perf/args.mjs";
import { PerfError } from "../perf/errors.mjs";
import { nearestRankPercentile, P95_FRACTION, summarize } from "../perf/stats.mjs";
import { parseServerTiming, serverTimingDuration } from "../perf/server-timing.mjs";

const ONE_TO_TWENTY = Array.from({ length: 20 }, (_, index) => index + 1);
const ONE_TO_TWO_HUNDRED = Array.from({ length: 200 }, (_, index) => index + 1);

test("R3.3 nearestRankPercentile takes the value at rank ceil(p n) of the ascending sort", () => {
  assert.equal(nearestRankPercentile(ONE_TO_TWENTY, P95_FRACTION), 19);
  assert.equal(nearestRankPercentile(ONE_TO_TWO_HUNDRED, P95_FRACTION), 190);
  assert.equal(nearestRankPercentile([5, 1, 4, 2, 3], 0.5), 3);
  assert.equal(nearestRankPercentile([7], P95_FRACTION), 7);
  assert.equal(nearestRankPercentile([3, 1, 2], 1), 3);
});

test("R3.3 nearestRankPercentile leaves its input unsorted (no mutation)", () => {
  const values = [3, 1, 2];
  nearestRankPercentile(values, P95_FRACTION);
  assert.deepEqual(values, [3, 1, 2]);
});

test("R3.3 nearestRankPercentile refuses an empty sample, a non-number and a bad fraction", () => {
  assert.throws(() => nearestRankPercentile([], P95_FRACTION), PerfError);
  assert.throws(() => nearestRankPercentile([1, Number.NaN], P95_FRACTION), PerfError);
  assert.throws(() => nearestRankPercentile([1, "2"], P95_FRACTION), PerfError);
  assert.throws(() => nearestRankPercentile([1, 2], 0), PerfError);
  assert.throws(() => nearestRankPercentile([1, 2], 1.5), PerfError);
});

test("R3.3 summarize gives the median, the p95, the maximum and the count", () => {
  assert.deepEqual(summarize(ONE_TO_TWENTY), { p50: 10, p95: 19, max: 20, samples: 20 });
});

test("R3.3 parseServerTiming reads sq-grade;dur=12.34 and every entry of a list", () => {
  assert.deepEqual(parseServerTiming("sq-grade;dur=12.34"), [{ name: "sq-grade", dur: 12.34 }]);
  assert.deepEqual(parseServerTiming('db;dur=3, sq-grade;desc="grade";dur=0.5, cache'), [
    { name: "db", dur: 3 },
    { name: "sq-grade", dur: 0.5 },
    { name: "cache", dur: null },
  ]);
});

test("R3.3 serverTimingDuration returns the named metric's duration", () => {
  assert.equal(serverTimingDuration("sq-grade;dur=12.34", "sq-grade"), 12.34);
  assert.equal(serverTimingDuration(["other;dur=1", "sq-grade;dur=7"], "sq-grade"), 7);
});

test("R3.3 serverTimingDuration fails on a missing header, a missing metric or a bad duration", () => {
  assert.throws(() => serverTimingDuration(undefined, "sq-grade"), /no Server-Timing header/);
  assert.throws(() => serverTimingDuration("db;dur=1", "sq-grade"), /no sq-grade entry/);
  assert.throws(() => serverTimingDuration("sq-grade", "sq-grade"), /no duration/);
  assert.throws(() => serverTimingDuration("sq-grade;dur=abc", "sq-grade"), /no duration/);
  assert.throws(() => serverTimingDuration("sq-grade;dur=-1", "sq-grade"), /no duration/);
});

test("R3.3 parsePerfArgs: defaults, then each flag", () => {
  const defaults = parsePerfArgs([], {});
  assert.equal(defaults.baseUrl, DEFAULT_BASE_URL);
  assert.equal(defaults.machine, "zenbook");
  assert.equal(defaults.caFile, null);
  assert.match(defaults.outDir, /validation[\\/]reports$/);

  const given = parsePerfArgs(
    ["--base-url", "https://trainer.lan", "--ca-file", "root.crt", "--out-dir", "target/perf"],
    { BENCH_MACHINE: "mac-mini" },
  );
  assert.equal(given.baseUrl, "https://trainer.lan");
  assert.equal(given.machine, "mac-mini");
  assert.match(given.caFile, /root\.crt$/);
  assert.match(given.outDir, /target[\\/]perf$/);
});

test("R3.3 parsePerfArgs refuses an unknown flag, a missing value, a non-https URL and a bad machine name", () => {
  assert.throws(() => parsePerfArgs(["--samples", "5"], {}), /unknown argument --samples/);
  assert.throws(() => parsePerfArgs(["--base-url"], {}), /--base-url needs a value/);
  assert.throws(() => parsePerfArgs(["--base-url", "--ca-file"], {}), /--base-url needs a value/);
  assert.throws(() => parsePerfArgs(["--base-url", "http://localhost"], {}), /https/);
  assert.throws(() => parsePerfArgs(["--base-url", "https://localhost/api"], {}), /origin/);
  assert.throws(() => parsePerfArgs(["--base-url", "not a url"], {}), /not a URL/);
  assert.throws(() => parsePerfArgs([], { BENCH_MACHINE: "Zen Book" }), /BENCH_MACHINE/);
  assert.throws(() => parsePerfArgs(["--base-url", "https://a", "--base-url", "https://b"], {}), /more than once/);
});
