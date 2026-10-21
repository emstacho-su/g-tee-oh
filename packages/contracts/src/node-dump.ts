/**
 * Node dump invariants (R0.7; criterion 2 of the Phase 2 gate, R1.5 and R2.8).
 *
 * The JSON (JavaScript Object Notation) Schema in schemas/node-dump.schema.json fixes the shape of a
 * dump. The rules a schema cannot express live here as one pure function, checkNodeDumpInvariants:
 * it is the executable specification that tools/library-pack reimplements in Rust (S14) and the
 * preflight the exporter runs before it writes a dump. The dump stays generic (O-26): nodes, action
 * tokens, per-hand action frequencies and one expected value (EV) per action, with the game
 * configuration metadata, all in this project's vocabulary.
 *
 * Rules, per node and per hand:
 *   1. one frequency and one EV per action: frequencies.length === actions.length === ev_bb.length;
 *   2. the frequencies of a hand sum to 1 within FREQUENCY_SUM_TOLERANCE;
 *   3. hand labels match hand_space in gto-model's canonical spelling, so that one hand has one
 *      label: a preflop_169 label is the higher rank first plus s or o for a non-pair and nothing
 *      for a pair (HandClass Display: AKs and AA, never KAs or AAs); a postflop_1326 label is two
 *      distinct cards with the higher rank first and, for two cards of one rank, the lower suit
 *      first in the order cdhs (ComboId Display: AsKc and AcAd, never KcAs or AdAc);
 *   4. no action token twice in a node and no hand twice in a node; rule 3 is what lets this rule
 *      compare labels as text, since a second spelling of the same hand is already a violation;
 *   5. metadata completeness: every field the schema requires, including the six game
 *      configuration fields and the eight fields of a node, is present (config_id stays optional,
 *      the configuration is enough).
 *
 * Every violation comes back as one plain sentence naming the node key and the hand. A malformed
 * shape is reported the same way: the function never throws and never mutates its input. Every
 * rule is reported, never only the first: a missing field skips just the checks that read it.
 */

/** How far from 1 the frequencies of one hand may sum (criterion 2). */
export const FREQUENCY_SUM_TOLERANCE = 0.001;

export type SolutionSource = "own" | "reference";
export type TableFormat = "online" | "live";
export type Street = "preflop" | "flop" | "turn" | "river";
export type HandSpace = "preflop_169" | "postflop_1326";

/** The game configuration a dump was exported for, with the stake as a label (A4 game_config). */
export interface DumpGameConfig {
  readonly format: TableFormat;
  readonly table_size: number;
  readonly stake_label: string;
  readonly depth_cbb: number;
  readonly straddle: boolean;
  readonly ante_cbb: number;
}

/** One available action at a node: its token and the total wager in centi-big-blinds (cbb). */
export interface DumpAction {
  readonly token: string;
  readonly size_cbb: number;
}

/** The strategy of one hand at a node: action frequencies and one EV in big blinds (bb) per action. */
export interface DumpHandStrategy {
  readonly hand: string;
  readonly reach?: readonly number[];
  readonly frequencies: readonly number[];
  readonly ev_bb: readonly number[];
}

/** One decision point of the tree with its actions and per-hand strategy. */
export interface DumpNode {
  readonly node_key: string;
  readonly street: Street;
  readonly board: string;
  readonly to_act: string;
  readonly pot_cbb: number;
  readonly stacks_cbb: readonly number[];
  readonly actions: readonly DumpAction[];
  readonly hands: readonly DumpHandStrategy[];
  readonly accuracy_pct_pot?: number;
}

/** A node dump as schemas/node-dump.schema.json describes it. */
export interface NodeDump {
  readonly schema_version: 1;
  readonly source: SolutionSource;
  readonly exported_at: string;
  readonly config: DumpGameConfig;
  readonly config_id?: string;
  readonly position_pair: string;
  readonly hand_space: HandSpace;
  readonly exploitability_pct_pot?: readonly number[];
  readonly nodes: readonly DumpNode[];
}

type JsonRecord = Readonly<Record<string, unknown>>;

const HAND_SPACES: readonly HandSpace[] = ["preflop_169", "postflop_1326"];
const REQUIRED_DUMP_FIELDS = ["schema_version", "source", "exported_at", "config", "position_pair", "hand_space", "nodes"] as const;
const REQUIRED_CONFIG_FIELDS = ["format", "table_size", "stake_label", "depth_cbb", "straddle", "ante_cbb"] as const;
/**
 * The node fields rule 5 requires besides node_key, actions and hands, which have shape checks
 * of their own.
 */
const REQUIRED_NODE_FIELDS = ["street", "board", "to_act", "pot_cbb", "stacks_cbb"] as const;
/** A 169-class label: two ranks and, for a non-pair, s (suited) or o (offsuit). */
const LABEL_169 = /^([2-9TJQKA])([2-9TJQKA])([so])?$/;
/** A 1326-combination label: two cards, rank then suit each. */
const LABEL_1326 = /^([2-9TJQKA][cdhs])([2-9TJQKA][cdhs])$/;
/** The ranks in ascending order, deuce lowest and ace highest (gto-model's Rank). */
const RANK_ORDER = "23456789TJQKA";
/** The suits in ascending order (gto-model's Suit, the order cdhs). */
const SUIT_ORDER = "cdhs";
/** Decimal places a reported frequency sum is rounded to, enough to show a 0.001 miss. */
const SUM_DECIMALS = 6;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberList(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function isHandSpace(value: unknown): value is HandSpace {
  return HAND_SPACES.some((space) => space === value);
}

/** The values that occur more than once, each listed once, in first-occurrence order. */
function duplicatesIn(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

function formatSum(sum: number): string {
  return Number(sum.toFixed(SUM_DECIMALS)).toString();
}

function rankIndex(rank: string): number {
  return RANK_ORDER.indexOf(rank);
}

function suitIndex(suit: string): number {
  return SUIT_ORDER.indexOf(suit);
}

/**
 * A preflop_169 label in gto-model's canonical spelling (HandClass Display): the higher rank
 * first, then s or o for a non-pair and no suffix for a pair.
 */
function isLabel169(label: string): boolean {
  const match = LABEL_169.exec(label);
  if (match === null) return false;
  const [, first = "", second = "", suffix] = match;
  if (first === second) return suffix === undefined;
  return suffix !== undefined && rankIndex(first) > rankIndex(second);
}

/**
 * A postflop_1326 label in gto-model's canonical spelling (ComboId Display): two distinct cards,
 * the higher rank first and, for two cards of one rank, the lower suit first in the order cdhs.
 */
function isLabel1326(label: string): boolean {
  const match = LABEL_1326.exec(label);
  if (match === null) return false;
  const [, first = "", second = ""] = match;
  const rankGap = rankIndex(first.charAt(0)) - rankIndex(second.charAt(0));
  if (rankGap !== 0) return rankGap > 0;
  return suitIndex(first.charAt(1)) < suitIndex(second.charAt(1));
}

function checkConfig(config: unknown): readonly string[] {
  if (config === undefined) return [];
  if (!isRecord(config)) return ["The dump's config is not a JSON object."];
  return REQUIRED_CONFIG_FIELDS.filter((field) => config[field] === undefined).map(
    (field) => `The dump's config is missing the game configuration field ${field}.`,
  );
}

/** Rule 5: the required metadata, the configuration fields and a known hand space. */
function checkMetadata(dump: JsonRecord): readonly string[] {
  const missing = REQUIRED_DUMP_FIELDS.filter((field) => dump[field] === undefined).map(
    (field) => `The dump is missing the required field ${field}.`,
  );
  const handSpace =
    dump.hand_space === undefined || isHandSpace(dump.hand_space)
      ? []
      : [`The dump's hand_space ${JSON.stringify(dump.hand_space)} is not preflop_169 or postflop_1326.`];
  const nodes = dump.nodes === undefined || Array.isArray(dump.nodes) ? [] : ["The dump's nodes field is not an array."];
  return [...missing, ...checkConfig(dump.config), ...handSpace, ...nodes];
}

/**
 * Rule 3: the label is written in the dump's hand space, in the canonical spelling; skipped when
 * the hand space itself is invalid.
 */
function checkLabel(who: string, label: string, handSpace: HandSpace | undefined): readonly string[] {
  if (handSpace === undefined) return [];
  if (handSpace === "preflop_169") {
    return isLabel169(label)
      ? []
      : [`${who} is not a preflop_169 label (higher rank first, plus s or o for a non-pair).`];
  }
  const reason = "two distinct cards, higher rank first, lower suit first for a pair";
  return isLabel1326(label) ? [] : [`${who} is not a postflop_1326 label (${reason}).`];
}

/** Rules 1 and 2 for the frequencies of one hand. */
function checkFrequencies(who: string, frequencies: unknown, actionCount: number | undefined): readonly string[] {
  if (!isNumberList(frequencies)) return [`${who} has no frequencies array of numbers.`];
  const count =
    actionCount === undefined || frequencies.length === actionCount
      ? []
      : [`${who} has ${frequencies.length} frequencies for ${actionCount} actions.`];
  const sum = frequencies.reduce((total, frequency) => total + frequency, 0);
  const total =
    Math.abs(sum - 1) <= FREQUENCY_SUM_TOLERANCE
      ? []
      : [`${who} has frequencies summing to ${formatSum(sum)}, not 1 within ${FREQUENCY_SUM_TOLERANCE}.`];
  return [...count, ...total];
}

/** Rule 1 for the expected values of one hand. */
function checkExpectedValues(who: string, evs: unknown, actionCount: number | undefined): readonly string[] {
  if (!isNumberList(evs)) return [`${who} has no ev_bb array of numbers.`];
  if (actionCount === undefined || evs.length === actionCount) return [];
  return [`${who} has ${evs.length} expected values for ${actionCount} actions.`];
}

function checkHand(name: string, hand: unknown, index: number, actionCount: number | undefined, handSpace: HandSpace | undefined): readonly string[] {
  if (!isRecord(hand)) return [`${name} hand at index ${index} is not a JSON object.`];
  const label = typeof hand.hand === "string" ? hand.hand : undefined;
  const who = label === undefined ? `${name} hand at index ${index}` : `${name} hand ${label}`;
  const labelViolations = label === undefined ? [`${who} has no hand label string.`] : checkLabel(who, label, handSpace);
  return [...labelViolations, ...checkFrequencies(who, hand.frequencies, actionCount), ...checkExpectedValues(who, hand.ev_bb, actionCount)];
}

/** Rule 4 for the hands of one node: the same label listed twice. */
function checkHandDuplicates(name: string, hands: readonly unknown[]): readonly string[] {
  const labels = hands.flatMap((hand) => (isRecord(hand) && typeof hand.hand === "string" ? [hand.hand] : []));
  return duplicatesIn(labels).map((label) => `${name} lists the hand ${label} more than once.`);
}

/** Rule 4 for the actions of one node, plus the shape of each action. */
function checkActions(name: string, actions: readonly unknown[]): readonly string[] {
  const tokens = actions.map((action) => (isRecord(action) && typeof action.token === "string" ? action.token : undefined));
  const shape = tokens.includes(undefined) ? [`${name} has an action without a token string.`] : [];
  const present = tokens.filter((token): token is string => token !== undefined);
  const repeated = duplicatesIn(present).map((token) => `${name} lists the action token ${token} more than once.`);
  return [...shape, ...repeated];
}

function checkNode(node: unknown, index: number, handSpace: HandSpace | undefined): readonly string[] {
  if (!isRecord(node)) return [`The node at index ${index} is not a JSON object.`];
  const name = typeof node.node_key === "string" ? `Node ${node.node_key}` : `The node at index ${index}`;
  const key = typeof node.node_key === "string" ? [] : [`${name} has no node_key string.`];
  const fields = REQUIRED_NODE_FIELDS.filter((field) => node[field] === undefined).map(
    (field) => `${name} has no ${field} field.`,
  );
  const actions = Array.isArray(node.actions) ? node.actions : undefined;
  const actionViolations = actions === undefined ? [`${name} has no actions array.`] : checkActions(name, actions);
  const metadata = [...key, ...fields, ...actionViolations];
  if (!Array.isArray(node.hands)) return [...metadata, `${name} has no hands array.`];
  const hands: readonly unknown[] = node.hands;
  const handViolations = hands.flatMap((hand, handIndex) => checkHand(name, hand, handIndex, actions?.length, handSpace));
  return [...metadata, ...handViolations, ...checkHandDuplicates(name, hands)];
}

/**
 * Every criterion 2 violation in a node dump as a plain sentence; an empty list means the dump
 * holds. The input is read, never changed, and a malformed input is reported, not thrown.
 */
export function checkNodeDumpInvariants(dump: unknown): readonly string[] {
  if (!isRecord(dump)) return ["The dump is not a JSON object."];
  const handSpace = isHandSpace(dump.hand_space) ? dump.hand_space : undefined;
  const nodes: readonly unknown[] = Array.isArray(dump.nodes) ? dump.nodes : [];
  return [...checkMetadata(dump), ...nodes.flatMap((node, index) => checkNode(node, index, handSpace))];
}
