/**
 * Queue selection (A6 section 1 row "Queue selection (due, leak priority, interleave rule)"; A6
 * section 3; 06 section 4). Owner: S30 (p4/learning), closing R4.9.
 *
 * Rules the module will implement: priority per spot class = leak cost x overdue factor; classes
 * never practiced start from the frequency prior (ADR 0013); the next class is drawn so that no
 * two consecutive picks share an action family (the interleave rule); the first exposure to a new
 * class is a worked example served with panels visible and unrated; a confident miss moves to the
 * front of the queue (hypercorrection, 05 section 5). The only randomness is the injected
 * RandomSource (A1 section 2), so a seed replays the same picks.
 *
 * Pending vectors: test/R4.9-queue.test.ts.
 */
import type { ModulePlaceholder } from "./types.js";

export const QUEUE_MODULE: ModulePlaceholder = Object.freeze({
  module: "queue",
  responsibility: "next spot class from due cards and leak priority under the interleave rule",
  session: "S30",
  requirements: ["R4.9"],
});
