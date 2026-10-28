/**
 * The session's progress strip above the table (S26, R3.13, R3.14, O-312, O-313). From the session
 * context: the covered-part note when POST /sessions queued part of the drill (every mode), and in
 * street and full-hand modes the hand and decision counter plus, at the first decision of a hand
 * that follows an ended one, the summary of how that hand ended. Spot mode shows no counter and no
 * summary, so its screen stays as S25 left it.
 */
import type { SessionContext } from "../../trainer/spot-machine.js";
import { CoverageNote } from "./CoverageNote.js";
import { HandCounter } from "./HandCounter.js";
import { HandSummary } from "./HandSummary.js";

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
      {hand === undefined || hand.endedHand === null ? null : <HandSummary ended={hand.endedHand} stopRule={stopRule} />}
    </>
  );
}
