/**
 * The builder settings the screens show and edit (S28, R3.5, O-292, O-296, O-188).
 *
 * Mechanism: GET /admin/builder returns only the stored overrides; an absent key means the
 * builder's own default. BUILDER_DEFAULTS copies those defaults for the keys shown here from the
 * table at the top of services/library-builder/src/settings.rs, and
 * test/library/builder-settings.test.ts reads that table and fails when a value drifts, the way
 * the api's admin-settings-keys test holds its key list to the builder.
 *
 * Each editable field maps a stored value to the text in its input and back. A text that is not
 * a number inside the field's bounds (the bounds BuilderSettingsPatchInput states) parses to an
 * error message and is never sent; the api validates again and the builder checks the semantics
 * it alone knows (O-188). The budget is edited in gigabytes (10^9 bytes, the unit ADR 0018's
 * 650 GB is written in) and stored in bytes.
 */
import type { BuilderStatus } from "../contracts.js";

export interface OvernightWindow {
  readonly start_hour: number;
  readonly end_hour: number;
  readonly utc_offset_minutes: number;
  readonly cpu_share: number;
}

/** The builder's defaults for the keys these screens show (settings.rs table). */
export const BUILDER_DEFAULTS = {
  paused: false,
  cpu_share: 0.5,
  overnight: { start_hour: 0, end_hour: 7, utc_offset_minutes: 0, cpu_share: 1.0 } satisfies OvernightWindow,
  budget_bytes: 650_000_000_000,
  k_runouts: 20,
  target_pct_pot: 0.3,
  max_seconds_per_line: 1800,
} as const;

export type NumericSettingKey = "cpu_share" | "budget_bytes" | "k_runouts" | "target_pct_pot" | "max_seconds_per_line";
export type StoredSettings = BuilderStatus["settings"];

export const BYTES_PER_GB = 1_000_000_000;
const MAX_K_RUNOUTS = 2352;
const MAX_TARGET_PCT_POT = 100;
const MAX_SECONDS_PER_LINE = 86_400;
const MAX_BUDGET_GB = Math.floor(Number.MAX_SAFE_INTEGER / BYTES_PER_GB);

export interface NumericField {
  readonly key: NumericSettingKey;
  readonly label: string;
  readonly hint: string;
  /** The stored value as the input shows it. */
  readonly toInput: (value: number) => string;
  /** The input text as the value to store, or a message saying what is wrong. */
  readonly parse: (text: string) => { value: number } | { error: string };
}

function numberIn(text: string, min: number, max: number, options: { integer: boolean; minExclusive: boolean }) {
  const trimmed = text.trim();
  const value = trimmed === "" ? Number.NaN : Number(trimmed);
  const aboveMin = options.minExclusive ? value > min : value >= min;
  const ok = Number.isFinite(value) && aboveMin && value <= max && (!options.integer || Number.isInteger(value));
  return ok ? value : undefined;
}

function boundedField(
  key: NumericSettingKey,
  label: string,
  hint: string,
  bounds: { max: number; integer: boolean },
  scale = 1,
): NumericField {
  return {
    key,
    label,
    hint,
    toInput: (value) => String(value / scale),
    parse: (text) => {
      const value = numberIn(text, 0, bounds.max, { integer: bounds.integer, minExclusive: true });
      // A scaled field is whole-numbered in its display unit, so value * scale is an exact integer.
      return value === undefined ? { error: `${label}: ${hint}` } : { value: value * scale };
    },
  };
}

/** The fields the /library settings form edits (O-296). */
export const LIBRARY_SETTING_FIELDS: readonly NumericField[] = [
  boundedField("cpu_share", "CPU share", "above 0 and at most 1, outside the overnight window", { max: 1, integer: false }),
  boundedField("budget_bytes", "Storage budget (GB)", `a whole number of gigabytes, at least 1`, { max: MAX_BUDGET_GB, integer: true }, BYTES_PER_GB),
  boundedField("k_runouts", "Runouts per flop", `a whole number from 1 to ${MAX_K_RUNOUTS}`, { max: MAX_K_RUNOUTS, integer: true }),
  boundedField("target_pct_pot", "Target exploitability (% of pot)", `above 0 and at most ${MAX_TARGET_PCT_POT}`, { max: MAX_TARGET_PCT_POT, integer: false }),
  boundedField("max_seconds_per_line", "Seconds per line", `a whole number from 1 to ${MAX_SECONDS_PER_LINE}`, { max: MAX_SECONDS_PER_LINE, integer: true }),
];

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A numeric setting in force: the stored override, else the builder default. */
export function numericSetting(settings: StoredSettings, key: NumericSettingKey): { value: number; stored: boolean } {
  const stored = settings[key];
  return isNumber(stored) ? { value: stored, stored: true } : { value: BUILDER_DEFAULTS[key], stored: false };
}

function isOvernight(value: unknown): value is OvernightWindow {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return ["start_hour", "end_hour", "utc_offset_minutes", "cpu_share"].every((key) => isNumber(candidate[key]));
}

/** The overnight window in force: the stored override, else the builder default. */
export function overnightSetting(settings: StoredSettings): { value: OvernightWindow; stored: boolean } {
  const stored = settings["overnight"];
  return isOvernight(stored) ? { value: stored, stored: true } : { value: BUILDER_DEFAULTS.overnight, stored: false };
}

const LAST_HOUR = 23;
const MAX_UTC_OFFSET_MINUTES = 24 * 60 - 1;

export type OvernightKey = keyof OvernightWindow;
export type OvernightTexts = Readonly<Record<OvernightKey, string>>;

interface OvernightFieldSpec {
  readonly key: OvernightKey;
  readonly label: string;
  readonly hint: string;
  readonly min: number;
  readonly max: number;
  readonly integer: boolean;
  readonly minExclusive: boolean;
}

/** The /settings builder schedule fields (O-296, the O-13 overnight boost). */
export const OVERNIGHT_FIELDS: readonly OvernightFieldSpec[] = [
  { key: "start_hour", label: "Window starts (hour)", hint: "a whole hour from 0 to 23", min: 0, max: LAST_HOUR, integer: true, minExclusive: false },
  { key: "end_hour", label: "Window ends (hour)", hint: "a whole hour from 0 to 23", min: 0, max: LAST_HOUR, integer: true, minExclusive: false },
  {
    key: "utc_offset_minutes",
    label: "UTC offset (minutes)",
    hint: `a whole number of minutes from -${MAX_UTC_OFFSET_MINUTES} to ${MAX_UTC_OFFSET_MINUTES}, for example -300 for UTC-5`,
    min: -MAX_UTC_OFFSET_MINUTES,
    max: MAX_UTC_OFFSET_MINUTES,
    integer: true,
    minExclusive: false,
  },
  { key: "cpu_share", label: "CPU share in the window", hint: "above 0 and at most 1", min: 0, max: 1, integer: false, minExclusive: true },
];

export function overnightTexts(window: OvernightWindow): OvernightTexts {
  return {
    start_hour: String(window.start_hour),
    end_hour: String(window.end_hour),
    utc_offset_minutes: String(window.utc_offset_minutes),
    cpu_share: String(window.cpu_share),
  };
}

/** The window the texts describe, or the first field's error. */
export function parseOvernight(texts: OvernightTexts): { value: OvernightWindow } | { error: string; key: OvernightKey } {
  const parsed: Partial<Record<OvernightKey, number>> = {};
  for (const field of OVERNIGHT_FIELDS) {
    const value = numberIn(texts[field.key], field.min, field.max, field);
    if (value === undefined) return { error: `${field.label}: ${field.hint}`, key: field.key };
    parsed[field.key] = value;
  }
  return { value: parsed as OvernightWindow };
}

export function sameWindow(a: OvernightWindow, b: OvernightWindow): boolean {
  return OVERNIGHT_FIELDS.every((field) => a[field.key] === b[field.key]);
}

/** Whether the stored paused setting is on. */
export function isPausedSetting(settings: StoredSettings): boolean {
  return settings["paused"] === true;
}
