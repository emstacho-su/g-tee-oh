/**
 * The holdout card's action (S32, R4.12, O-328): a link styled as a button that opens /train in
 * holdout mode (/train?mode=holdout), where the retest starts in the automated session view. The
 * lead places it in lane A's HoldoutCard action slot. With a round already open it reads "Resume
 * this month's retest" (O-276: starting again serves the next unanswered item of the round).
 * It is a router Link, so following it keeps the app and its query cache.
 */
import { Link } from "@tanstack/react-router";

import { Button } from "../../components/ui/index.js";
import { HOLDOUT_SEARCH, TRAIN_PATH, TRAIN_TEXT } from "./train-text.js";

export interface HoldoutRetestButtonProps {
  /** True when this month's round is open (ProgressHoldout.open is set). */
  resume?: boolean;
}

export function HoldoutRetestButton({ resume = false }: HoldoutRetestButtonProps) {
  return (
    <Button asChild variant="primary" size="sm">
      <Link to={TRAIN_PATH} search={HOLDOUT_SEARCH} data-testid="holdout-retest">
        {resume ? TRAIN_TEXT.retestResume : TRAIN_TEXT.retestStart}
      </Link>
    </Button>
  );
}
