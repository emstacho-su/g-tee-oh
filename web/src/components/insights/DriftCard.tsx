/**
 * The range drift card of the feedback panel (S27 lane C, R3.18, O-304, 05 section 9).
 *
 * Mechanism: the card reads GET /insights/drift for the decision's node family (driftQuery, keyed
 * by spot_class_key). Below the minimum the api hides drift and sends only the count, so the card
 * says drift appears after that many decisions and how many there are so far. Once shown, it
 * states the distance between the user's action mix and the solver's and its confidence interval
 * as percentages with one decimal, the decision count, a small table of each kind's share for the
 * user and the solver, and that drift is an insight only, never graded. Every number is the
 * api's, only formatted (ADR 0004). Loading is the shared LoadingNote; a failure is the shared
 * QueryFailure alert with a retry, as the threshold card does; server detail is never shown.
 */
import { useQuery } from "@tanstack/react-query";
import { useId, type ReactNode } from "react";

import { useAppApi } from "../../auth/index.js";
import type { RangeDrift } from "../../contracts.js";
import { formatShare } from "../../poker/format.js";
import { actionStyle } from "../../theme/action-style.js";
import { QueryFailure } from "../trainer/FeedbackQueryState.js";
import { LoadingNote } from "../ui/index.js";
import { driftQuery } from "./queries.js";

/** The confidence level is a whole percentage (95%), the shares one decimal. */
const CONFIDENCE_DECIMALS = 0;

export const DRIFT_INSIGHT_NOTE = "Insight only, never graded.";

export interface DriftCardProps {
  spotClassKey: string;
}

function hiddenText(drift: RangeDrift): string {
  return `Range drift appears after ${drift.min_decisions} decisions in this spot family (${drift.decisions} so far).`;
}

/** The shown drift's numbers, or null when the api sent a shown drift without them (then the card shows the hidden text). */
interface DriftNumbers {
  distance: number;
  low: number;
  high: number;
}

function numbersOf(drift: RangeDrift): DriftNumbers | null {
  const { distance, ci_low: low, ci_high: high } = drift;
  if (!drift.shown || distance === null || low === null || high === null) return null;
  return { distance, low, high };
}

function summaryText(drift: RangeDrift, numbers: DriftNumbers): string {
  const interval = `${formatShare(drift.confidence, CONFIDENCE_DECIMALS)} interval ${formatShare(numbers.low)} to ${formatShare(numbers.high)}`;
  return `Your action mix is ${formatShare(numbers.distance)} away from the solver's (${interval}), over ${drift.decisions} decisions.`;
}

function KindTable({ drift }: { drift: RangeDrift }) {
  return (
    <table className="w-full max-w-xs text-left tabular-nums">
      <caption className="sr-only">Action shares, yours against the solver's</caption>
      <thead>
        <tr>
          <th scope="col">Action</th>
          <th scope="col">You</th>
          <th scope="col">Solver</th>
        </tr>
      </thead>
      <tbody>
        {drift.by_kind.map((row) => (
          <tr key={row.kind}>
            <th scope="row" className="font-normal">
              {actionStyle(row.kind).name}
            </th>
            <td>{formatShare(row.user_share)}</td>
            <td>{formatShare(row.solver_share)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DriftBody({ drift }: { drift: RangeDrift }) {
  const numbers = numbersOf(drift);
  if (numbers === null) return <p className="text-muted">{hiddenText(drift)}</p>;
  return (
    <>
      <p>{summaryText(drift, numbers)}</p>
      <KindTable drift={drift} />
      <p className="text-muted">{DRIFT_INSIGHT_NOTE}</p>
    </>
  );
}

function useDriftContent(spotClassKey: string): ReactNode {
  const api = useAppApi();
  const query = useQuery(driftQuery(api, spotClassKey));
  if (query.isPending) return <LoadingNote text="Loading range drift" />;
  if (query.isError) {
    return <QueryFailure subject="Range drift" error={query.error} retryLabel="Retry range drift" onRetry={() => void query.refetch()} />;
  }
  return <DriftBody drift={query.data} />;
}

export function DriftCard({ spotClassKey }: DriftCardProps) {
  const titleId = useId();
  const content = useDriftContent(spotClassKey);
  return (
    <section
      data-testid="drift-card"
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4 text-sm"
    >
      <h3 id={titleId} className="font-semibold">
        Range drift
      </h3>
      {content}
    </section>
  );
}
