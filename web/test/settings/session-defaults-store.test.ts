/**
 * The session defaults store (S32, R4.12, O-323, O-325): defaults, a valid round trip, tampered
 * fields falling back one by one, storage that throws, setters that refuse what the api would
 * refuse, and the config id pattern held to the contract.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALL_CONFIGS,
  CONFIG_ID_PATTERN,
  createSessionDefaultsStore,
  DEFAULT_SESSION_DEFAULTS,
  isConfigScope,
  MAX_SCOPE_CONFIGS,
  MIN_SCOPE_CONFIGS,
  parseSessionDefaults,
  SESSION_DEFAULTS_STORAGE_KEY,
} from "../../src/store/index.js";
import { memoryStorage, throwingStorage } from "../support/storage.js";

type Node = Readonly<Record<string, unknown>>;

/** Vitest runs from web/, so the contract sits at ../packages/contracts (as test/drills/contract-limits.test.ts reads it). */
const contract = JSON.parse(readFileSync(join(process.cwd(), "..", "packages", "contracts", "api.openapi.json"), "utf8")) as Node;

/** The node at a path of keys; throws, naming the path, when the contract has no such node. */
function at(root: Node, ...keys: readonly string[]): Node {
  return keys.reduce<Node>((node, key) => {
    const child = node[key];
    if (typeof child !== "object" || child === null) throw new Error(`the contract has no ${keys.join(".")}`);
    return child as Node;
  }, root);
}

const CONFIG_A = "cfg_6_online_100";
const CONFIG_B = "cfg_9_live_13_150";

describe("R4.12 session defaults store", () => {
  it("R4.12 starts at standard grouping, RNG off and every covered configuration", () => {
    const store = createSessionDefaultsStore({ storage: memoryStorage() });
    expect(store.getState().defaults).toEqual({ grouping: "standard", rng: false, configScope: ALL_CONFIGS });
  });

  it("R4.12 each change is written and a fresh store reads it back", () => {
    const storage = memoryStorage();
    const store = createSessionDefaultsStore({ storage });
    store.getState().setGrouping("simple");
    store.getState().setRng(true);
    store.getState().setConfigScope([CONFIG_A, CONFIG_B]);
    expect(createSessionDefaultsStore({ storage }).getState().defaults).toEqual({ grouping: "simple", rng: true, configScope: [CONFIG_A, CONFIG_B] });
    store.getState().setConfigScope(ALL_CONFIGS);
    expect(createSessionDefaultsStore({ storage }).getState().defaults.configScope).toBe(ALL_CONFIGS);
  });

  it("R4.12 a tampered field falls back to its default and the other fields are kept", () => {
    const stored = JSON.stringify({ grouping: "fancy", rng: true, configScope: [CONFIG_A, "drop table"] });
    const store = createSessionDefaultsStore({ storage: memoryStorage({ [SESSION_DEFAULTS_STORAGE_KEY]: stored }) });
    expect(store.getState().defaults).toEqual({ grouping: "standard", rng: true, configScope: ALL_CONFIGS });
    expect(parseSessionDefaults({ grouping: "grouped", rng: "yes", configScope: [] })).toEqual({ ...DEFAULT_SESSION_DEFAULTS, grouping: "grouped" });
    expect(parseSessionDefaults("standard")).toEqual(DEFAULT_SESSION_DEFAULTS);
    const broken = createSessionDefaultsStore({ storage: memoryStorage({ [SESSION_DEFAULTS_STORAGE_KEY]: "{" }) });
    expect(broken.getState().defaults).toEqual(DEFAULT_SESSION_DEFAULTS);
  });

  it("R4.12 a config scope is all, or 1 to 32 distinct ids in the contract's pattern", () => {
    expect(isConfigScope(ALL_CONFIGS)).toBe(true);
    expect(isConfigScope([CONFIG_A])).toBe(true);
    expect(isConfigScope([])).toBe(false);
    expect(isConfigScope([CONFIG_A, CONFIG_A])).toBe(false);
    expect(isConfigScope([7])).toBe(false);
    expect(isConfigScope("some")).toBe(false);
    const many = Array.from({ length: MAX_SCOPE_CONFIGS + 1 }, (_, index) => `cfg_6_online_${index + 1}`);
    expect(isConfigScope(many.slice(0, MAX_SCOPE_CONFIGS))).toBe(true);
    expect(isConfigScope(many)).toBe(false);
  });

  it("R4.12 a stored scope over the api's cap of 32 falls back to all on load", () => {
    const over = Array.from({ length: MAX_SCOPE_CONFIGS + 1 }, (_, index) => `cfg_6_online_${index + 1}`);
    const atCap = over.slice(0, MAX_SCOPE_CONFIGS);
    const storedOver = JSON.stringify({ grouping: "grouped", rng: false, configScope: over });
    const store = createSessionDefaultsStore({ storage: memoryStorage({ [SESSION_DEFAULTS_STORAGE_KEY]: storedOver }) });
    expect(MAX_SCOPE_CONFIGS).toBe(32);
    expect(store.getState().defaults).toEqual({ grouping: "grouped", rng: false, configScope: ALL_CONFIGS });
    const storedAtCap = JSON.stringify({ configScope: atCap });
    expect(createSessionDefaultsStore({ storage: memoryStorage({ [SESSION_DEFAULTS_STORAGE_KEY]: storedAtCap }) }).getState().defaults.configScope).toEqual(atCap);
  });

  it("R4.12 the setters refuse a value the api would refuse and keep the defaults", () => {
    const store = createSessionDefaultsStore({ storage: memoryStorage() });
    expect(() => store.getState().setGrouping("fancy" as never)).toThrow(RangeError);
    expect(() => store.getState().setRng("on" as never)).toThrow(RangeError);
    expect(() => store.getState().setConfigScope([])).toThrow(RangeError);
    expect(store.getState().defaults).toEqual(DEFAULT_SESSION_DEFAULTS);
  });

  it("R4.12 storage that throws or is missing leaves the defaults and still applies changes", () => {
    for (const storage of [throwingStorage(), null]) {
      const store = createSessionDefaultsStore({ storage });
      expect(store.getState().defaults).toEqual(DEFAULT_SESSION_DEFAULTS);
      store.getState().setRng(true);
      expect(store.getState().defaults.rng).toBe(true);
    }
  });

  it("R4.12 the config id pattern and scope limits match the contract (GameConfig, POST /sessions config_ids)", () => {
    expect(CONFIG_ID_PATTERN.source).toBe(at(contract, "components", "schemas", "GameConfig", "properties", "config_id")["pattern"]);
    const configIds = at(contract, "paths", "/api/v1/sessions", "post", "requestBody", "content", "application/json", "schema", "properties", "config_ids");
    expect(configIds["minItems"]).toBe(MIN_SCOPE_CONFIGS);
    expect(configIds["maxItems"]).toBe(MAX_SCOPE_CONFIGS);
    expect(at(configIds, "items")["pattern"]).toBe(CONFIG_ID_PATTERN.source);
  });
});
