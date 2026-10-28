/**
 * How a hand ended, named at the transition that ends it (R3.13, O-313, PR #30 review MEDIUM 5).
 * The derivation (derive.ts) calls handEndAt when the machine (machine.ts) moves into hand_end,
 * with the phase it leaves, so previous_hand.end records the edge actually taken instead of
 * being guessed afterwards from the board.
 *
 * The edges into hand_end and what each records:
 * - any edge with the hand folded or off the solution's range: "fold" or "off_range", because
 *   the hand would have ended there under any stop rule;
 * - feedback to hand_end under after_action (spot mode): "stop_rule", even when the hero's
 *   action also closed the street, since in street or full-hand mode the hand would go on;
 * - street_end to hand_end: "street_closed" (street mode, or no later street);
 * - reveal to hand_end: "street_closed" with the revealed board. In v1 a full hand ends once the
 *   flop is shown, because the library holds no postflop node (05 section 2). The decision: no
 *   separate enum value for this edge. The street did close, and previous_hand.board carries the
 *   flop, so a client tells the two apart by the board; the contract's enum stays as S26 shipped it.
 * Any other phase never reaches hand_end; asking for it is a 500.
 */
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import type { previousHandEndSchema } from "../schemas/training.js";
import type { Phase, StopRule } from "./machine.js";
import type { HandState } from "./state.js";
import type { z } from "zod";

export type PreviousHandEnd = z.infer<typeof previousHandEndSchema>;

/** How the hand ended, given the phase the machine leaves for hand_end. */
export function handEndAt(from: Phase, stopRule: StopRule, hand: Pick<HandState, "end">): PreviousHandEnd {
  if (hand.end === "fold" || hand.end === "off_range") {
    return hand.end;
  }
  if (from === "feedback" && stopRule === "after_action") {
    return "stop_rule";
  }
  if (from === "street_end" || from === "reveal") {
    return "street_closed";
  }
  throw new ProblemError(HTTP_STATUS.internal, PROBLEM_SLUGS.internal, {
    detail: `The hand reached its end from phase ${from} with no recorded reason.`,
  });
}
