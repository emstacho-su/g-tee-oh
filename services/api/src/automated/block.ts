/**
 * The review block's progress (R4.10, O-272): pure steps over an automated session's learning
 * state, applied by the automated hook part after each decision.
 *
 * - recordDecision: the block's served count goes up by one. The label never changes the queue:
 *   the confident-miss rule (O-215) was retired with the confidence tap and R3.11 (O-345).
 * - isBlockComplete: the block has served its size.
 * - isPickPending, pendingPickOf: a stored block that is complete waits for its next pick (HIGH 3).
 * - withBlock: the learning state with the next block, its queue state and the pick counter.
 */
import { learningOf, type AutomatedLearning, type PersistedState } from "../sessions/state.js";
import type { BlockPick } from "./queue.js";

/** The block after one more decision: its served count up by one, nothing else changed. */
export function recordDecision(learning: AutomatedLearning): AutomatedLearning {
  return { ...learning, block: { ...learning.block, served: learning.block.served + 1 } };
}

export function isBlockComplete(learning: AutomatedLearning): boolean {
  return learning.block.served >= learning.block.size;
}

/**
 * A persisted block that has served its size is closed and waits for its next pick: the decision
 * that closed it found no catalog (PR #27 review HIGH 3). A picked block always starts at served 0,
 * so a stored complete block is never one that still needs closing.
 */
export function isPickPending(learning: AutomatedLearning): boolean {
  return isBlockComplete(learning);
}

/** The automated learning state of a stored session whose pick is pending, else null. */
export function pendingPickOf(session: { state: Pick<PersistedState, "learning"> }): AutomatedLearning | null {
  const learning = learningOf(session.state);
  return learning?.kind === "automated" && isPickPending(learning) ? learning : null;
}

export function withBlock(learning: AutomatedLearning, pick: BlockPick): AutomatedLearning {
  return { ...learning, block: pick.block, queue: pick.queue, pick_no: pick.pickNo };
}
