/**
 * The grounding of an explanation (R3.19, R3.20, A6 section 5, 05 section 10, ADR 0004, ADR 0016,
 * O-306, O-308, O-309): one frozen object built from the attempt row, the node's row for the
 * attempt's hand (GET /v1/nodes) and the hand's insights (GET /v1/insights). It holds only numbers
 * and names solver-query gave, copied and never computed, so the More info templates and the Ask
 * prompt read the same facts and the validator can check an answer against them.
 *
 * Beside the object, the bundle carries:
 * - names: every hand class, combo and card the grounding mentions (a class's two ranks without
 *   the suit letter count too, so "A5" passes when A5s or A5o is present); the validator rejects
 *   any other hand or card name;
 * - labels: the action labels and seat names, which the validator removes before reading numbers
 *   so the 10 of "Raise to 10bb" is a name, not a claim;
 * - numbers: every numeric leaf, the values a shown number may round from;
 * - canonical: the JSON text with keys sorted at every depth, which the cache key hashes (PM1).
 *
 * loadGrounding does the reads: the attempt by id and the session user's id (another user's
 * attempt is a 404, ADR 0001), then the two solver-query reads through the request's port.
 */
import type { FastifyRequest } from "fastify";

import type { Database } from "../db.js";
import { canonicalJson } from "../http/canonical-json.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { solverPort } from "../sessions/solver-port.js";
import { expectData, upstreamHeaders, type SolverQuery, type SqInsights, type SqNode } from "../solver-query/client.js";

/** The attempt columns the grounding reads. */
export interface AttemptGroundingRow {
  id: string;
  solution_id: string;
  node_key: string;
  hand: string;
  action_index: number;
  ev_loss_bb: number;
  ev_loss_pct_pot: number;
  best_action_indexes: number[] | null;
  noise_flags: string[];
}

export interface GroundingSources {
  attempt: AttemptGroundingRow;
  node: SqNode;
  insights: SqInsights;
}

export interface GroundingAction {
  label: string;
  kind: string;
  size_cbb: number;
}

export interface GroundingThreshold {
  actions: { label: string; share_taking: number; weakest_hand_taking_half: string | null }[];
  strongest_folding_hand: string | null;
  equity_vs_villain: number;
  rank_in_range: number;
  relative: { label: string; position: string }[];
}

export interface Grounding {
  hand: string;
  hand_class: string;
  street: string;
  position: string;
  opponent: string;
  out_of_position_seat: string;
  in_position_seat: string;
  actions: GroundingAction[];
  hand_strategy: { label: string; frequency: number; ev_bb: number }[];
  best_actions: string[];
  chosen: { label: string; ev_loss_bb: number; ev_loss_pct_pot: number };
  range_shares: { label: string; share: number }[];
  threshold: GroundingThreshold | null;
  equity_distribution: NonNullable<SqInsights["equity_distribution"]> | null;
  range_advantage: NonNullable<SqInsights["range_advantage"]> | null;
  nut_advantage: NonNullable<SqInsights["nut_advantage"]> | null;
  blockers: { villain_combos_removed: number; villain_reach_removed_share: number; top_blocked: string[] };
  hand_role: string | null;
  noise_flags: string[];
}

export interface GroundingBundle {
  grounding: Readonly<Grounding>;
  names: ReadonlySet<string>;
  labels: readonly string[];
  numbers: readonly number[];
  canonical: string;
}

const PAIR_SEPARATOR = "-";
const CARD_LENGTH = 2;
const COMBO_LENGTH = 4;
const CLASS_RANKS_LENGTH = 2;
const UNKNOWN_LABEL = "an unknown action";

function labelOf(node: SqNode, index: number): string {
  return node.actions.find((action) => action.index === index)?.label ?? UNKNOWN_LABEL;
}

function seatsOf(node: SqNode): { oop: string; ip: string; opponent: string } {
  const [oop = "", ip = ""] = node.pair.split(PAIR_SEPARATOR);
  return { oop, ip, opponent: node.to_act === oop ? ip : oop };
}

function handRowOf(node: SqNode): SqNode["hands"][number] {
  const row = node.hands[0];
  if (row === undefined) {
    throw new RangeError("the node has no row for the attempt's hand");
  }
  return row;
}

function bestActions(sources: GroundingSources, row: SqNode["hands"][number]): string[] {
  const stored = sources.attempt.best_action_indexes;
  const indexes = stored ?? row.loss_pct_pot.flatMap((loss, index) => (loss === 0 ? [index] : []));
  return indexes.map((index) => labelOf(sources.node, index));
}

function thresholdOf(node: SqNode, insights: SqInsights): GroundingThreshold | null {
  const card = insights.threshold_card;
  if (card === null || card === undefined) {
    return null;
  }
  return {
    actions: card.actions.map((action) => ({
      label: labelOf(node, action.index),
      share_taking: action.share_taking,
      weakest_hand_taking_half: action.weakest_hand_taking_half ?? null,
    })),
    strongest_folding_hand: card.strongest_folding_hand ?? null,
    equity_vs_villain: card.hand_position.equity_vs_villain,
    rank_in_range: card.hand_position.rank_in_range,
    relative: card.hand_position.relative.map((entry) => ({ label: labelOf(node, entry.index), position: entry.position })),
  };
}

function groundingOf(sources: GroundingSources): Grounding {
  const { attempt, node, insights } = sources;
  const row = handRowOf(node);
  const seats = seatsOf(node);
  return {
    hand: attempt.hand,
    hand_class: row.hand,
    street: node.street,
    position: node.to_act,
    opponent: seats.opponent,
    out_of_position_seat: seats.oop,
    in_position_seat: seats.ip,
    actions: node.actions.map((action) => ({ label: action.label, kind: action.kind, size_cbb: action.size_cbb })),
    hand_strategy: node.actions.map((action, position) => ({
      label: action.label,
      frequency: row.strategy[position] ?? 0,
      ev_bb: row.ev_bb[position] ?? 0,
    })),
    best_actions: bestActions(sources, row),
    chosen: { label: labelOf(node, attempt.action_index), ev_loss_bb: attempt.ev_loss_bb, ev_loss_pct_pot: attempt.ev_loss_pct_pot },
    range_shares: node.range_summary.by_action.map((entry) => ({ label: labelOf(node, entry.index), share: entry.share })),
    threshold: thresholdOf(node, insights),
    equity_distribution: insights.equity_distribution ?? null,
    range_advantage: insights.range_advantage ?? null,
    nut_advantage: insights.nut_advantage ?? null,
    blockers: {
      villain_combos_removed: insights.blockers.villain_combos_removed,
      villain_reach_removed_share: insights.blockers.villain_reach_removed_share,
      top_blocked: insights.blockers.top_blocked.map((entry) => entry.hand),
    },
    hand_role: insights.hand_role ?? null,
    noise_flags: [...insights.noise_flags],
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** A hand name with the names it implies: a combo's two cards, a class's ranks without suit letter. */
function impliedNames(name: string): string[] {
  if (name.length === COMBO_LENGTH) {
    return [name, name.slice(0, CARD_LENGTH), name.slice(CARD_LENGTH)];
  }
  const ranks = name.slice(0, CLASS_RANKS_LENGTH);
  return ranks === name ? [name] : [name, ranks];
}

function handNamesOf(grounding: Grounding): Set<string> {
  const threshold = grounding.threshold;
  const listed = [
    grounding.hand,
    grounding.hand_class,
    ...grounding.blockers.top_blocked,
    ...(threshold === null ? [] : [threshold.strongest_folding_hand, ...threshold.actions.map((a) => a.weakest_hand_taking_half)]),
  ].filter((name): name is string => name !== null);
  return new Set(listed.flatMap(impliedNames));
}

function numbersOf(value: unknown): number[] {
  if (typeof value === "number") {
    return [value];
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(numbersOf);
  }
  return [];
}

/** The grounding, its name and number sets and its canonical text (pure; R3.19, O-308). */
export function buildGrounding(sources: GroundingSources): GroundingBundle {
  const grounding = deepFreeze(groundingOf(sources));
  const seats = [grounding.position, grounding.opponent, grounding.out_of_position_seat, grounding.in_position_seat];
  return {
    grounding,
    names: handNamesOf(grounding),
    labels: [...new Set([...grounding.actions.map((action) => action.label), ...seats])],
    numbers: numbersOf(grounding),
    canonical: canonicalJson(grounding),
  };
}

function attemptNotFound(): ProblemError {
  return new ProblemError(HTTP_STATUS.notFound, PROBLEM_SLUGS.notFound, { detail: "No attempt with this id." });
}

/** The session user's attempt, or a 404 problem when it is absent or another user's (ADR 0001). */
export async function findOwnedAttempt(database: Database, userId: string, attemptId: string): Promise<AttemptGroundingRow> {
  const row = await database
    .selectFrom("attempt")
    .select(["id", "solution_id", "node_key", "hand", "action_index", "ev_loss_bb", "ev_loss_pct_pot", "best_action_indexes", "noise_flags"])
    .where("id", "=", attemptId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (row === undefined) {
    throw attemptNotFound();
  }
  return row;
}

/** Reads the node row and insights for an attempt and builds its grounding. */
export async function loadGrounding(client: SolverQuery, request: FastifyRequest, attempt: AttemptGroundingRow): Promise<GroundingBundle> {
  const port = solverPort(client, request);
  const [node, insights] = await Promise.all([
    port.nodeForHand(attempt.solution_id, attempt.node_key, attempt.hand),
    expectData(
      client.GET("/v1/insights", {
        params: { query: { solution_id: attempt.solution_id, node_key: attempt.node_key, hand: attempt.hand } },
        headers: upstreamHeaders(request),
      }),
      "insights for this hand at this node",
    ),
  ]);
  if (node === undefined) {
    throw new ProblemError(HTTP_STATUS.badGateway, PROBLEM_SLUGS.upstream, {
      detail: "The library no longer holds this hand at this node.",
    });
  }
  return buildGrounding({ attempt, node, insights });
}
