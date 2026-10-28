/**
 * Deriving a prediction prompt from the session (R3.16, O-301, O-302, ADR 0004, ADR 0018).
 *
 * Mechanism: prompt n of a session (n is state.practice.counter, the answers so far) is a pure
 * function of the session seed, n, the stored hero spots, the library and the user's answers:
 * 1. the PROMPT_DRAWS draws starting at draw n x PROMPT_DRAWS of a SplitMix64 stream seeded with
 *    the session seed (learning's generator, as sessions/randomness.ts uses it): the spot pick,
 *    the hand pick and the threshold pick;
 * 2. the picked spot is resolved to its solution and node with POST /v1/deal at the spot's line
 *    (the deal's solution and start node do not depend on the seed, O-152) and the node is read
 *    with every hand row (GET /v1/nodes, HandRow.mixed included);
 * 3. the ladder alternates by n (even: range, odd: hand) unless that ladder has no question at the
 *    node, then the other; the level is learning's levelFor over the user's answers for the node's
 *    spot class ("unclassified" when solver-query gives none, as grading stores it) and ladder;
 * 4. the prompt id is sha256 of the session id and n, formatted as a version 8 UUID, so a repeat
 *    GET answers the same id and an answer to an older prompt is told apart.
 * Nothing is written and nothing is solved: every read is of the library (ADR 0018).
 */
import { createHash } from "node:crypto";

import { createSplitMix64, levelFor, type PredictionAnswerRecord } from "@g-tee-oh/learning";

import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { UNCLASSIFIED_SPOT_CLASS } from "../grading/decide.js";
import type { SqNode } from "../solver-query/client.js";
import { dealFilterOf } from "../sessions/deal-hand.js";
import { upstreamInconsistent } from "../sessions/problems.js";
import { fromHex64, pickIndex } from "../sessions/randomness.js";
import type { SessionRow } from "../sessions/repository.js";
import type { SolverPort } from "../sessions/solver-port.js";
import { SPOT_SEARCH_SEED } from "../sessions/spot-search.js";
import type { HeroSpot, PracticeState } from "../sessions/state.js";
import { handQuestion } from "./hand-questions.js";
import type { PredictionLadder, PredictionQuestion, QuestionInput } from "./question.js";
import { rangeQuestion } from "./range-questions.js";

/** Draws each prompt takes from the session stream: spot, hand, threshold. */
export const PROMPT_DRAWS = 3;
const LADDER_PERIOD = 2;
const UUID_BYTES = 16;
const VERSION_BYTE = 6;
const VARIANT_BYTE = 8;
const LOW_NIBBLE = 0x0f;
const VERSION_8 = 0x80;
const VARIANT_MASK = 0x3f;
const VARIANT_RFC = 0x80;
const UUID_GROUPS = [8, 4, 4, 4, 12] as const;

export interface PromptDraws {
  spot: bigint;
  hand: bigint;
  threshold: bigint;
}

export interface DerivedPrediction {
  promptId: string;
  counter: number;
  spot: HeroSpot;
  node: SqNode;
  spotClassKey: string;
  question: PredictionQuestion;
}

/** Reads the user's answers for one spot class, oldest first. */
export type HistoryReader = (spotClassKey: string) => Promise<PredictionAnswerRecord[]>;

/** The prompt id of answer `counter` of a session: sha256 as a version 8 UUID. */
export function promptIdOf(sessionId: string, counter: number): string {
  const bytes = createHash("sha256").update(`${sessionId}:${counter}`).digest().subarray(0, UUID_BYTES);
  const hex = Buffer.from(
    bytes.map((byte, index) => {
      if (index === VERSION_BYTE) {
        return (byte & LOW_NIBBLE) | VERSION_8;
      }
      return index === VARIANT_BYTE ? (byte & VARIANT_MASK) | VARIANT_RFC : byte;
    }),
  ).toString("hex");
  let offset = 0;
  return UUID_GROUPS.map((length) => {
    const group = hex.slice(offset, offset + length);
    offset += length;
    return group;
  }).join("-");
}

/** The draws of prompt `counter` of the session seeded with `seed`. */
export function promptDraws(seed: string, counter: number): PromptDraws {
  if (!Number.isInteger(counter) || counter < 0) {
    throw new RangeError(`prompt counter ${counter} must be a non-negative integer`);
  }
  const generator = createSplitMix64(fromHex64(seed));
  for (let skipped = 0; skipped < counter * PROMPT_DRAWS; skipped += 1) {
    generator.nextU64();
  }
  return { spot: generator.nextU64(), hand: generator.nextU64(), threshold: generator.nextU64() };
}

/** The practice state of a prediction session; a 500 when the row lacks it. */
export function practiceOf(session: SessionRow): PracticeState {
  const practice = session.state.practice;
  if (practice?.kind !== "prediction") {
    throw new ProblemError(HTTP_STATUS.internal, PROBLEM_SLUGS.internal, { detail: "The prediction session has no prediction state." });
  }
  return practice;
}

async function resolveNode(spot: HeroSpot, port: SolverPort): Promise<SqNode> {
  const deal = await port.deal(dealFilterOf(spot), SPOT_SEARCH_SEED);
  const solutionId = deal.solution_ids[0];
  if (solutionId === undefined) {
    throw upstreamInconsistent("solver-query dealt a spot with no solution.");
  }
  const node = await port.node(solutionId, deal.start_node_key);
  if (node.to_act !== spot.hero_seat) {
    throw upstreamInconsistent("solver-query answered the spot's node with another seat to act.");
  }
  return node;
}

function questionFor(ladder: PredictionLadder, input: QuestionInput): PredictionQuestion | undefined {
  return ladder === "range" ? rangeQuestion(input) : handQuestion(input);
}

/** The ladders in the order prompt `counter` tries them. */
export function laddersFor(counter: number): readonly PredictionLadder[] {
  return counter % LADDER_PERIOD === 0 ? ["range", "hand"] : ["hand", "range"];
}

/** The prompt the session answers next (see the module doc). */
export async function derivePrediction(session: SessionRow, port: SolverPort, readHistory: HistoryReader): Promise<DerivedPrediction> {
  const { counter } = practiceOf(session);
  const draws = promptDraws(session.state.seed, counter);
  const spot = session.state.spots[pickIndex(draws.spot, session.state.spots.length)];
  if (spot === undefined) {
    throw upstreamInconsistent("The session holds no spot to ask about.");
  }
  const node = await resolveNode(spot, port);
  const spotClassKey = node.spot_class_key ?? UNCLASSIFIED_SPOT_CLASS;
  const history = await readHistory(spotClassKey);
  for (const ladder of laddersFor(counter)) {
    const level = levelFor(history, { spotClassKey, ladder }).level;
    const question = questionFor(ladder, { node, level, draws: { hand: draws.hand, threshold: draws.threshold } });
    if (question !== undefined) {
      return { promptId: promptIdOf(session.id, counter), counter, spot, node, spotClassKey, question };
    }
  }
  throw upstreamInconsistent("The spot's node offers no prediction question.");
}
