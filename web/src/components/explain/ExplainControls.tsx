/**
 * Ask in the feedback panel's controls row (S27 lane D, S38, R3.20, 05 section 10, ADR 0016,
 * O-305 to O-308, O-388).
 *
 * Mechanism: AskButton is enabled only while GET /explain/status says Ask is available and is
 * otherwise disabled with its visible reason (O-305, O-306); it opens AskDialog, which posts the
 * question and shows the answer as plain text with its cached note or validator warning (O-307,
 * O-308). The dialog is keyed by feedback.attempt_id, so a new decision never shows an earlier
 * attempt's text. More info left this row in S38: it is the panel's inline Explanation section
 * (MoreInfoSection, O-388), so onDialogOpenChange now reports Ask's dialog only.
 */
import { useEffect, useState } from "react";

import type { DecisionFeedback } from "../../contracts.js";
import { AskButton } from "./AskButton.js";
import { AskDialog } from "./AskDialog.js";

export interface ExplainControlsProps {
  feedback: DecisionFeedback;
  /**
   * Told when Ask's dialog opens or closes, so the screen can pause its hotkeys (Next hand, End
   * session, the action keys) while the dialog is over it, as it does for its own dialogs.
   */
  onDialogOpenChange?: (open: boolean) => void;
}

export function ExplainControls({ feedback, onDialogOpenChange }: ExplainControlsProps) {
  const [askOpen, setAskOpen] = useState(false);
  const attemptId = feedback.attempt_id;
  // If the panel unmounts with the dialog open, the screen must not stay paused.
  useEffect(() => () => onDialogOpenChange?.(false), [onDialogOpenChange]);
  const changeAsk = (open: boolean) => {
    setAskOpen(open);
    onDialogOpenChange?.(open);
  };
  return (
    <div data-testid="explain-controls" data-attempt={attemptId} className="flex flex-wrap items-center gap-2">
      <AskButton onOpen={() => changeAsk(true)} />
      <AskDialog key={`ask-${attemptId}`} attemptId={attemptId} open={askOpen} onOpenChange={changeAsk} />
    </div>
  );
}
