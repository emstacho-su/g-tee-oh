/**
 * The session's progress strip above the table (S26, S46, R3.13, R3.14, R3.31, O-312, O-313). From
 * the session context: the covered-part note when POST /sessions queued part of the drill (every
 * mode), and the hand counter: in street and full-hand modes the hand and decision counter, and in
 * every mode "Hand 7 of 20" once a session length is planned (S46). Spot mode without a length
 * shows no counter, as in S26. SessionHandCounter holds that one rule; /train renders it too
 * (PR #45 review round 2, cleanup 9).
 *
 * S40 (O-352): how the last hand ended is no longer shown; the api logs each finished hand under the
 * user's account (hand_record) instead.
 */
import { oneDecisionPerHand, playedOrdinal, sessionLengthOf } from "../../trainer/session-length.js";
import type { SessionContext } from "../../trainer/spot-machine.js";
import { CoverageNote } from "./CoverageNote.js";
import { HandCounter } from "./HandCounter.js";

export interface RunProgressProps {
  context: SessionContext;
}

/**
 * The hand counter by the one rule: street modes always, one-decision modes only with a length.
 * Every counter, with or without a length, names the hand by the played hands (session-length.ts
 * playedOrdinal), the number the limit counts (PR #45 review rounds 3 and 4, findings 3, 5 and g).
 */
export function SessionHandCounter({ context }: RunProgressProps) {
  const oneDecision = oneDecisionPerHand(context);
  const length = sessionLengthOf(context);
  const hand = context.hand;
  if (hand === undefined || (oneDecision && length === null)) return null;
  const ordinal = playedOrdinal(context);
  return <HandCounter progress={hand} length={length} decision={!oneDecision} {...(ordinal === null ? {} : { ordinal })} />;
}

export function RunProgress({ context }: RunProgressProps) {
  return (
    <>
      <CoverageNote coverage={context.session.coverage} />
      <SessionHandCounter context={context} />
    </>
  );
}
