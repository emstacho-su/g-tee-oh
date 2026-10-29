/**
 * The session's progress strip above the table (S26, S46, R3.13, R3.14, R3.31, O-312, O-313). From
 * the session context: the covered-part note when POST /sessions queued part of the drill (every
 * mode), and the hand counter: in street and full-hand modes the hand and decision counter, and in
 * every mode "Hand 7 of 20" once a session length is planned (S46). Spot mode without a length
 * shows no counter, as in S26.
 *
 * S40 (O-352): how the last hand ended is no longer shown; the api logs each finished hand under the
 * user's account (hand_record) instead.
 */
import { sessionLengthOf } from "../../trainer/session-length.js";
import type { SessionContext } from "../../trainer/spot-machine.js";
import { CoverageNote } from "./CoverageNote.js";
import { HandCounter } from "./HandCounter.js";

export interface RunProgressProps {
  context: SessionContext;
}

export function RunProgress({ context }: RunProgressProps) {
  const spotMode = (context.trainer?.stop_rule ?? "after_action") === "after_action";
  const length = sessionLengthOf(context);
  const hand = context.hand;
  const shown = hand !== undefined && (!spotMode || length !== null);
  return (
    <>
      <CoverageNote coverage={context.session.coverage} />
      {shown ? <HandCounter progress={hand} length={length} decision={!spotMode} /> : null}
    </>
  );
}
