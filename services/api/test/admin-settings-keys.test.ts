/**
 * The builder settings keys the admin PATCH accepts (R3.5, O-88, O-188, O-241). The spelling test
 * reads the builder's own Rust source (services/library-builder/src/settings.rs) and asserts the
 * api's key list equals its KEYS array, in order, and that every ceiling the api checks equals the
 * builder's MAX_* constant, so the two sides cannot drift apart.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BUILDER_SETTING_CEILINGS,
  BUILDER_SETTING_KEYS,
  builderSettingValueSchemas,
} from "../src/admin/settings-keys.js";

const SETTINGS_RS = fileURLToPath(new URL("../../library-builder/src/settings.rs", import.meta.url));

function rustSource(): string {
  return readFileSync(SETTINGS_RS, "utf8");
}

function rustKeys(source: string): string[] {
  const match = /pub const KEYS: \[&str; (\d+)\] = \[([^\]]*)\]/.exec(source);
  if (match === null) {
    throw new Error("KEYS not found in settings.rs");
  }
  const keys = [...(match[2] ?? "").matchAll(/"([a-z_0-9]+)"/g)].map((found) => found[1] ?? "");
  expect(keys).toHaveLength(Number(match[1]));
  return keys;
}

function rustConstant(source: string, name: string): number {
  const match = new RegExp(`pub const ${name}: [a-z0-9]+ = ([0-9_.]+);`).exec(source);
  if (match === null) {
    throw new Error(`${name} not found in settings.rs`);
  }
  return Number((match[1] ?? "").replaceAll("_", ""));
}

describe("R3.5 builder settings keys match the builder", () => {
  it("R3.5 the api's key list equals KEYS in settings.rs, in order", () => {
    expect([...BUILDER_SETTING_KEYS]).toEqual(rustKeys(rustSource()));
    expect(Object.keys(builderSettingValueSchemas)).toEqual([...BUILDER_SETTING_KEYS]);
  });

  it("R3.5 every ceiling the api checks equals the builder's MAX_* constant", () => {
    const source = rustSource();
    for (const [name, value] of Object.entries(BUILDER_SETTING_CEILINGS)) {
      expect(value, name).toBe(rustConstant(source, name));
    }
  });
});

describe("R3.5 builder settings value types", () => {
  const accepts = (key: keyof typeof builderSettingValueSchemas, value: unknown) =>
    builderSettingValueSchemas[key].safeParse(value).success;

  it("R3.5 accepts each key's documented default", () => {
    const defaults: Record<string, unknown> = {
      paused: false,
      cpu_share: 0.5,
      overnight: { start_hour: 0, end_hour: 7, utc_offset_minutes: 0, cpu_share: 1 },
      budget_bytes: 650_000_000_000,
      bytes_per_runout: 14_156_873,
      bytes_per_flop_tree: 752_365,
      k_runouts: 20,
      k_runouts_rare: 10,
      k_frequent_pairs: 1,
      plan_configs: ["cfg_6_online_100"],
      target_pct_pot: 0.3,
      max_iterations: 20_000,
      max_seconds_per_line: 1800,
      storage_bits: 32,
      memory_cap_bytes: 4_294_967_296,
      max_attempts: 3,
      stale_hours: 6,
      verify_interval_hours: 24,
      plan_interval_minutes: 60,
      poll_seconds: 30,
    };
    expect(Object.keys(defaults)).toEqual([...BUILDER_SETTING_KEYS]);
    for (const key of BUILDER_SETTING_KEYS) {
      expect(accepts(key, defaults[key]), key).toBe(true);
    }
  });

  it("R3.5 rejects wrong JSON types and values outside the builder's bounds", () => {
    const rejected: [keyof typeof builderSettingValueSchemas, unknown][] = [
      ["paused", "yes"],
      ["cpu_share", 0],
      ["cpu_share", 1.5],
      ["overnight", { start_hour: 1, end_hour: 24, utc_offset_minutes: 0, cpu_share: 1 }],
      ["overnight", { start_hour: 1, end_hour: 2, utc_offset_minutes: 1440, cpu_share: 1 }],
      ["overnight", { start_hour: 1, end_hour: 2 }],
      ["overnight", { start_hour: 1, end_hour: 2, utc_offset_minutes: 0, cpu_share: 1, extra: 1 }],
      ["plan_configs", "cfg_6_online_100"],
      ["plan_configs", [1]],
      ["target_pct_pot", 0],
      ["max_iterations", 5_000_000_000],
      ["max_iterations", 1.5],
      ["k_runouts", 70_000],
      ["max_attempts", 0],
      ["storage_bits", 8],
      ["budget_bytes", -1],
    ];
    for (const [key, value] of rejected) {
      expect(accepts(key, value), `${key} ${JSON.stringify(value)}`).toBe(false);
    }
  });
});
