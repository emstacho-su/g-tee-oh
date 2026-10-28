/**
 * Session defaults for automated training (S32, R4.10, O-323, O-325): the grouping, RNG mode and
 * configuration scope the /train start screen offers first. These are the only fields an automated
 * session's body may set (services/api/src/automated/settings.ts plus config_ids); a seed is never
 * a default, since a client seed makes a session unrated.
 *
 * Mechanism: a zustand store persisted under "gto-session-defaults" through guarded storage
 * (guarded-storage.ts), so a storage failure only means the defaults are not remembered. A stored
 * value is validated field by field on read: grouping one of standard, grouped or simple; rng a
 * boolean; config scope "all" or a list of 1 to 32 distinct config ids that match the contract's
 * GameConfig config_id pattern. A field that fails falls back to its default and the others are
 * kept. The setters validate the same way and throw a RangeError on a value the api would refuse.
 */
import { create } from "zustand";

import type { Grouping } from "../contracts.js";
import { defaultStorage, isRecord, readJson, writeJson } from "./guarded-storage.js";
import { SESSION_DEFAULTS_STORAGE_KEY } from "./preference-keys.js";

export { SESSION_DEFAULTS_STORAGE_KEY };

export const GROUPINGS: readonly Grouping[] = ["standard", "grouped", "simple"];
export const ALL_CONFIGS = "all";
/**
 * The contract's minItems and maxItems of POST /sessions config_ids (the api's
 * MAX_SESSION_CONFIG_IDS); a drift test holds both to packages/contracts, so a stored scope never
 * makes the start answer 400.
 */
export const MIN_SCOPE_CONFIGS = 1;
export const MAX_SCOPE_CONFIGS = 32;
/** The contract's GameConfig config_id pattern; a drift test holds it to packages/contracts. */
export const CONFIG_ID_PATTERN = /^cfg_[2-9]_(online|live)(_[a-z0-9]+)?_[0-9]+(cbb)?(_straddle)?(_ante[0-9]+)?$/;

export type ConfigScope = typeof ALL_CONFIGS | readonly string[];

export interface SessionDefaults {
  readonly grouping: Grouping;
  readonly rng: boolean;
  readonly configScope: ConfigScope;
}

export const DEFAULT_SESSION_DEFAULTS: SessionDefaults = { grouping: "standard", rng: false, configScope: ALL_CONFIGS };

export interface SessionDefaultsEnvironment {
  storage?: Storage | null;
}

export interface SessionDefaultsState {
  defaults: SessionDefaults;
  setGrouping: (grouping: Grouping) => void;
  setRng: (rng: boolean) => void;
  setConfigScope: (scope: ConfigScope) => void;
}

export function isGrouping(value: unknown): value is Grouping {
  return typeof value === "string" && (GROUPINGS as readonly string[]).includes(value);
}

export function isConfigScope(value: unknown): value is ConfigScope {
  if (value === ALL_CONFIGS) return true;
  if (!Array.isArray(value)) return false;
  if (value.length < MIN_SCOPE_CONFIGS || value.length > MAX_SCOPE_CONFIGS) return false;
  if (new Set(value).size !== value.length) return false;
  return value.every((id) => typeof id === "string" && CONFIG_ID_PATTERN.test(id));
}

/** Validates a stored value field by field; a field that fails takes its default. */
export function parseSessionDefaults(value: unknown): SessionDefaults {
  if (!isRecord(value)) return DEFAULT_SESSION_DEFAULTS;
  const { grouping, rng, configScope } = value;
  return {
    grouping: isGrouping(grouping) ? grouping : DEFAULT_SESSION_DEFAULTS.grouping,
    rng: typeof rng === "boolean" ? rng : DEFAULT_SESSION_DEFAULTS.rng,
    configScope: isConfigScope(configScope) ? (configScope === ALL_CONFIGS ? ALL_CONFIGS : [...configScope]) : DEFAULT_SESSION_DEFAULTS.configScope,
  };
}

export function createSessionDefaultsStore(environment: SessionDefaultsEnvironment = {}) {
  const storage = environment.storage === undefined ? defaultStorage() : environment.storage;
  const initial = parseSessionDefaults(readJson(storage, SESSION_DEFAULTS_STORAGE_KEY));

  return create<SessionDefaultsState>()((set, get) => {
    const save = (patch: Partial<SessionDefaults>): void => {
      const defaults: SessionDefaults = { ...get().defaults, ...patch };
      writeJson(storage, SESSION_DEFAULTS_STORAGE_KEY, defaults);
      set({ defaults });
    };
    return {
      defaults: initial,
      setGrouping: (grouping) => {
        if (!isGrouping(grouping)) throw new RangeError(`${String(grouping)} is not a grouping`);
        save({ grouping });
      },
      setRng: (rng) => {
        if (typeof rng !== "boolean") throw new RangeError("rng must be true or false");
        save({ rng });
      },
      setConfigScope: (scope) => {
        if (!isConfigScope(scope)) throw new RangeError(`the configuration scope is "all" or 1 to ${MAX_SCOPE_CONFIGS} distinct config ids`);
        save({ configScope: scope === ALL_CONFIGS ? ALL_CONFIGS : [...scope] });
      },
    };
  });
}

/** The app's session defaults store; the /train start screen reads it (lane B). */
export const useSessionDefaultsStore = createSessionDefaultsStore();
