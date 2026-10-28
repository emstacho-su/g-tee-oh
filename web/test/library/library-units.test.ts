/**
 * Unit tests for the library modules (S28, R3.4, R3.5): the search validator, texture family
 * grouping, event parsing, request texts and display formatting. The two drift tests read the
 * Rust sources the web copies naming data and defaults from (O-291, O-292).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ApiProblem } from "../../src/api/index.js";
import { adminFailureText } from "../../src/library/admin-text.js";
import {
  BUILDER_DEFAULTS,
  BYTES_PER_GB,
  LIBRARY_SETTING_FIELDS,
  isPausedSetting,
  numericSetting,
  overnightSetting,
  parseOvernight,
} from "../../src/library/builder-settings.js";
import { parseBuilderState, parseBuildProgress, parseCoverageAdded } from "../../src/library/events.js";
import { flopsPerDay, formatBytes, formatHour, formatPercent } from "../../src/library/format.js";
import { openBrowserEvents } from "../../src/library/library-deps.js";
import { EVENT_SOURCE_CLOSED } from "../../src/library/use-server-events.js";
import { normalizeFlop, requestFailureText, requestResultText } from "../../src/library/request-text.js";
import { validateLibrarySearch, withLibraryFilter, withPair } from "../../src/library/search.js";
import { TEXTURE_FAMILIES, familyLabel, familyRows } from "../../src/library/texture-families.js";

// vitest runs with the web package as its working directory (pnpm --filter, just ts-test).
const REPO_ROOT = join(process.cwd(), "..");

function repoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

function problem(status: number): ApiProblem {
  return new ApiProblem({ status, slug: "any", title: "t" });
}

describe("R3.4 library search", () => {
  it("R3.4 keeps only the library keys, each validated as the study browser does", () => {
    expect(
      validateLibrarySearch({ format: "online", table_size: "6", stake: "s1", depth: "10000", pair: "BB-BTN", line: "r250", hand: "AKs" }),
    ).toEqual({ format: "online", table_size: 6, stake: "s1", depth: 10000, pair: "BB-BTN" });
    expect(validateLibrarySearch({ format: "nope", pair: "BTN" })).toEqual({});
  });

  it("R3.4 a filter change clears the filters below it, and withPair drops an invalid pair", () => {
    const search = { format: "online" as const, table_size: 6, stake: "s1", depth: 10000, pair: "BB-BTN" };
    expect(withLibraryFilter(search, "table_size", "9")).toEqual({ format: "online", table_size: 9 });
    expect(withPair(search, "SB-BTN").pair).toBe("SB-BTN");
    expect(withPair(search, "nonsense").pair).toBeUndefined();
  });
});

describe("R3.4 texture families (O-291, ADR 0004)", () => {
  it("R3.4 the family names equal gto_model TextureFamily::as_str, in its precedence order", () => {
    const source = repoFile("crates/gto-model/src/iso.rs");
    const body = /pub const fn as_str\(self\) -> &'static str \{([\s\S]*?)\n {4}\}/.exec(source)?.[1] ?? "";
    const names = [...body.matchAll(/TextureFamily::\w+ => "([a-z-]+)"/g)].map((match) => match[1]);
    expect(names).toEqual([...TEXTURE_FAMILIES]);
  });

  it("R3.4 groups covered flops per family, counts distinct flops, and lists an unknown family after the named ones", () => {
    const rows = familyRows([
      { flop: "Ah7d2c", texture_family: "dry-ace-high", scenarios: 20 },
      { flop: "Ah7d2c", texture_family: "dry-ace-high", scenarios: 5 },
      { flop: "8s8d3c", texture_family: "paired", scenarios: 10 },
      { flop: "Xx", texture_family: "unknown", scenarios: 1 },
    ]);
    expect(rows.map((row) => [row.family, row.flops, row.scenarios])).toEqual([
      ["paired", 1, 10],
      ["monotone", 0, 0],
      ["two-tone-broadway", 0, 0],
      ["dry-ace-high", 1, 25],
      ["low-connected", 0, 0],
      ["other", 0, 0],
      ["unknown", 1, 1],
    ]);
    expect(familyLabel("unknown")).toBe("unknown");
  });
});

describe("R3.5 builder settings (O-292, O-296)", () => {
  it("R3.5 the defaults equal the builder's settings table", () => {
    const source = repoFile("services/library-builder/src/settings.rs");
    const table = new Map(
      [...source.matchAll(/^\/\/! \| `([a-z_]+)` \| (.+?) \| .* \|$/gm)].map((match) => [match[1], match[2]?.replace(/`/g, "")]),
    );
    for (const [key, value] of Object.entries(BUILDER_DEFAULTS)) {
      expect(table.has(key), key).toBe(true);
      expect(JSON.parse(table.get(key) ?? "null"), key).toEqual(value);
    }
  });

  it("R3.5 a field parses only values inside its bounds; the budget is edited in GB", () => {
    const field = (key: string) => {
      const found = LIBRARY_SETTING_FIELDS.find((candidate) => candidate.key === key);
      if (found === undefined) throw new Error(key);
      return found;
    };
    expect(field("cpu_share").parse("1")).toEqual({ value: 1 });
    expect(field("cpu_share").parse("0")).toHaveProperty("error");
    expect(field("cpu_share").parse("")).toHaveProperty("error");
    expect(field("budget_bytes").parse("500")).toEqual({ value: 500 * BYTES_PER_GB });
    expect(field("budget_bytes").parse("1.5")).toHaveProperty("error");
    expect(field("budget_bytes").toInput(650 * BYTES_PER_GB)).toBe("650");
    expect(field("k_runouts").parse("2352")).toEqual({ value: 2352 });
    expect(field("k_runouts").parse("2353")).toHaveProperty("error");
    expect(field("max_seconds_per_line").parse("abc")).toHaveProperty("error");
  });

  it("R3.5 the value in force is the stored override, else the builder default", () => {
    expect(numericSetting({ cpu_share: 0.6 }, "cpu_share")).toEqual({ value: 0.6, stored: true });
    expect(numericSetting({ cpu_share: "x" }, "cpu_share")).toEqual({ value: 0.5, stored: false });
    expect(overnightSetting({}).stored).toBe(false);
    const window = { start_hour: 1, end_hour: 5, utc_offset_minutes: 60, cpu_share: 0.9 };
    expect(overnightSetting({ overnight: window })).toEqual({ value: window, stored: true });
    expect(overnightSetting({ overnight: { start_hour: 1 } }).stored).toBe(false);
    expect(isPausedSetting({ paused: true })).toBe(true);
    expect(isPausedSetting({})).toBe(false);
  });

  it("R3.5 the overnight window parses each part within its bounds", () => {
    const texts = { start_hour: "22", end_hour: "6", utc_offset_minutes: "-300", cpu_share: "0.8" };
    expect(parseOvernight(texts)).toEqual({ value: { start_hour: 22, end_hour: 6, utc_offset_minutes: -300, cpu_share: 0.8 } });
    expect(parseOvernight({ ...texts, utc_offset_minutes: "1440" })).toMatchObject({ key: "utc_offset_minutes" });
    expect(parseOvernight({ ...texts, start_hour: "6.5" })).toMatchObject({ key: "start_hour" });
  });
});

describe("R3.4 R3.5 server-sent event payloads (O-243)", () => {
  it("R3.4 coverage_added needs every field with its shape", () => {
    const valid = { config_id: "c", pair: "BB-BTN", flop: "Kd8s3h", build_id: "b", scenario_count: 3 };
    expect(parseCoverageAdded(JSON.stringify(valid))).toEqual(valid);
    expect(parseCoverageAdded(JSON.stringify({ ...valid, scenario_count: -1 }))).toBeNull();
    expect(parseCoverageAdded(JSON.stringify({ ...valid, flop: "" }))).toBeNull();
    expect(parseCoverageAdded("[1]")).toBeNull();
    expect(parseCoverageAdded("{bad")).toBeNull();
  });

  it("R3.5 builder_state and build_progress keep only known shapes", () => {
    expect(parseBuilderState('{"state":"idle","reason":""}')).toEqual({ state: "idle", reason: "" });
    expect(parseBuilderState('{"state":"unknown","reason":""}')).toBeNull();
    expect(parseBuilderState('{"state":"idle"}')).toBeNull();
    expect(parseBuildProgress('{"job_id":"j","line":"","iteration":0,"exploitability":null}')).toEqual({
      job_id: "j",
      line: "",
      iteration: 0,
      exploitability: null,
    });
    expect(parseBuildProgress('{"job_id":"j","line":"","iteration":0,"exploitability":[1]}')).toBeNull();
    expect(parseBuildProgress('{"job_id":"j","line":"","iteration":1.5,"exploitability":null}')).toBeNull();
    expect(parseBuildProgress("null")).toBeNull();
  });
});

describe("R3.4 the browser event stream (O-297)", () => {
  it("R3.4 opens the browser's EventSource on the path, and a closed inert stream where there is none", () => {
    const original = globalThis.EventSource;
    try {
      Reflect.deleteProperty(globalThis, "EventSource");
      const inert = openBrowserEvents("/api/v1/events");
      expect(inert.readyState).toBe(EVENT_SOURCE_CLOSED);
      inert.addEventListener("open", () => undefined);
      inert.close();

      const opened: string[] = [];
      class StubEventSource {
        readyState = 0;
        constructor(url: string) {
          opened.push(url);
        }
      }
      Object.assign(globalThis, { EventSource: StubEventSource });
      expect(openBrowserEvents("/api/v1/events")).toBeInstanceOf(StubEventSource);
      expect(opened).toEqual(["/api/v1/events"]);
    } finally {
      Object.assign(globalThis, { EventSource: original });
    }
  });
});

describe("R3.4 R3.5 texts", () => {
  it("R3.4 each request status reads in plain words; failures are fixed messages", () => {
    expect(requestResultText({ status: "queued", job_id: "j", priority: 2, queue_position: 4 })).toBe("Queued for the builder at position 4.");
    expect(requestResultText({ status: "queued", job_id: "j", priority: 2, queue_position: null })).toBe("Queued for the builder.");
    expect(requestFailureText(problem(400))).toContain("Check the flop");
    expect(requestFailureText(problem(404))).toBe("The catalog holds no such configuration.");
    expect(requestFailureText(problem(429))).toContain("Too many requests");
    expect(requestFailureText(new TypeError("x"))).toBe("The request could not be sent. Try again.");
  });

  it("R3.4 a typed flop is normalized, and anything else is refused", () => {
    expect(normalizeFlop(" kh qD 4S ")).toBe("KhQd4s");
    expect(normalizeFlop("KhQd")).toBeNull();
    expect(normalizeFlop("KhKh4s")).toBeNull();
    expect(normalizeFlop("1h2d3c")).toBeNull();
  });

  it("R3.5 admin failures are fixed messages by status", () => {
    expect(adminFailureText(problem(403))).toBe("Only an admin can change the builder.");
    expect(adminFailureText(problem(400))).toContain("refused these values");
    expect(adminFailureText(problem(429))).toContain("Too many requests");
    expect(adminFailureText(new Error("x"))).toBe("The change could not be saved. Try again.");
  });

  it("R3.5 bytes, shares, hours and flops per day format for the health panel (O-299)", () => {
    expect(formatBytes(650_000_000_000)).toBe("650.0 GB");
    expect(formatBytes(1_500_000_000_000)).toBe("1.5 TB");
    expect(formatBytes(2_500_000)).toBe("2.5 MB");
    expect(formatBytes(1_500)).toBe("1.5 kB");
    expect(formatBytes(12)).toBe("12 B");
    expect(formatPercent(0.2308)).toBe("23.1%");
    expect(formatHour(7)).toBe("07:00");
    expect(flopsPerDay(0.5)).toBe(12);
  });
});
