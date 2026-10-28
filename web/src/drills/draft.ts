/**
 * The builder's draft of a drill (S26, R3.14, O-311, O-317): the form's whole state as one plain
 * value, with the fields a user types (name, tags, depths, sizes, line, flops) kept as the text
 * typed, so a half-typed "100, 1" never loses a keystroke.
 *
 * Mechanism: newDrillDraft is the default new drill; draftFromDrill reads a stored drill into a
 * draft; draftToCreate parses the text fields and runs the write rules (body-rules.ts), answering
 * either the DrillCreate body or every error by field path; draftToPatch does the same and keeps
 * only the top-level fields that differ from the stored drill, so an untouched spot filter is
 * never re-sent. Every stored value survives the round trip, including fields v1 does not serve
 * (O-317) and a manual hand list kept while another hands mode is chosen. All functions are pure
 * and never mutate their input.
 */
import { checkDrillBody } from "./body-rules.js";
import { COPY_SUFFIX, MAX_DRILL_NAME_LENGTH } from "./limits.js";
import type {
  BoardConnectivity,
  BoardFilter,
  BoardSuits,
  Drill,
  DrillCreate,
  DrillPatch,
  FieldError,
  GameFormat,
  HandsFilter,
  HandsMode,
  HighCard,
  Position,
  PreflopAction,
  Sizing,
  SpotFilter,
  StartStreet,
  TrainerSettings,
} from "./types.js";

export type PairedChoice = "" | "yes" | "no";

/** The board filter as the form holds it; "" means the filter is not set. */
export interface BoardDraft {
  readonly highCard: HighCard | "";
  readonly paired: PairedChoice;
  readonly suits: BoardSuits | "";
  readonly connectivity: BoardConnectivity | "";
  readonly flopsText: string;
}

export interface DrillDraft {
  readonly name: string;
  readonly tagsText: string;
  readonly format: GameFormat;
  readonly tableSize: number;
  readonly depthsText: string;
  readonly stake: string;
  readonly sizingMode: Sizing["mode"];
  readonly openBbText: string;
  readonly threeBetBbText: string;
  readonly startStreet: StartStreet;
  readonly heroPositions: readonly Position[];
  readonly villainPositions: readonly Position[];
  readonly preflopAction: readonly PreflopAction[];
  readonly lineText: string;
  readonly board: BoardDraft;
  readonly handsMode: HandsMode;
  /** The manual list; kept while another mode is chosen, sent only in manual mode. */
  readonly manualHands: readonly string[];
  readonly alternateSeats: boolean;
  readonly trainer: TrainerSettings;
}

export type DraftResult<T> = { readonly ok: true; readonly body: T } | { readonly ok: false; readonly errors: readonly FieldError[] };

const DEFAULT_DEPTH_BB = 100;
const DEFAULT_TABLE_SIZE = 6;
const LIST_SEPARATOR = /[\s,]+/;

export const EMPTY_BOARD: BoardDraft = { highCard: "", paired: "", suits: "", connectivity: "", flopsText: "" };

export const DEFAULT_TRAINER: TrainerSettings = {
  stop_rule: "after_action",
  input: "actions",
  grouping: "standard",
  rng: false,
  pause: "every_action",
  speed: "normal",
  quick_result: false,
  tables: 1,
  timebank_s: null,
  panels: {},
};

/** The default new drill: online 6-handed at 100 bb, preflop RFI, every hand, no hero yet. */
export function newDrillDraft(): DrillDraft {
  return {
    name: "",
    tagsText: "",
    format: "online",
    tableSize: DEFAULT_TABLE_SIZE,
    depthsText: String(DEFAULT_DEPTH_BB),
    stake: "online",
    sizingMode: "convention",
    openBbText: "",
    threeBetBbText: "",
    startStreet: "preflop",
    heroPositions: [],
    villainPositions: [],
    preflopAction: ["rfi"],
    lineText: "",
    board: EMPTY_BOARD,
    handsMode: "all",
    manualHands: [],
    alternateSeats: false,
    trainer: DEFAULT_TRAINER,
  };
}

function numberText(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

function boardDraftOf(board: BoardFilter | undefined): BoardDraft {
  if (board === undefined) return EMPTY_BOARD;
  return {
    highCard: board.high_card ?? "",
    paired: board.paired === undefined ? "" : board.paired ? "yes" : "no",
    suits: board.suits ?? "",
    connectivity: board.connectivity ?? "",
    flopsText: (board.flops ?? []).join(" "),
  };
}

/** A stored drill as a draft the form edits. */
export function draftFromDrill(drill: Drill): DrillDraft {
  const filter = drill.spot_filter;
  const fixed = filter.sizing.mode === "fixed" ? filter.sizing : undefined;
  return {
    name: drill.name,
    tagsText: drill.tags.join(" "),
    format: filter.game_config.format,
    tableSize: filter.game_config.table_size,
    depthsText: filter.game_config.depths_bb.join(", "),
    stake: filter.stake,
    sizingMode: filter.sizing.mode,
    openBbText: numberText(fixed?.open_bb),
    threeBetBbText: numberText(fixed?.three_bet_bb),
    startStreet: filter.start_street,
    heroPositions: filter.hero_positions,
    villainPositions: filter.villain_positions,
    preflopAction: filter.preflop_action,
    lineText: filter.line ?? "",
    board: boardDraftOf(filter.board),
    handsMode: filter.hands.mode,
    manualHands: filter.hands.mode === "manual" ? filter.hands.hands : [],
    alternateSeats: filter.alternate_seats,
    trainer: drill.trainer,
  };
}

/** The non-empty entries of a list typed with commas or spaces. */
export function listOf(text: string): string[] {
  return text.split(LIST_SEPARATOR).filter((entry) => entry !== "");
}

interface Parsed<T> {
  readonly value: T;
  readonly errors: readonly FieldError[];
}

function parseDepths(text: string): Parsed<number[]> {
  const entries = listOf(text);
  const values = entries.map(Number);
  const bad = entries.filter((_, index) => !Number.isInteger(values[index]));
  const errors = bad.length === 0
    ? []
    : [{ path: "spot_filter.game_config.depths_bb", message: `${bad.join(", ")} is not a whole number of big blinds.` }];
  return { value: values, errors };
}

function parseSize(text: string, path: string): Parsed<number | undefined> {
  const trimmed = text.trim();
  if (trimmed === "") return { value: undefined, errors: [] };
  const value = Number(trimmed);
  return Number.isFinite(value) ? { value, errors: [] } : { value: undefined, errors: [{ path, message: `${trimmed} is not a number of big blinds.` }] };
}

function sizingOf(draft: DrillDraft): Parsed<Sizing> {
  if (draft.sizingMode === "convention") return { value: { mode: "convention" }, errors: [] };
  const open = parseSize(draft.openBbText, "spot_filter.sizing.open_bb");
  const threeBet = parseSize(draft.threeBetBbText, "spot_filter.sizing.three_bet_bb");
  const sizing: Sizing = {
    mode: "fixed",
    ...(open.value === undefined ? {} : { open_bb: open.value }),
    ...(threeBet.value === undefined ? {} : { three_bet_bb: threeBet.value }),
  };
  return { value: sizing, errors: [...open.errors, ...threeBet.errors] };
}

function boardOf(board: BoardDraft): BoardFilter | undefined {
  const flops = listOf(board.flopsText);
  const filter: BoardFilter = {
    ...(board.highCard === "" ? {} : { high_card: board.highCard }),
    ...(board.paired === "" ? {} : { paired: board.paired === "yes" }),
    ...(board.suits === "" ? {} : { suits: board.suits }),
    ...(board.connectivity === "" ? {} : { connectivity: board.connectivity }),
    ...(flops.length === 0 ? {} : { flops }),
  };
  return Object.keys(filter).length === 0 ? undefined : filter;
}

function handsOf(draft: DrillDraft): HandsFilter {
  if (draft.handsMode === "manual") return { mode: "manual", hands: [...draft.manualHands] };
  return { mode: draft.handsMode };
}

function spotFilterOf(draft: DrillDraft, depths: number[], sizing: Sizing): SpotFilter {
  const line = draft.lineText.trim();
  const board = boardOf(draft.board);
  return {
    game_config: { format: draft.format, table_size: draft.tableSize, depths_bb: depths },
    stake: draft.stake,
    sizing,
    start_street: draft.startStreet,
    hero_positions: [...draft.heroPositions],
    villain_positions: [...draft.villainPositions],
    preflop_action: [...draft.preflopAction],
    ...(line === "" ? {} : { line }),
    ...(board === undefined ? {} : { board }),
    hands: handsOf(draft),
    alternate_seats: draft.alternateSeats,
  };
}

/** The DrillCreate body of a draft, or every error by field path. */
export function draftToCreate(draft: DrillDraft): DraftResult<DrillCreate> {
  const depths = parseDepths(draft.depthsText);
  const sizing = sizingOf(draft);
  const body: DrillCreate = {
    name: draft.name.trim(),
    tags: listOf(draft.tagsText),
    spot_filter: spotFilterOf(draft, depths.value, sizing.value),
    trainer: draft.trainer,
  };
  const parseErrors = [...depths.errors, ...sizing.errors];
  // A depth list that did not parse is reported once, not again by the range rules.
  const ruleErrors = checkDrillBody(depths.errors.length === 0 ? body : withoutDepthRules(body));
  const errors = [...ruleErrors, ...parseErrors].sort(byTopField);
  return errors.length === 0 ? { ok: true, body } : { ok: false, errors };
}

function withoutDepthRules(body: DrillCreate): DrillCreate {
  return { ...body, spot_filter: { ...body.spot_filter, game_config: { ...body.spot_filter.game_config, depths_bb: [1] } } };
}

const TOP_ORDER = ["name", "tags", "spot_filter", "trainer"];

function topOrder(path: string): number {
  const index = TOP_ORDER.indexOf(path.split(".")[0] ?? "");
  return index === -1 ? TOP_ORDER.length : index;
}

/** Orders errors by top-level field only; the sort is stable, so rule order holds within one. */
function byTopField(left: FieldError, right: FieldError): number {
  return topOrder(left.path) - topOrder(right.path);
}

/** Key-order-independent JSON, so a stored value and a draft's value compare by content. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The DrillPatch body: only the top-level fields that differ from the stored drill. */
export function draftToPatch(draft: DrillDraft, drill: Drill): DraftResult<DrillPatch> {
  const result = draftToCreate(draft);
  if (!result.ok) return result;
  const { name, tags, spot_filter, trainer } = result.body;
  const patch: DrillPatch = {
    ...(name === drill.name ? {} : { name }),
    ...(stableJson(tags) === stableJson(drill.tags) ? {} : { tags }),
    ...(stableJson(spot_filter) === stableJson(drill.spot_filter) ? {} : { spot_filter }),
    ...(stableJson(trainer) === stableJson(drill.trainer) ? {} : { trainer }),
  };
  return { ok: true, body: patch };
}

/** A duplicate's name (O-311): "<name> (copy)", with the name cut so the whole fits the limit. */
export function copyName(name: string): string {
  const room = MAX_DRILL_NAME_LENGTH - COPY_SUFFIX.length;
  return `${name.trim().slice(0, room).trimEnd()}${COPY_SUFFIX}`;
}
