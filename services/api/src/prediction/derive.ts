/**
 * Deriving a prediction prompt from the session (R3.16, O-301, O-302, ADR 0004, ADR 0018).
 *
 * Mechanism: prompt n of a session (n is state.practice.counter, the answers so far) is a pure
 * function of the session seed, n, the stored hero spots, the library and the user's answers:
 * 1. the PROMPT_DRAWS draws starting at draw n x PROMPT_DRAWS of a SplitMix64 stream seeded with
 *    the session seed (learning's generator, as sessions/randomness.ts uses it): the spot pick,
 *    the hand pick and the threshold pick;
 * 2. the picked spot is resolved to its solution and node by sessions/practice-node.ts (a deal at
 *    the spot's line, whose solution and start node do not depend on the seed, O-152, then the node
 *    read with every hand row, HandRow.mixed included, under the seat check range painting shares,
 *    PR #29 review L11);
 * 3. the ladder alternates by n (even: range, odd: hand) unless that ladder has no question at the
 *    node, then the other; the level is learning's levelFor over the user's answers for the node's
 *    spot class ("unclassified" when solver-query gives none, as grading stores it) and ladder. A
 *    quiz (S41, O-410, O-411) instead asks its difficulty's level, reads no history, and tries its
 *    own ladders first (quizLaddersFor);
 * 4. the prompt id is sha256 of the session id, n and the shown question's ladder and level,
 *    formatted as a version 8 UUID, so a repeat GET answers the same id and an answer to an older
 *    prompt is told apart.
 * The id freezes the question as shown (PR #29 review M6): POST does not read the level again,
 * because another session of the user may have unlocked a level since the GET. It rebuilds the
 * question at each ladder and level the counter allows and keeps the one whose id the body names,
 * so the answer is judged against the prompt the user saw; no match is a stale prompt (409). The
 * question at a given node, draws, ladder and level is always the same one, so the rebuild is
 * exact. Nothing is written and nothing is solved: every read is of the library (ADR 0018).
 */
import { createHash } from "node:crypto";

import { createSplitMix64, levelFor, MAX_PREDICTION_LEVEL, type PredictionAnswerRecord } from "@g-tee-oh/learning";

import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { UNCLASSIFIED_SPOT_CLASS } from "../grading/decide.js";
import type { SqNode } from "../solver-query/client.js";
import { resolvePracticeNode } from "../sessions/practice-node.js";
import { upstreamInconsistent } from "../sessions/problems.js";
import { fromHex64, pickIndex } from "../sessions/randomness.js";
import type { SessionRow } from "../sessions/repository.js";
import type { SolverPort } from "../sessions/solver-port.js";
import { SPOT_SEARCH_SEED } from "../sessions/spot-search.js";
import type { HeroSpot, PracticeState, QuizState } from "../sessions/state.js";
import { handQuestion } from "./hand-questions.js";
import type { PredictionLadder, PredictionQuestion, QuestionDraws, QuestionInput } from "./question.js";
import { rangeQuestion } from "./range-questions.js";

/** Draws each prompt takes from the session stream: spot, hand, threshold. */
export const PROMPT_DRAWS = 3;
const LADDER_PERIOD = 2;
const FIRST_LEVEL = 1;
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

/** The ladder and level a prompt was shown at: part of its identity (PR #29 review M6). */
export interface ShownLevel {
  ladder: PredictionLadder;
  level: number;
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

/** What prompt `counter` asks about, before a ladder and level are chosen. */
interface PromptContext {
  sessionId: string;
  counter: number;
  spot: HeroSpot;
  node: SqNode;
  spotClassKey: string;
  draws: QuestionDraws;
}

/** The prompt id of answer `counter` of a session shown at `shown`: sha256 as a version 8 UUID. */
export function promptIdOf(sessionId: string, counter: number, shown: ShownLevel): string {
  const bytes = createHash("sha256")
    .update(`${sessionId}:${counter}:${shown.ladder}:${shown.level}`)
    .digest()
    .subarray(0, UUID_BYTES);
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

function questionFor(ladder: PredictionLadder, input: QuestionInput): PredictionQuestion | undefined {
  return ladder === "range" ? rangeQuestion(input) : handQuestion(input);
}

/** The ladders in the order prompt `counter` tries them. */
export function laddersFor(counter: number): readonly PredictionLadder[] {
  return counter % LADDER_PERIOD === 0 ? ["range", "hand"] : ["hand", "range"];
}

async function promptContext(session: SessionRow, port: SolverPort): Promise<PromptContext> {
  const { counter } = practiceOf(session);
  const draws = promptDraws(session.state.seed, counter);
  const spot = session.state.spots[pickIndex(draws.spot, session.state.spots.length)];
  if (spot === undefined) {
    throw upstreamInconsistent("The session holds no spot to ask about.");
  }
  const { node } = await resolvePracticeNode(spot, SPOT_SEARCH_SEED, port);
  const spotClassKey = node.spot_class_key ?? UNCLASSIFIED_SPOT_CLASS;
  return { sessionId: session.id, counter, spot, node, spotClassKey, draws: { hand: draws.hand, threshold: draws.threshold } };
}

/** The prompt of `context` at one ladder and level, its id that of the question as it is shown. */
function promptAt(context: PromptContext, ladder: PredictionLadder, level: number): DerivedPrediction | undefined {
  const question = questionFor(ladder, { node: context.node, level, draws: context.draws });
  if (question === undefined) {
    return undefined;
  }
  const { sessionId, counter, spot, node, spotClassKey } = context;
  return { promptId: promptIdOf(sessionId, counter, question), counter, spot, node, spotClassKey, question };
}

/**
 * S41 (O-411): the ladders a quiz prompt tries, in order: the quiz's own ladders in laddersFor's
 * order, then the others, so a node with no question on the chosen ladder still answers a prompt.
 */
export function quizLaddersFor(counter: number, quiz: QuizState): readonly PredictionLadder[] {
  const order = laddersFor(counter);
  return [...order.filter((ladder) => quiz.ladders.includes(ladder)), ...order.filter((ladder) => !quiz.ladders.includes(ladder))];
}

/** A quiz's prompt: its difficulty's level on its ladders, no history read (S41, O-410, O-411). */
function quizPrompt(context: PromptContext, quiz: QuizState): DerivedPrediction {
  for (const ladder of quizLaddersFor(context.counter, quiz)) {
    const prompt = promptAt(context, ladder, quiz.level);
    if (prompt !== undefined) {
      return prompt;
    }
  }
  throw upstreamInconsistent("The spot's node offers no prediction question.");
}

/** The prompt the session answers next (see the module doc); a quiz asks its own level (S41). */
export async function derivePrediction(session: SessionRow, port: SolverPort, readHistory: HistoryReader): Promise<DerivedPrediction> {
  const context = await promptContext(session, port);
  const { quiz } = practiceOf(session);
  if (quiz !== undefined) {
    return quizPrompt(context, quiz);
  }
  const history = await readHistory(context.spotClassKey);
  for (const ladder of laddersFor(context.counter)) {
    const level = levelFor(history, { spotClassKey: context.spotClassKey, ladder }).level;
    const prompt = promptAt(context, ladder, level);
    if (prompt !== undefined) {
      return prompt;
    }
  }
  throw upstreamInconsistent("The spot's node offers no prediction question.");
}

/**
 * The prompt of the session's current counter whose id is `promptId`, rebuilt at the ladder and
 * level it was shown at (PR #29 review M6); undefined when no question of this counter has that
 * id, which the caller answers as a stale prompt.
 */
export async function deriveShownPrediction(session: SessionRow, port: SolverPort, promptId: string): Promise<DerivedPrediction | undefined> {
  const context = await promptContext(session, port);
  for (const ladder of laddersFor(context.counter)) {
    for (let level = FIRST_LEVEL; level <= MAX_PREDICTION_LEVEL; level += 1) {
      const prompt = promptAt(context, ladder, level);
      if (prompt?.promptId === promptId) {
        return prompt;
      }
    }
  }
  return undefined;
}
