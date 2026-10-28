/**
 * More info and Ask in the feedback panel (S27 lane D, R3.19, R3.20, 05 section 10, ADR 0016,
 * O-305 to O-309).
 *
 * Mechanism: two buttons under the feedback. More info opens MoreInfoDialog, which reads the five
 * template sections for the decision's attempt (O-309). Ask is AskButton, enabled only while GET
 * /explain/status says Ask is available and otherwise disabled with its visible reason (O-305,
 * O-306); it opens AskDialog, which posts the question and shows the answer as plain text with
 * its cached note or validator warning (O-307, O-308). Both dialogs are keyed by
 * feedback.attempt_id, so a new decision never shows an earlier attempt's text.
 */
import { useEffect, useState } from "react";

import type { DecisionFeedback } from "../../contracts.js";
import { EXPLAIN_TEXT } from "../../explain/texts.js";
import { Button } from "../ui/index.js";
import { AskButton } from "./AskButton.js";
import { AskDialog } from "./AskDialog.js";
import { MoreInfoDialog } from "./MoreInfoDialog.js";

export interface ExplainControlsProps {
  feedback: DecisionFeedback;
  /**
   * Told when either dialog opens or closes, so the screen can pause its hotkeys (Next hand, End
   * session, the action keys) while a dialog is over it, as it does for its own dialogs.
   */
  onDialogOpenChange?: (open: boolean) => void;
}

export function ExplainControls({ feedback, onDialogOpenChange }: ExplainControlsProps) {
  const [moreInfoOpen, setMoreInfoOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const attemptId = feedback.attempt_id;
  // If the panel unmounts with a dialog open, the screen must not stay paused.
  useEffect(() => () => onDialogOpenChange?.(false), [onDialogOpenChange]);
  const changeMoreInfo = (open: boolean) => {
    setMoreInfoOpen(open);
    onDialogOpenChange?.(open);
  };
  const changeAsk = (open: boolean) => {
    setAskOpen(open);
    onDialogOpenChange?.(open);
  };
  return (
    <div data-testid="explain-controls" data-attempt={attemptId} className="flex flex-wrap items-center gap-2">
      <Button onClick={() => changeMoreInfo(true)}>{EXPLAIN_TEXT.moreInfo}</Button>
      <AskButton onOpen={() => changeAsk(true)} />
      <MoreInfoDialog key={`more-info-${attemptId}`} attemptId={attemptId} open={moreInfoOpen} onOpenChange={changeMoreInfo} />
      <AskDialog key={`ask-${attemptId}`} attemptId={attemptId} open={askOpen} onOpenChange={changeAsk} />
    </div>
  );
}
