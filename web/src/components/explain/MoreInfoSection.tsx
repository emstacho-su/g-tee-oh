/**
 * More info as the feedback panel's inline Explanation section (S27 lane D, S38, R3.19, O-309,
 * O-388, 05 section 10, ADR 0016, ADR 0004).
 *
 * Mechanism: the panel's Explanation Disclosure mounts this body on its first open and keeps it
 * mounted, so GET /explain/{attempt_id}/more-info is read on the first open only and served from
 * the cache after that (moreInfoQuery). The owner asked for drill-down that expands and collapses
 * instead of a dialog that must be exited (O-388), so there is no dialog. Each template section
 * renders as a region named by its title, with the text as one plain text paragraph:
 * whitespace-pre-line keeps the api's line breaks, and React escapes every character, so nothing
 * in the text is ever read as HTML or markdown. The numbers are the api's (every one exists in the
 * solver data, R3.19); nothing is computed here. A failure is an explicit alert with a retry
 * (QueryFailure), never server detail text. MoreInfoSections draws a list of sections without the
 * read, for the gallery.
 */
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";

import { useAppApi } from "../../auth/index.js";
import type { MoreInfo } from "../../contracts.js";
import { moreInfoQuery } from "../../explain/queries.js";
import { EXPLAIN_TEXT } from "../../explain/texts.js";
import { QueryFailure } from "../trainer/FeedbackQueryState.js";
import { LoadingNote } from "../ui/index.js";

type Section = MoreInfo["sections"][number];

function MoreInfoPart({ section }: { section: Section }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-1">
      <h4 id={titleId} className="text-sm font-semibold">
        {section.title}
      </h4>
      <p data-testid={`more-info-${section.template}`} className="whitespace-pre-line text-sm">
        {section.text}
      </p>
    </section>
  );
}

export interface MoreInfoSectionsProps {
  sections: readonly Section[];
}

/** The template sections as plain text, or the empty note. */
export function MoreInfoSections({ sections }: MoreInfoSectionsProps) {
  if (sections.length === 0) return <p className="text-sm text-muted">{EXPLAIN_TEXT.moreInfoEmpty}</p>;
  return (
    <div data-testid="more-info-sections" className="flex flex-col gap-3">
      {sections.map((section) => (
        <MoreInfoPart key={section.template} section={section} />
      ))}
    </div>
  );
}

export interface MoreInfoSectionProps {
  attemptId: string;
}

export function MoreInfoSection({ attemptId }: MoreInfoSectionProps) {
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
  return <MoreInfoSections sections={query.data.sections} />;
}
