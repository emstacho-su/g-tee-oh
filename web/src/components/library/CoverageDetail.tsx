/**
 * The selected pair's coverage (S28, R3.4, O-291, O-172, O-57): the flop families with their
 * covered flops and scenarios, and the build queue in the builder's claim order with each job's
 * position. A queued flop can be requested from its row, which raises it to the head of the queue
 * (O-240). When solver-query's database did not answer, the flop and queue blocks are empty by
 * contract, and a note says so instead of showing an empty library. A synthetic preflop solution
 * carries the shared synthetic banner. Since S40 (O-406) it is the body of the "Flops and queue"
 * card, under an h3 naming the pair and configuration. Since S45 (R3.27) the heading can carry a
 * star for the spot (the caller's slot), the same star the study summary shows.
 */
import type { ReactNode } from "react";

import { familyRows, type Coverage } from "../../library/texture-families.js";
import { Button, SyntheticBanner } from "../ui/index.js";

const DATABASE_NOTES: Readonly<Record<Coverage["database"], string | null>> = {
  connected: null,
  unconfigured: "The solver service has no database connection, so flop coverage and the queue are not shown.",
  unavailable: "The solver service could not reach its database, so flop coverage and the queue are not shown.",
};

export interface CoverageDetailProps {
  coverage: Coverage;
  /** Requests a queued flop; undefined hides the row buttons. */
  onRequestFlop?: (flop: string) => void;
  requestPending: boolean;
  /** A star for the spot beside the heading (S45, R3.27). */
  star?: ReactNode;
}

function FamilyTable({ coverage }: { coverage: Coverage }) {
  const rows = familyRows(coverage.flops);
  return (
    <table className="w-full text-sm">
      <caption className="text-left font-medium">Flops by texture family</caption>
      <thead>
        <tr className="text-left text-muted">
          <th scope="col">Family</th>
          <th scope="col">Covered flops</th>
          <th scope="col">Scenarios</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.family} className="border-t border-border/50">
            <th scope="row" className="py-1 text-left font-normal">
              {row.label}
            </th>
            <td>{row.flops}</td>
            <td>{row.scenarios}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QueueTable({ coverage, onRequestFlop, requestPending }: CoverageDetailProps) {
  if (coverage.queue.length === 0) return <p className="text-sm text-muted">No build is queued for this pair.</p>;
  return (
    <table className="w-full text-sm">
      <caption className="text-left font-medium">Build queue for this pair</caption>
      <thead>
        <tr className="text-left text-muted">
          <th scope="col">Position</th>
          <th scope="col">Flop</th>
          <th scope="col">Priority</th>
          {onRequestFlop === undefined ? null : <th scope="col">Request</th>}
        </tr>
      </thead>
      <tbody>
        {coverage.queue.map((entry) => (
          <tr key={entry.job_id} className="border-t border-border/50">
            <td className="py-1">{entry.position}</td>
            <th scope="row" className="text-left font-mono font-normal">
              {entry.flop}
            </th>
            <td>{entry.priority.toFixed(2)}</td>
            {onRequestFlop === undefined ? null : (
              <td>
                <Button size="sm" disabled={requestPending} onClick={() => onRequestFlop(entry.flop)}>
                  {`Request ${entry.flop}`}
                </Button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CoverageDetail({ coverage, onRequestFlop, requestPending, star }: CoverageDetailProps) {
  const note = DATABASE_NOTES[coverage.database];
  return (
    <section aria-labelledby="coverage-detail-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="coverage-detail-heading" className="text-base font-semibold">{`${coverage.pair} at ${coverage.config_id}`}</h3>
        {star}
      </div>
      {coverage.synthetic ? <SyntheticBanner /> : null}
      <p className="text-sm">{coverage.preflop_available ? "The preflop solution is in the library." : "The preflop solution is not in the library."}</p>
      {note === null ? (
        <>
          <FamilyTable coverage={coverage} />
          <QueueTable coverage={coverage} requestPending={requestPending} {...(onRequestFlop === undefined ? {} : { onRequestFlop })} />
        </>
      ) : (
        <p role="note" className="text-sm text-muted">
          {note}
        </p>
      )}
    </section>
  );
}
