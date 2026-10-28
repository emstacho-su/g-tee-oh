/**
 * The study settings panel's rules (S39, R3.12, O-354, O-390, O-392): the choices each field offers,
 * which are unavailable and why, how a change keeps or drops the choices below it, when Confirm is
 * allowed and the search Confirm writes.
 *
 * Mechanism: every function is pure over the catalog lists the api sent (stakes, the
 * configurations of both formats, and the pairs of the draft's configuration) and a draft of six
 * fields in a fixed order: format, table size, stake, depth, first to act, against. A field's
 * choices depend only on the fields above it, so no combination can lock the panel; a field whose
 * upper fields are not chosen has no choices yet (undefined). Unavailable choices stay listed,
 * disabled with the reason. The pair is not chosen directly: the library is solved per pair, and
 * two seats (the one that acts first preflop, then its opponent) name the catalog entry whose oop
 * and ip are those seats, so the web applies no ordering rule of its own (O-390). Rake and depth
 * are display formats of stored values (ADR 0004).
 */
import type { Position } from "../drills/types.js";
import { seatedPositions } from "../drills/limits.js";
import { formatBasisPoints, formatCbb, formatCents } from "../poker/format.js";
import { distinctSorted, FORMAT_OPTIONS, NOT_IN_LIBRARY, resolveConfigId } from "./filters.js";
import type { GameConfig, PositionPairEntry, Stake } from "./queries.js";
import { validateStudySearch, MAX_TABLE_SIZE, type StudyFormat, type StudySearch } from "./search.js";

export const SETTING_KEYS = ["format", "table_size", "stake", "depth", "first", "against"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export interface SettingsDraft {
  readonly format?: StudyFormat;
  readonly table_size?: number;
  readonly stake?: string;
  readonly depth?: number;
  readonly first?: Position;
  readonly against?: Position;
}

export interface SettingChoice {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
  readonly disabled: boolean;
  readonly reason?: string;
}

export interface SettingsCatalog {
  readonly stakes: readonly Stake[];
  /** The configurations of both formats. */
  readonly configs: readonly GameConfig[];
  /** A configuration's pairs; undefined while they have not loaded. */
  readonly pairsOf: (configId: string) => readonly PositionPairEntry[] | undefined;
}

export type SettingChoices = Readonly<Record<SettingKey, readonly SettingChoice[] | undefined>>;

export const SETTING_LABELS: Readonly<Record<SettingKey, string>> = {
  format: "Format",
  table_size: "Table size",
  stake: "Stake",
  depth: "Depth",
  first: "First to act",
  against: "Against",
};

/** What a field says while the fields above it are not chosen. */
export const SETTING_PROMPTS: Readonly<Record<SettingKey, string>> = {
  format: "Loading the formats.",
  table_size: "Choose a format first.",
  stake: "Choose a table size first.",
  depth: "Choose a stake first.",
  first: "Choose a depth first.",
  against: "Choose who acts first.",
};

export const REASONS = {
  notInCatalog: "Not in the catalog",
  notAtStakeAndSize: "Not at this stake and size",
  notInLibrary: NOT_IN_LIBRARY,
} as const;

/** Why Confirm is unavailable when a field is still empty. */
export const MISSING_TEXT: Readonly<Record<SettingKey, string>> = {
  format: "Choose the format.",
  table_size: "Choose the table size.",
  stake: "Choose the stake.",
  depth: "Choose the depth.",
  first: "Choose who acts first.",
  against: "Choose the opponent.",
};

export const BLOCKER_TEXT = {
  loadingCatalog: "Loading the catalog.",
  loadingSeats: "Loading the seats for these settings.",
  seatsFailed: "The seats for these settings could not be loaded.",
  noConfiguration: "Choose an available depth first.",
} as const;

/** Every seat in preflop action order; each table size seats a subsequence of it. */
const SEAT_ORDER: readonly Position[] = seatedPositions(MAX_TABLE_SIZE);

function formatLabel(format: StudyFormat): string {
  return FORMAT_OPTIONS.find((entry) => entry.value === format)?.label ?? format;
}

function choice(value: string, label: string, reason: string | undefined, detail?: string): SettingChoice {
  return {
    value,
    label,
    disabled: reason !== undefined,
    ...(reason === undefined ? {} : { reason }),
    ...(detail === undefined ? {} : { detail }),
  };
}

/** "5% rake, cap $1.50", with ", no flop no drop" when the stake has it. */
export function stakeRakeText(stake: Stake): string {
  const base = `${formatBasisPoints(stake.rake_percent_bp)} rake, cap ${formatCents(stake.rake_cap_cents)}`;
  return stake.no_flop_no_drop ? `${base}, no flop no drop` : base;
}

/** The catalog entry two seats name, in either order. */
export function draftPair(
  pairs: readonly PositionPairEntry[] | undefined,
  draft: Pick<SettingsDraft, "first" | "against">,
): PositionPairEntry | undefined {
  const { first, against } = draft;
  if (pairs === undefined || first === undefined || against === undefined) return undefined;
  return pairs.find((entry) => (entry.oop === first && entry.ip === against) || (entry.oop === against && entry.ip === first));
}

export function draftConfigId(configs: readonly GameConfig[], draft: SettingsDraft): string | undefined {
  return resolveConfigId(configs, draft);
}

function formatChoices(configs: readonly GameConfig[]): SettingChoice[] {
  return FORMAT_OPTIONS.map(({ value, label }) =>
    choice(value, label, configs.some((config) => config.format === value) ? undefined : REASONS.notInCatalog),
  );
}

function tableSizeChoices(configs: readonly GameConfig[], format: StudyFormat): SettingChoice[] {
  return distinctSorted(configs.map((config) => config.table_size)).map((size) => {
    const offered = configs.some((config) => config.format === format && config.table_size === size);
    return choice(String(size), `${size} players`, offered ? undefined : `No ${formatLabel(format).toLowerCase()} game at this size`);
  });
}

function stakeChoices(catalog: SettingsCatalog, format: StudyFormat, size: number): SettingChoice[] {
  return catalog.stakes
    .filter((stake) => stake.format === format)
    .map((stake) => {
      const offered = catalog.configs.some(
        (config) => config.format === format && config.table_size === size && config.stake_id === stake.id,
      );
      return choice(stake.id, stake.label, offered ? undefined : `No ${size}-player game at this stake`, stakeRakeText(stake));
    });
}

function depthChoices(configs: readonly GameConfig[], format: StudyFormat, size: number, stakeId: string): SettingChoice[] {
  const formatConfigs = configs.filter((config) => config.format === format);
  return distinctSorted(formatConfigs.map((config) => config.depth_cbb)).map((depth) => {
    const offered = formatConfigs.some(
      (config) => config.table_size === size && config.stake_id === stakeId && config.depth_cbb === depth,
    );
    return choice(String(depth), formatCbb(depth), offered ? undefined : REASONS.notAtStakeAndSize);
  });
}

function covered(pairs: readonly PositionPairEntry[], first: Position, against: Position): boolean {
  return draftPair(pairs, { first, against })?.preflop_available === true;
}

function firstChoices(pairs: readonly PositionPairEntry[], seats: readonly Position[]): SettingChoice[] {
  return seats.slice(0, -1).map((seat, index) => {
    const later = seats.slice(index + 1);
    return choice(seat, seat, later.some((other) => covered(pairs, seat, other)) ? undefined : REASONS.notInLibrary);
  });
}

function againstChoices(pairs: readonly PositionPairEntry[], seats: readonly Position[], first: Position): SettingChoice[] {
  const start = seats.indexOf(first);
  if (start === -1) return [];
  return seats.slice(start + 1).map((seat) => choice(seat, seat, covered(pairs, first, seat) ? undefined : REASONS.notInLibrary));
}

/** The draft configuration's pairs, or undefined while it is unresolved or they load. */
function draftPairs(catalog: SettingsCatalog, draft: SettingsDraft): readonly PositionPairEntry[] | undefined {
  const configId = draftConfigId(catalog.configs, draft);
  return configId === undefined ? undefined : catalog.pairsOf(configId);
}

/** One field's choices; undefined while its upper fields are not chosen (or its seats load). */
function fieldChoices(catalog: SettingsCatalog, draft: SettingsDraft, key: SettingKey): readonly SettingChoice[] | undefined {
  const { format, table_size: size, stake, depth, first } = draft;
  switch (key) {
    case "format":
      return formatChoices(catalog.configs);
    case "table_size":
      return format === undefined ? undefined : tableSizeChoices(catalog.configs, format);
    case "stake":
      return format === undefined || size === undefined ? undefined : stakeChoices(catalog, format, size);
    case "depth":
      return format === undefined || size === undefined || stake === undefined
        ? undefined
        : depthChoices(catalog.configs, format, size, stake);
    case "first": {
      const pairs = draftPairs(catalog, draft);
      return depth === undefined || size === undefined || pairs === undefined ? undefined : firstChoices(pairs, seatedPositions(size));
    }
    case "against": {
      const pairs = draftPairs(catalog, draft);
      return first === undefined || size === undefined || pairs === undefined
        ? undefined
        : againstChoices(pairs, seatedPositions(size), first);
    }
  }
}

/**
 * Each field's choices; undefined for a field whose upper fields are not chosen yet. The panel
 * computes them once per draft (StudyPage's useMemo) and hands them to confirmBlocker.
 */
export function settingChoices(catalog: SettingsCatalog, draft: SettingsDraft): SettingChoices {
  const entries = SETTING_KEYS.map((key) => [key, fieldChoices(catalog, draft, key)] as const);
  return Object.fromEntries(entries) as Record<SettingKey, readonly SettingChoice[] | undefined>;
}

function isPosition(value: string): value is Position {
  return (SEAT_ORDER as readonly string[]).includes(value);
}

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

function available(choices: readonly SettingChoice[], value: SettingsDraft[SettingKey]): boolean {
  return choices.some((entry) => entry.value === String(value) && !entry.disabled);
}

/**
 * The draft after a field changes to raw. Every lower choice that is still available stays; one
 * that became unavailable, or whose upper field is gone, is dropped. Seats wait (stay) while the
 * new configuration's pairs load, and are checked once they arrive (canConfirm).
 */
export function withSetting(catalog: SettingsCatalog, draft: SettingsDraft, key: SettingKey, raw: string): SettingsDraft {
  const value = parseSetting(key, raw);
  if (value === undefined) return draft;
  return SETTING_KEYS.slice(SETTING_KEYS.indexOf(key) + 1).reduce<SettingsDraft>(
    (next, lower) => (keepsLower(catalog, next, lower) ? next : withoutKey(next, lower)),
    { ...draft, [key]: value },
  );
}

/** Whether a lower field's choice survives a change above it (see withSetting). */
function keepsLower(catalog: SettingsCatalog, draft: SettingsDraft, lower: SettingKey): boolean {
  const current = draft[lower];
  if (current === undefined) return true;
  const upperMissing = SETTING_KEYS.slice(0, SETTING_KEYS.indexOf(lower)).some((upper) => draft[upper] === undefined);
  if (upperMissing) return false;
  const choices = fieldChoices(catalog, draft, lower);
  // Seats have no choices while the configuration's pairs load: they wait instead of going.
  if (choices === undefined) return lower === "first" || lower === "against";
  return available(choices, current);
}

function isSeat(key: SettingKey): boolean {
  return key === "first" || key === "against";
}

/** Whether the read behind the draft configuration's seats failed (the panel shows its Retry). */
export interface SeatsReadState {
  readonly seatsFailed?: boolean;
}

function seatsText(seatsFailed: boolean): string {
  return seatsFailed ? BLOCKER_TEXT.seatsFailed : BLOCKER_TEXT.loadingSeats;
}

/**
 * What a field shows in place of its choices (S39 follow-up): the prompt for the first upper field
 * still missing, the catalog loading, or for the seats, why they are not there with every upper
 * field chosen: the chosen depth names no configuration, or the seats are loading, or their read
 * failed.
 */
export function fieldWaitText(catalog: SettingsCatalog | undefined, draft: SettingsDraft, key: SettingKey, seatsFailed: boolean): string {
  const upperMissing = SETTING_KEYS.slice(0, SETTING_KEYS.indexOf(key)).some((upper) => draft[upper] === undefined);
  if (upperMissing) return SETTING_PROMPTS[key];
  if (catalog === undefined) return BLOCKER_TEXT.loadingCatalog;
  if (!isSeat(key)) return SETTING_PROMPTS[key];
  if (draftConfigId(catalog.configs, draft) === undefined) return BLOCKER_TEXT.noConfiguration;
  return seatsText(seatsFailed);
}

/** Why one field blocks Confirm, or undefined when its choice is made and available. */
function fieldBlocker(
  key: SettingKey,
  value: SettingsDraft[SettingKey],
  choices: readonly SettingChoice[] | undefined,
  seatsFailed: boolean,
): string | undefined {
  if (choices === undefined) return isSeat(key) ? seatsText(seatsFailed) : MISSING_TEXT[key];
  if (value === undefined) return MISSING_TEXT[key];
  const chosen = choices.find((entry) => entry.value === String(value));
  if (chosen === undefined) return MISSING_TEXT[key];
  if (!chosen.disabled) return undefined;
  return `${SETTING_LABELS[key]}: ${chosen.label} is unavailable (${(chosen.reason ?? REASONS.notInLibrary).toLowerCase()}).`;
}

/**
 * Why Confirm is unavailable, in the field order: the catalog still loading, the first field left
 * empty, a seat list still loading or failed to load, or a chosen value that is unavailable (named
 * with its reason). Undefined when the six choices name a covered pair. Pass the choices already
 * computed for this draft to avoid computing them again.
 */
export function confirmBlocker(
  catalog: SettingsCatalog | undefined,
  draft: SettingsDraft,
  choices: SettingChoices | undefined = catalog === undefined ? undefined : settingChoices(catalog, draft),
  { seatsFailed = false }: SeatsReadState = {},
): string | undefined {
  if (catalog === undefined || choices === undefined) return BLOCKER_TEXT.loadingCatalog;
  for (const key of SETTING_KEYS) {
    const blocker = fieldBlocker(key, draft[key], choices[key], seatsFailed);
    if (blocker !== undefined) return blocker;
  }
  return draftPair(draftPairs(catalog, draft), draft)?.preflop_available === true ? undefined : REASONS.notInLibrary;
}

/** True when the six choices name a covered pair (confirmBlocker finds nothing). */
export function canConfirm(catalog: SettingsCatalog, draft: SettingsDraft, choices?: SettingChoices): boolean {
  return confirmBlocker(catalog, draft, choices) === undefined;
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

/**
 * The search Confirm writes. Unchanged settings keep the line, the hand and the mode; changed
 * settings start at the new pair's root with no hand, keeping only the matrix mode.
 */
export function searchFromDraft(search: StudySearch, draft: SettingsDraft, pair: string): StudySearch {
  const settings = validateStudySearch(
    definedOnly({ format: draft.format, table_size: draft.table_size, stake: draft.stake, depth: draft.depth, pair }),
  );
  if (settingsSignature(settings) === settingsSignature(search)) return search;
  return validateStudySearch({ ...settings, mode: search.mode });
}

/** "Online, 6 players, online (5% rake, cap $1.50), 100bb, BTN against BB". */
export function settingsSummary(stakes: readonly Stake[], search: StudySearch): string {
  const stake = stakes.find((entry) => entry.id === search.stake);
  const { first, against } = pairSeats(search.pair);
  return [
    search.format === undefined ? "" : formatLabel(search.format),
    search.table_size === undefined ? "" : `${search.table_size} players`,
    stake === undefined ? "" : `${stake.label} (${stakeRakeText(stake)})`,
    search.depth === undefined ? "" : formatCbb(search.depth),
    first === undefined || against === undefined ? "" : `${first} against ${against}`,
  ]
    .filter((part) => part !== "")
    .join(", ");
}
