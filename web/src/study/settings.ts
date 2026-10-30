/**
 * The study settings panel's rules (S39, R3.12, O-354, O-390, O-392): how a change keeps or drops
 * the choices below it, when Confirm is allowed and why not, and the search Confirm writes. The
 * fields themselves (their choices, or the one reason each waits) are settings-fields.ts, re-exported
 * here, and every rule below reads that one source (PR 37 review round 1).
 *
 * Mechanism: every function is pure over the catalog lists the api sent and a draft of six fields
 * in a fixed order. A change keeps each lower choice that is still available, drops one whose
 * upper field is gone or that became unavailable, and lets seats wait while their configuration's
 * pairs load. confirmBlocker names the first thing in field order that stops Confirm.
 */
import { formatCbb } from "../poker/format.js";
import { FORMAT_OPTIONS, withoutNodeChoices } from "./filters.js";
import { potTypeLabel } from "./pot-type.js";
import type { Stake } from "./queries.js";
import { validateStudySearch, type StudySearch } from "./search.js";
import {
  SEAT_ORDER,
  SETTING_KEYS,
  SETTING_LABELS,
  REASONS,
  WAIT_TEXT,
  draftPair,
  draftPairs,
  fieldStates,
  formatLabel,
  hasMissingUpper,
  isAvailable,
  isPosition,
  stakeRakeText,
  type FieldState,
  type FieldStates,
  type SeatsReadState,
  type SettingKey,
  type SettingsCatalog,
  type SettingsDraft,
} from "./settings-fields.js";

export {
  REASONS,
  SETTING_KEYS,
  SETTING_LABELS,
  WAIT_TEXT,
  draftConfigId,
  draftPair,
  fieldStates,
  settingChoices,
  stakeRakeText,
} from "./settings-fields.js";
export type {
  FieldState,
  FieldStates,
  SeatsReadState,
  SettingChoice,
  SettingChoices,
  SettingKey,
  SettingsCatalog,
  SettingsDraft,
  WaitCause,
} from "./settings-fields.js";

/** Why Confirm is unavailable when a field is still empty. */
export const MISSING_TEXT: Readonly<Record<SettingKey, string>> = {
  format: "Choose the format.",
  table_size: "Choose the table size.",
  stake: "Choose the stake.",
  depth: "Choose the depth.",
  first: "Choose who acts first.",
  against: "Choose the opponent.",
};

/** The draft value a raw choice stands for, or undefined when it is malformed. */
function parseSetting(key: SettingKey, raw: string): SettingsDraft[SettingKey] {
  switch (key) {
    case "format":
      return FORMAT_OPTIONS.find((entry) => entry.value === raw)?.value;
    case "table_size":
      return validateStudySearch({ table_size: raw }).table_size;
    case "depth":
      return validateStudySearch({ depth: raw }).depth;
    case "stake":
      return validateStudySearch({ stake: raw }).stake;
    case "first":
    case "against":
      return isPosition(raw) ? raw : undefined;
  }
}

function withoutKey(draft: SettingsDraft, key: SettingKey): SettingsDraft {
  return Object.fromEntries(Object.entries(draft).filter(([name]) => name !== key));
}

/** Whether a lower field's choice survives a change above it (see withSetting). */
function keepsLower(catalog: SettingsCatalog, draft: SettingsDraft, lower: SettingKey): boolean {
  const current = draft[lower];
  if (current === undefined) return true;
  if (hasMissingUpper(draft, lower) !== undefined) return false;
  const state = fieldStates(catalog, draft)[lower];
  // Seats have no choices while their configuration's pairs load: they wait instead of going.
  if (state.kind === "waiting") return state.cause === "seats-loading" || state.cause === "seats-failed";
  return isAvailable(state.choices, current);
}

/**
 * The draft with each empty field below `key` that offers exactly one available choice filled with
 * it, in field order, so a chain of single choices (Live has one table size, one stake, one depth
 * here) is one click (S45, R3.27). A field with two or more choices, or still waiting, stops nothing:
 * the fields below it simply wait for it.
 */
function withSingleChoices(catalog: SettingsCatalog, draft: SettingsDraft, key: SettingKey): SettingsDraft {
  return SETTING_KEYS.slice(SETTING_KEYS.indexOf(key) + 1).reduce<SettingsDraft>((next, lower) => {
    if (next[lower] !== undefined) return next;
    const state = fieldStates(catalog, next)[lower];
    if (state.kind !== "choices") return next;
    const available = state.choices.filter((entry) => !entry.disabled);
    const only = available.length === 1 ? available[0] : undefined;
    const value = only === undefined ? undefined : parseSetting(lower, only.value);
    return value === undefined ? next : { ...next, [lower]: value };
  }, draft);
}

/**
 * The draft after a field changes to raw. Every lower choice that is still available stays; one
 * that became unavailable, or whose upper field is gone, is dropped. Seats wait (stay) while the
 * new configuration's pairs load, and are checked once they arrive (confirmBlocker). Then every
 * empty lower field with exactly one available choice takes it (S45).
 */
export function withSetting(catalog: SettingsCatalog, draft: SettingsDraft, key: SettingKey, raw: string): SettingsDraft {
  const value = parseSetting(key, raw);
  if (value === undefined) return draft;
  const kept = SETTING_KEYS.slice(SETTING_KEYS.indexOf(key) + 1).reduce<SettingsDraft>(
    (next, lower) => (keepsLower(catalog, next, lower) ? next : withoutKey(next, lower)),
    { ...draft, [key]: value },
  );
  return withSingleChoices(catalog, kept, key);
}

/** How many pairs the library covers at the draft's configuration, once its pairs have loaded (S45). */
export function coveredPairCount(catalog: SettingsCatalog | undefined, draft: SettingsDraft): number | undefined {
  const pairs = catalog === undefined ? undefined : draftPairs(catalog, draft);
  return pairs?.filter((entry) => entry.preflop_available).length;
}

/** "2 covered pairs at these settings". */
export function coveredPairsText(count: number): string {
  return `${count} covered ${count === 1 ? "pair" : "pairs"} at these settings`;
}

/** Why one field blocks Confirm, or undefined when its choice is made and available. */
function fieldBlocker(key: SettingKey, value: SettingsDraft[SettingKey], state: FieldState): string | undefined {
  if (state.kind === "waiting") return value === undefined && state.cause === "upper" ? MISSING_TEXT[key] : state.reason;
  if (value === undefined) return MISSING_TEXT[key];
  const chosen = state.choices.find((entry) => entry.value === String(value));
  if (chosen === undefined) return MISSING_TEXT[key];
  if (!chosen.disabled) return undefined;
  return `${SETTING_LABELS[key]}: ${chosen.label} is unavailable (${(chosen.reason ?? REASONS.notInLibrary).toLowerCase()}).`;
}

export interface ConfirmOptions extends SeatsReadState {
  /** The field states already computed for this draft (and seats state), to avoid computing them again. */
  readonly states?: FieldStates;
}

/**
 * Why Confirm is unavailable, in field order: the catalog still loading, the first field left
 * empty or naming no available choice, a seat list loading or failed to load, or a chosen value
 * that is unavailable (named with its reason). Undefined when the six choices name a covered pair.
 */
export function confirmBlocker(
  catalog: SettingsCatalog | undefined,
  draft: SettingsDraft,
  { states, seatsFailed = false }: ConfirmOptions = {},
): string | undefined {
  if (catalog === undefined) return WAIT_TEXT.loadingCatalog;
  const fields = states ?? fieldStates(catalog, draft, { seatsFailed });
  for (const key of SETTING_KEYS) {
    const blocker = fieldBlocker(key, draft[key], fields[key]);
    if (blocker !== undefined) return blocker;
  }
  return draftPair(draftPairs(catalog, draft), draft)?.preflop_available === true ? undefined : REASONS.notInLibrary;
}

/** True when the six choices name a covered pair (confirmBlocker finds nothing). */
export function canConfirm(catalog: SettingsCatalog, draft: SettingsDraft, options: ConfirmOptions = {}): boolean {
  return confirmBlocker(catalog, draft, options) === undefined;
}

/** The pair the draft's two seats name when the library does not cover it, for the panel's notice. */
export function draftUncoveredPair(catalog: SettingsCatalog, draft: SettingsDraft): string | undefined {
  const entry = draftPair(draftPairs(catalog, draft), draft);
  return entry?.preflop_available === false ? entry.pair : undefined;
}

/** The pair's two seats, the one that acts first preflop first; undefined for a malformed pair. */
function pairSeats(pair: string | undefined): Pick<SettingsDraft, "first" | "against"> {
  const seats = (pair ?? "").split("-").filter(isPosition);
  if (seats.length !== 2) return {};
  const [first, against] = [...seats].sort((left, right) => SEAT_ORDER.indexOf(left) - SEAT_ORDER.indexOf(right));
  return first === undefined || against === undefined ? {} : { first, against };
}

/** The record without its undefined values. */
function definedOnly(record: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

/** The draft the panel opens with: the URL's valid settings, its pair split into two seats. */
export function draftFromSearch(search: StudySearch): SettingsDraft {
  const { format, table_size: tableSize, stake, depth } = search;
  return definedOnly({ format, table_size: tableSize, stake, depth, ...pairSeats(search.pair) });
}

const SEARCH_SETTING_KEYS = ["format", "table_size", "stake", "depth", "pair"] as const;

/** A string that changes whenever one of the URL's five settings changes. */
export function settingsSignature(search: StudySearch): string {
  return SEARCH_SETTING_KEYS.map((key) => String(search[key] ?? "")).join("|");
}

/** The settings whose change starts the spot afresh; a depth or stake change keeps the line (O-467). */
const SPOT_KEYS = ["format", "table_size", "pair"] as const;

/**
 * The search Confirm writes. Unchanged settings keep the line, the hand and the mode. A change of
 * only the depth or the stake keeps the line, the hand and the mode too (not the action filters or the lens)
 * (S45, O-467): Confirm is only possible when the new configuration covers the pair, and a line the
 * new tree lacks reaches the node read's 404 path with its way back. Any other change starts at the
 * new pair's root with no hand, keeping only the matrix mode.
 */
export function searchFromDraft(search: StudySearch, draft: SettingsDraft, pair: string): StudySearch {
  const settings = validateStudySearch(
    definedOnly({ format: draft.format, table_size: draft.table_size, stake: draft.stake, depth: draft.depth, pair }),
  );
  if (settingsSignature(settings) === settingsSignature(search)) return search;
  // The filters and the lens name action indexes of the old tree, so they go (code review).
  if (SPOT_KEYS.every((key) => settings[key] === search[key])) return withoutNodeChoices({ ...search, ...settings });
  return validateStudySearch({ ...settings, mode: search.mode });
}

/** "Online, 6 players, online (5% rake, cap $1.50), 100bb, BTN against BB", then the pot type past the root (S45). */
export interface SummaryOptions {
  /** Name a stake the list does not hold by its id, so two spots that differ only by stake read apart (S45 code review). */
  readonly unlistedStakeById?: boolean;
}

function stakeText(stakes: readonly Stake[], id: string | undefined, options: SummaryOptions): string {
  if (id === undefined) return "";
  const stake = stakes.find((entry) => entry.id === id);
  if (stake !== undefined) return `${stake.label} (${stakeRakeText(stake)})`;
  return options.unlistedStakeById === true ? `stake ${id}` : "";
}

export function settingsSummary(stakes: readonly Stake[], search: StudySearch, options: SummaryOptions = {}): string {
  const { first, against } = pairSeats(search.pair);
  return [
    search.format === undefined ? "" : formatLabel(search.format),
    search.table_size === undefined ? "" : `${search.table_size} players`,
    stakeText(stakes, search.stake, options),
    search.depth === undefined ? "" : formatCbb(search.depth),
    first === undefined || against === undefined ? "" : `${first} against ${against}`,
    potTypeLabel(search.line) ?? "",
  ]
    .filter((part) => part !== "")
    .join(", ");
}
