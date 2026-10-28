/**
 * The holdout card's action (S32, R4.12, O-328): a link styled as a button that opens /train in
 * holdout mode (/train?mode=holdout), where the retest starts in the automated session view. The
 * lead places it in lane A's HoldoutCard action slot. With a round already open it reads "Resume
 * this month's retest" (O-276: starting again serves the next unanswered item of the round). With
 * every item of the open round answered there is nothing to start (the api answers 409
 * holdout-complete), so it shows the note "Retest complete for this month" instead of a link.
 * It is a router Link, so following it keeps the app and its query cache.
 */
import { Link } from "@tanstack/react-router";

import { Button } from "../../components/ui/index.js";
import { HOLDOUT_SEARCH, TRAIN_PATH, TRAIN_TEXT } from "./train-text.js";

/** The open round's progress, as ProgressHoldout.open carries it. */
export interface OpenRoundProgress {
  readonly answered: number;
  readonly total: number;
}

export interface HoldoutRetestButtonProps {
  /** This month's open round, or null (or absent) when none is open. */
  open?: OpenRoundProgress | null;
}

export function HoldoutRetestButton({ open = null }: HoldoutRetestButtonProps) {
  if (open !== null && open.answered >= open.total) {
    return (
      <p className="text-sm text-muted" data-testid="holdout-retest-complete">
        {TRAIN_TEXT.retestComplete}
      </p>
    );
  }
  const resume = open !== null;
  return (
    <Button asChild variant="primary" size="sm">
      <Link to={TRAIN_PATH} search={HOLDOUT_SEARCH} data-testid="holdout-retest">
        {resume ? TRAIN_TEXT.retestResume : TRAIN_TEXT.retestStart}
      </Link>
    </Button>
  );
}
