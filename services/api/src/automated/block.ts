/**
 * The review block's progress (R4.10, O-272, O-215): pure steps over an automated session's
 * learning state, applied by the automated hook part after each decision.
 *
 * - recordDecision: the block's served count goes up by one; a confident miss (sure, and a label
 *   other than Best or Correct) enters the queue state's hypercorrection list through learning's
 *   recordAttempt, so the class returns at the first pick the interleave rule allows. A seeded
 *   session records no hypercorrection (PM seed condition).
 * - isBlockComplete: the block has served its size.
 * - withBlock: the learning state with the next block, its queue state and the pick counter.
 */
import { recordAttempt, type Confidence, type GradeLabel } from "@g-tee-oh/learning";

import type { AutomatedLearning } from "../sessions/state.js";
import { fromQueueState, toQueueState, type BlockPick } from "./queue.js";

export interface DecisionFacts {
  label: GradeLabel;
  /** The player's stated confidence; null when none was given. */
  confidence: Confidence | null;
}

export function recordDecision(learning: AutomatedLearning, decision: DecisionFacts): AutomatedLearning {
  const block = { ...learning.block, served: learning.block.served + 1 };
  if (learning.seeded || decision.confidence === null) {
    return { ...learning, block };
  }
  const queue = recordAttempt(toQueueState(learning.queue), learning.block.spot_class_key, {
    confidence: decision.confidence,
    label: decision.label,
  });
  return { ...learning, block, queue: fromQueueState(queue) };
}

export function isBlockComplete(learning: AutomatedLearning): boolean {
  return learning.block.served >= learning.block.size;
}

export function withBlock(learning: AutomatedLearning, pick: BlockPick): AutomatedLearning {
  return { ...learning, block: pick.block, queue: pick.queue, pick_no: pick.pickNo };
}
