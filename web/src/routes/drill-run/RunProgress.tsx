/**
 * The session's progress strip above the table (S26, R3.13, R3.14, O-312, O-313). From the session
 * context: the covered-part note when POST /sessions queued part of the drill (every mode), and in
 * street and full-hand modes the hand and decision counter. Spot mode shows no counter.
 *
 * S40 (O-352): how the last hand ended is no longer shown; the api logs each finished hand under the
 * user's account (hand_record) instead.
 */
import type { SessionContext } from "../../trainer/spot-machine.js";
import { CoverageNote } from "./CoverageNote.js";
import { HandCounter } from "./HandCounter.js";

export interface RunProgressProps {
  context: SessionContext;
}

export function RunProgress({ context }: RunProgressProps) {
  const stopRule = context.trainer?.stop_rule ?? "after_action";
  const hand = stopRule === "after_action" ? undefined : context.hand;
  return (
    <>
      <CoverageNote coverage={context.session.coverage} />
      {hand === undefined ? null : <HandCounter progress={hand} />}
    </>
  );
}
