/**
 * The More info dialog (S27 lane D, R3.19, O-309, 05 section 10, ADR 0016, ADR 0004).
 *
 * Mechanism: the dialog's content mounts only while it is open (Radix), so GET
 * /explain/{attempt_id}/more-info is read on the first open and served from the cache after that
 * (moreInfoQuery). Each template section renders as a region named by its title, with the text as
 * one plain text paragraph: whitespace-pre-line keeps the api's line breaks, and React escapes
 * every character, so nothing in the text is ever read as HTML or markdown. The numbers are the
 * api's (every one exists in the solver data, R3.19); nothing is computed here. A failure is an
 * explicit alert with a retry (QueryFailure), never server detail text.
 */
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";

import { useAppApi } from "../../auth/index.js";
import type { MoreInfo } from "../../contracts.js";
import { moreInfoQuery } from "../../explain/queries.js";
import { EXPLAIN_TEXT } from "../../explain/texts.js";
import { QueryFailure } from "../trainer/FeedbackQueryState.js";
import { Dialog, LoadingNote } from "../ui/index.js";

export interface MoreInfoDialogProps {
  attemptId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Section = MoreInfo["sections"][number];

interface MoreInfoSectionProps {
  section: Section;
}

function MoreInfoSection({ section }: MoreInfoSectionProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-1">
      <h3 id={titleId} className="font-semibold">
        {section.title}
      </h3>
      <p data-testid={`more-info-${section.template}`} className="whitespace-pre-line text-sm">
        {section.text}
      </p>
    </section>
  );
}

interface MoreInfoBodyProps {
  attemptId: string;
}

function MoreInfoBody({ attemptId }: MoreInfoBodyProps) {
  const api = useAppApi();
  const query = useQuery(moreInfoQuery(api, attemptId));
  if (query.isPending) return <LoadingNote text={EXPLAIN_TEXT.moreInfoLoading} />;
  if (query.isError) {
    return (
      <QueryFailure
        subject={EXPLAIN_TEXT.moreInfoSubject}
        error={query.error}
        retryLabel={EXPLAIN_TEXT.moreInfoRetry}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (query.data.sections.length === 0) return <p className="text-sm text-muted">{EXPLAIN_TEXT.moreInfoEmpty}</p>;
  return (
    <div data-testid="more-info-sections" className="flex flex-col gap-4">
      {query.data.sections.map((section) => (
        <MoreInfoSection key={section.template} section={section} />
      ))}
    </div>
  );
}

export function MoreInfoDialog({ attemptId, open, onOpenChange }: MoreInfoDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={EXPLAIN_TEXT.moreInfoTitle}>
      <MoreInfoBody attemptId={attemptId} />
    </Dialog>
  );
}
