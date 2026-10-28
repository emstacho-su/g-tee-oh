/**
 * The selected pair's coverage and gap request on /library (S28, R3.4, O-240, ADR 0018). It reads
 * GET /coverage for the configuration and pair, shows CoverageDetail with a request button on each
 * queued flop, and GapRequest for a preflop gap or a typed flop; both send through one
 * useGapRequest, so the answer (with its queue position) shows in one place.
 */
import { useQuery } from "@tanstack/react-query";

import type { AppApi } from "../../api/index.js";
import { CoverageDetail } from "../../components/library/CoverageDetail.js";
import { GapRequest } from "../../components/library/GapRequest.js";
import { Button, LoadingNote } from "../../components/ui/index.js";
import { coverageQuery } from "../../library/queries.js";
import { useGapRequest } from "../../library/use-gap-request.js";

export interface CoveragePanelProps {
  api: AppApi;
  configId: string;
  pair: string;
  preflopAvailable: boolean;
}

export function CoveragePanel({ api, configId, pair, preflopAvailable }: CoveragePanelProps) {
  const coverage = useQuery(coverageQuery(api, configId, pair));
  const request = useGapRequest(api, configId, pair);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        {coverage.data === undefined && coverage.isError ? (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm">
            <p className="text-danger">The coverage for this pair could not be loaded.</p>
            <Button size="sm" onClick={() => void coverage.refetch()}>
              Try again
            </Button>
          </div>
        ) : null}
        {coverage.data === undefined && !coverage.isError ? <LoadingNote text="Loading the coverage." /> : null}
        {coverage.data === undefined ? null : (
          <CoverageDetail coverage={coverage.data} requestPending={request.pending} onRequestFlop={(flop) => request.send({ flop })} />
        )}
      </div>
      <GapRequest pair={pair} preflopAvailable={preflopAvailable} request={request} />
    </div>
  );
}
