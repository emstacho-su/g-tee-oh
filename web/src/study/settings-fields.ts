/**
 * The study settings panel's fields (S39, R3.12, O-354, O-390; PR 37 review round 1): the choices
 * each field offers, which are unavailable and why, and, for a field that cannot offer choices
 * yet, the one reason it waits.
 *
 * Mechanism: every function is pure over the catalog lists the api sent (stakes, the
 * configurations of both formats, and the pairs of the draft's configuration) and a draft of six
 * fields in a fixed order: format, table size, stake, depth, first to act, against. fieldStates is
 * the single source the panel, the Confirm reason and the keep-or-drop rule read. A field is either
 * its choices (unavailable ones listed, disabled with the reason) or waiting, with a cause and a
 * reason: the first upper field still missing ("Choose a stake first."), the first upper field
 * whose choice is unavailable ("Choose an available stake first."), the catalog loading, or the
 * seats loading or failed to load. The pair is not chosen directly: two seats (the one that acts
 * first preflop, then its opponent) name the catalog entry whose oop and ip are those seats, so the
 * web applies no ordering rule of its own (O-390). Rake and depth are display formats of stored
 * values (ADR 0004).
 */
import type { Position } from "../drills/types.js";
import { seatedPositions } from "../drills/limits.js";
import { formatBasisPoints, formatCbb, formatCents } from "../poker/format.js";
import { distinctSorted, FORMAT_OPTIONS, NOT_IN_LIBRARY, resolveConfigId } from "./filters.js";
import type { GameConfig, PositionPairEntry, Stake } from "./queries.js";
import { MAX_TABLE_SIZE, type StudyFormat } from "./search.js";

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

/** Why a field has no choices: an upper field, the catalog, or the seats' read. */
export type WaitCause = "upper" | "catalog" | "seats-loading" | "seats-failed";

export type FieldState =
  | { readonly kind: "choices"; readonly choices: readonly SettingChoice[] }
  | { readonly kind: "waiting"; readonly cause: WaitCause; readonly reason: string };

export type FieldStates = Readonly<Record<SettingKey, FieldState>>;
export type SettingChoices = Readonly<Record<SettingKey, readonly SettingChoice[] | undefined>>;

/** Whether the read behind the draft configuration's seats failed (the panel shows its Retry). */
export interface SeatsReadState {
  readonly seatsFailed?: boolean;
}

export const SETTING_LABELS: Readonly<Record<SettingKey, string>> = {
  format: "Format",
  table_size: "Table size",
  stake: "Stake",
  depth: "Depth",
  first: "First to act",
  against: "Against",
};

export const REASONS = {
  notInCatalog: "Not in the catalog",
  notAtStakeAndSize: "Not at this stake and size",
  notInLibrary: NOT_IN_LIBRARY,
} as const;

export const WAIT_TEXT = {
  loadingCatalog: "Loading the catalog.",
  loadingSeats: "Loading the seats for these settings.",
  seatsFailed: "The seats for these settings could not be loaded.",
} as const;

/** What a field below a missing upper field says, by that upper field. */
const MISSING_UPPER_TEXT: Readonly<Record<SettingKey, string>> = {
  format: "Choose a format first.",
  table_size: "Choose a table size first.",
  stake: "Choose a stake first.",
  depth: "Choose a depth first.",
  first: "Choose who acts first.",
  against: "Choose the opponent first.",
};

/** What a field below an unavailable upper choice says, by that upper field. */
const UNAVAILABLE_UPPER_TEXT: Readonly<Record<SettingKey, string>> = {
  format: "Choose an available format first.",
  table_size: "Choose an available table size first.",
  stake: "Choose an available stake first.",
  depth: "Choose an available depth first.",
  first: "Choose an available seat to act first.",
  against: "Choose an available opponent first.",
};

/** Every seat in preflop action order; each table size seats a subsequence of it. */
export const SEAT_ORDER: readonly Position[] = seatedPositions(MAX_TABLE_SIZE);

export function isPosition(value: string): value is Position {
  return (SEAT_ORDER as readonly string[]).includes(value);
}

export function formatLabel(format: StudyFormat): string {
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

/** The draft configuration's pairs, or undefined while it is unresolved or they load. */
export function draftPairs(catalog: SettingsCatalog, draft: SettingsDraft): readonly PositionPairEntry[] | undefined {
  const configId = draftConfigId(catalog.configs, draft);
  return configId === undefined ? undefined : catalog.pairsOf(configId);
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

/** The first field above `key` the draft leaves empty, or undefined; shared with keepsLower. */
export function hasMissingUpper(draft: SettingsDraft, key: SettingKey): SettingKey | undefined {
  return SETTING_KEYS.slice(0, SETTING_KEYS.indexOf(key)).find((upper) => draft[upper] === undefined);
}

export function isAvailable(choices: readonly SettingChoice[], value: SettingsDraft[SettingKey]): boolean {
  return choices.some((entry) => entry.value === String(value) && !entry.disabled);
}

function waiting(cause: WaitCause, reason: string): FieldState {
  return { kind: "waiting", cause, reason };
}

/** A field's own choices once every upper field is chosen and available. */
function ownState(catalog: SettingsCatalog, draft: SettingsDraft, key: SettingKey, seatsFailed: boolean): FieldState {
  const { format, table_size: size, stake, first } = draft;
  const choices = (list: readonly SettingChoice[]): FieldState => ({ kind: "choices", choices: list });
  if (key === "format") return choices(formatChoices(catalog.configs));
  if (format === undefined) return waiting("upper", MISSING_UPPER_TEXT.format);
  if (key === "table_size") return choices(tableSizeChoices(catalog.configs, format));
  if (size === undefined) return waiting("upper", MISSING_UPPER_TEXT.table_size);
  if (key === "stake") return choices(stakeChoices(catalog, format, size));
  if (stake === undefined) return waiting("upper", MISSING_UPPER_TEXT.stake);
  if (key === "depth") return choices(depthChoices(catalog.configs, format, size, stake));
  const pairs = draftPairs(catalog, draft);
  if (pairs === undefined) return seatsFailed ? waiting("seats-failed", WAIT_TEXT.seatsFailed) : waiting("seats-loading", WAIT_TEXT.loadingSeats);
  if (key === "first") return choices(firstChoices(pairs, seatedPositions(size)));
  if (first === undefined) return waiting("upper", MISSING_UPPER_TEXT.first);
  return choices(againstChoices(pairs, seatedPositions(size), first));
}

/** Why the first upper field that blocks `key` does so, or undefined when none does. */
function upperBlock(states: Partial<Record<SettingKey, FieldState>>, draft: SettingsDraft, key: SettingKey): FieldState | undefined {
  for (const upper of SETTING_KEYS.slice(0, SETTING_KEYS.indexOf(key))) {
    const state = states[upper];
    if (state === undefined) continue;
    if (state.kind === "waiting") return state;
    if (!isAvailable(state.choices, draft[upper])) return waiting("upper", UNAVAILABLE_UPPER_TEXT[upper]);
  }
  return undefined;
}

/**
 * Every field's state, in field order: the first upper field missing, then the catalog loading,
 * then the first upper field waiting or unavailable, then the field's own choices (or its seats
 * loading or failed). The panel computes these once per draft (StudyPage's useMemo).
 */
export function fieldStates(
  catalog: SettingsCatalog | undefined,
  draft: SettingsDraft,
  { seatsFailed = false }: SeatsReadState = {},
): FieldStates {
  return SETTING_KEYS.reduce<Partial<Record<SettingKey, FieldState>>>((states, key) => {
    const missing = hasMissingUpper(draft, key);
    const state =
      missing !== undefined
        ? waiting("upper", MISSING_UPPER_TEXT[missing])
        : catalog === undefined
          ? waiting("catalog", WAIT_TEXT.loadingCatalog)
          : (upperBlock(states, draft, key) ?? ownState(catalog, draft, key, seatsFailed));
    return { ...states, [key]: state };
  }, {}) as FieldStates;
}

/** Each field's choices, or undefined while it waits (see fieldStates). */
export function settingChoices(catalog: SettingsCatalog, draft: SettingsDraft, read: SeatsReadState = {}): SettingChoices {
  const states = fieldStates(catalog, draft, read);
  const entries = SETTING_KEYS.map((key) => {
    const state = states[key];
    return [key, state.kind === "choices" ? state.choices : undefined] as const;
  });
  return Object.fromEntries(entries) as Record<SettingKey, readonly SettingChoice[] | undefined>;
}
