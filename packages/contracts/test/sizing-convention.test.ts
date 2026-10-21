// Sizing convention schema tests (R2.9, R1.6, O-75, O-76, O-136). The schema is the JSON
// (JavaScript Object Notation) shape of a sizing_convention.spec row, which gto-tree reads
// into a betting tree. Mechanism: the schema must compile under Ajv2020 strict mode; every
// file under examples/sizing-convention/valid must validate and every file under invalid must
// fail for the reason listed in INVALID_REASONS; and the eleven placeholder specs the catalog
// seed migration writes (R0.6) are rebuilt from its SQL (Structured Query Language) text and
// must validate, so the public R1.6 test runs against the real seed. gto-tree reads the same
// example files (r2_9_shared_examples_agree_with_schema), so both readers agree on them.
// The named import, not the default one: under NodeNext resolution the default import of this
// CommonJS module types as the module namespace, while Node exposes the class under both names.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import sizingConventionSchema from "../schemas/sizing-convention.schema.json" with { type: "json" };

const EXAMPLES_DIR = new URL("../schemas/examples/sizing-convention/", import.meta.url);
const SEED_SQL = new URL("../../../db/migrations/20261020001100_seed_catalog.sql", import.meta.url);

/** How many game_config rows the R0.6 seed writes, one placeholder spec each. */
const SEED_CONFIG_COUNT = 11;

/**
 * Why each invalid example must fail: the instance path and a fragment of the ajv message.
 * Every invalid file needs an entry, so an example cannot pass by failing for another reason.
 */
const INVALID_REASONS: Readonly<Record<string, string>> = {
  "bet-allin-not-boolean.json": "/postflop/bet_allin must be boolean",
  "flop-not-array.json": "/postflop/flop must be array",
  "iso-rule-missing-per-limper.json": "/iso_rule must have required property 'per_limper_bb'",
  "limp-position-lowercase.json": "/limp_positions/0 must match pattern",
  "limp-position-not-a-seat.json": "/limp_positions/0 must match pattern",
  "missing-open-bb.json": " must have required property 'open_bb'",
  "open-bb-as-string.json": "/open_bb must be number",
  "raise-cap-over-u8.json": "/postflop/raise_cap must be <= 255",
  "raise-missing-river.json": "/postflop/raise must have required property 'river'",
  "unknown-postflop-field.json": "/postflop must NOT have additional properties",
  "unknown-top-level-field.json": " must NOT have additional properties",
};

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validate = ajv.compile(sizingConventionSchema);

/** The ajv error messages for one input, empty when it validates. */
function errorsOf(check: ValidateFunction, data: unknown): readonly string[] {
  if (check(data)) return [];
  return (check.errors ?? []).map((error) => `${error.instancePath} ${error.message ?? ""}`);
}

/** The JSON file names in one example folder, sorted. */
function exampleNames(folder: "valid" | "invalid"): readonly string[] {
  const dir = new URL(`${folder}/`, EXAMPLES_DIR);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

/** One example file parsed as JSON. */
function readExample(folder: "valid" | "invalid", name: string): unknown {
  const path = fileURLToPath(new URL(`${folder}/${name}`, EXAMPLES_DIR));
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

interface SeedBase {
  readonly format: string;
  readonly spec: Readonly<Record<string, unknown>>;
}

/** A numeric SQL literal as a number, failing loudly on anything else. */
function sqlNumber(text: string | undefined): number {
  const value = Number(text);
  if (text === undefined || !Number.isFinite(value)) {
    throw new Error(`the seed holds a non-numeric literal: ${String(text)}`);
  }
  return value;
}

/** A jsonb SQL literal parsed as JSON, failing loudly when the capture is missing. */
function sqlJson(text: string | undefined): unknown {
  if (text === undefined) throw new Error("the seed row is missing a jsonb literal");
  return JSON.parse(text) as unknown;
}

// One row of the seed's base CTE (Common Table Expression): format, open_bb, iso_rule,
// threebet_ip, threebet_oop, fourbet, postflop, in that column order.
const BASE_ROW = new RegExp(
  String.raw`\('(online|live)'::game_format, ([0-9.]+), '([^']+)'::jsonb, ` +
    String.raw`([0-9.]+), ([0-9.]+), ([0-9.]+),\s*'([^']+)'::jsonb\)`,
  "g",
);
const CONFIG_ROW = /\('(cfg_[0-9]_(?:online|live)[0-9_]*)', '(online|live)'::game_format/g;

/** The per-format base specs of the seed, without placeholder_for. */
function seedBases(sql: string): readonly SeedBase[] {
  return [...sql.matchAll(BASE_ROW)].map((row) => ({
    format: row[1] ?? "",
    spec: {
      open_bb: sqlNumber(row[2]),
      iso_rule: sqlJson(row[3]),
      threebet_ip: sqlNumber(row[4]),
      threebet_oop: sqlNumber(row[5]),
      fourbet: sqlNumber(row[6]),
      straddle_bb: null,
      postflop: sqlJson(row[7]),
    },
  }));
}

/** Every seeded placeholder spec keyed by its config id, the way the seed's spec CTE builds it. */
function seedSpecs(): ReadonlyMap<string, Readonly<Record<string, unknown>>> {
  const sql = readFileSync(fileURLToPath(SEED_SQL), "utf8");
  const bases = seedBases(sql);
  const entries = [...sql.matchAll(CONFIG_ROW)].map((row) => {
    const id = row[1] ?? "";
    const base = bases.find((candidate) => candidate.format === row[2]);
    if (base === undefined) throw new Error(`the seed has no base spec for ${id}`);
    return [id, { placeholder_for: id, ...base.spec }] as const;
  });
  return new Map(entries);
}

describe("R2.9 sizing convention schema", () => {
  it("R2.9 the schema compiles under Ajv2020 strict mode", () => {
    const strictAjv = new Ajv2020({ strict: true, allErrors: true });
    expect(() => strictAjv.compile(sizingConventionSchema)).not.toThrow();
  });

  it("R2.9 every valid example validates", () => {
    const names = exampleNames("valid");
    expect(names.length).toBeGreaterThanOrEqual(4);
    for (const name of names) {
      expect(errorsOf(validate, readExample("valid", name)), name).toEqual([]);
    }
  });

  it("R2.9 every invalid example is rejected for its listed reason", () => {
    const names = exampleNames("invalid");
    expect(names).toEqual(Object.keys(INVALID_REASONS).sort());
    for (const name of names) {
      const errors = errorsOf(validate, readExample("invalid", name));
      expect(errors, name).toContainEqual(expect.stringContaining(INVALID_REASONS[name] ?? name));
    }
  });

  it("R2.9 null straddle_bb is accepted and a zero straddle_bb rejected", () => {
    const spec = readExample("valid", "seed-online.json") as Record<string, unknown>;
    expect(errorsOf(validate, { ...spec, straddle_bb: null })).toEqual([]);
    expect(errorsOf(validate, { ...spec, straddle_bb: 0 })).toContainEqual(
      expect.stringContaining("/straddle_bb"),
    );
  });

  it("R2.9 sizes and multipliers must be positive and the threshold a percent", () => {
    const spec = readExample("valid", "live-straddle-tuned.json") as Record<string, unknown>;
    const postflop = spec.postflop as Record<string, unknown>;
    const cases: readonly [Record<string, unknown>, string][] = [
      [{ ...spec, open_bb: 0 }, "/open_bb"],
      [{ ...spec, fourbet: 1 }, "/fourbet"],
      [{ ...spec, postflop: { ...postflop, flop: [0.33, -0.5] } }, "/postflop/flop/1"],
      [{ ...spec, postflop: { ...postflop, allin_threshold_pct: 0 } }, "allin_threshold_pct"],
      [{ ...spec, postflop: { ...postflop, allin_threshold_pct: 101 } }, "allin_threshold_pct"],
      [{ ...spec, spec_version: 2 }, "/spec_version"],
    ];
    for (const [input, path] of cases) {
      expect(errorsOf(validate, input), path).toContainEqual(expect.stringContaining(path));
    }
  });

  it("R2.9 config ids follow the gto-model grammar and seats are its nine names", () => {
    const spec = readExample("valid", "seed-live.json") as Record<string, unknown>;
    const accepted = [
      "cfg_6_online_100",
      "cfg_9_live_13_150_straddle",
      "cfg_9_live_25_200_straddle_ante50",
      "cfg_2_online_50cbb",
    ];
    for (const id of accepted) {
      expect(errorsOf(validate, { ...spec, placeholder_for: id }), id).toEqual([]);
    }
    for (const id of ["cfg_6_online", "cfg_6_online_100_", "CFG_6_online_100", "cfg_1_live_100"]) {
      expect(errorsOf(validate, { ...spec, placeholder_for: id }), id).toContainEqual(
        expect.stringContaining("/placeholder_for must match pattern"),
      );
    }
    expect(errorsOf(validate, { ...spec, limp_positions: ["UTG1", "LJ"] })).toEqual([]);
    for (const seat of ["UTG+1", "utg", "MP", "BTN1"]) {
      expect(errorsOf(validate, { ...spec, limp_positions: [seat] }), seat).toContainEqual(
        expect.stringContaining("/limp_positions/0 must match pattern"),
      );
    }
  });
});

describe("R1.6 sizing convention seed rows", () => {
  it("R1.6 the eleven seed placeholder specs validate against the schema", () => {
    const specs = seedSpecs();
    expect(specs.size).toBe(SEED_CONFIG_COUNT);
    for (const [id, spec] of specs) {
      expect(errorsOf(validate, spec), id).toEqual([]);
    }
  });

  it("R1.6 the seed examples equal the specs the seed writes", () => {
    const specs = seedSpecs();
    expect(readExample("valid", "seed-online.json")).toEqual(specs.get("cfg_6_online_100"));
    expect(readExample("valid", "seed-live.json")).toEqual(specs.get("cfg_9_live_13_100"));
  });
});
