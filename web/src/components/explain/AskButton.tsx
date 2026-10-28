/**
 * The Ask button and its availability (S27 lane D, R3.20, O-305, O-306, A7 section 4).
 *
 * Mechanism: the button reads GET /explain/status (askStatusQuery) and is enabled only when the
 * status says Ask is available. Otherwise it stays disabled and a visible sentence says why
 * ("Ask is off until a model key is configured" for flag_off, "This month's Ask budget is used"
 * for cap_reached), tied to the button through aria-describedby, so the reason is text and never
 * only a greyed look. While the status loads the button is disabled with a loading note; a failed
 * status read is an explicit alert with a retry.
 */
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";

import { useAppApi } from "../../auth/index.js";
import { askStatusQuery } from "../../explain/queries.js";
import { askUnavailableText, EXPLAIN_TEXT } from "../../explain/texts.js";
import { QueryFailure } from "../trainer/FeedbackQueryState.js";
import { Button, LoadingNote } from "../ui/index.js";

export interface AskButtonProps {
  onOpen: () => void;
}

export function AskButton({ onOpen }: AskButtonProps) {
  const api = useAppApi();
  const query = useQuery(askStatusQuery(api));
  const reasonId = useId();
  if (query.isPending || query.isError) {
    return (
      <>
        <Button disabled>{EXPLAIN_TEXT.ask}</Button>
        {query.isPending ? (
          <LoadingNote text={EXPLAIN_TEXT.statusLoading} />
        ) : (
          <QueryFailure
            subject={EXPLAIN_TEXT.statusSubject}
            error={query.error}
            retryLabel={EXPLAIN_TEXT.statusRetry}
            onRetry={() => void query.refetch()}
          />
        )}
      </>
    );
  }
  const reason = askUnavailableText(query.data);
  if (reason === null) {
    return (
      <Button data-testid="ask-available" onClick={onOpen}>
        {EXPLAIN_TEXT.ask}
      </Button>
    );
  }
  return (
    <>
      <Button disabled aria-describedby={reasonId}>
        {EXPLAIN_TEXT.ask}
      </Button>
      <p id={reasonId} data-testid="ask-unavailable-reason" data-reason={query.data.reason} className="text-sm text-muted">
        {reason}
      </p>
    </>
  );
}
