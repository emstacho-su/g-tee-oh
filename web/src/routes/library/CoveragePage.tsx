/**
 * The Coverage page of /library (S28, R3.4, O-291, ADR 0018; S40, O-406): four cards on the S36
 * system. "Configuration" holds the study filters that pick the configuration (format, table size,
 * stake, depth; their pair select is hidden); "Coverage" holds the pair grid of that configuration
 * (CoverageGrid), whose selection is written to the URL; for the selected pair, "Flops and queue"
 * and "Request a gap" sit side by side on a wide screen (CoveragePanel). Every change replaces the
 * URL on this page, so Back leaves the library instead of stepping through filter changes.
 */
import { useNavigate } from "@tanstack/react-router";

import type { AppApi } from "../../api/index.js";
import { describeFailureForLog } from "../../api/http-status.js";
import { CoverageGrid } from "../../components/library/CoverageGrid.js";
import { Card, LoadingNote } from "../../components/ui/index.js";
import { withLibraryFilter, withPair, type LibrarySearch } from "../../library/search.js";
import { FILTER_PROMPTS, missingFilter, type FilterKey } from "../../study/filters.js";
import { catalogFailure } from "../../study/problem-text.js";
import type { StudyCatalog } from "../../study/use-study-catalog.js";
import { FailureAlert } from "../study/StudyNotices.js";
import { StudyFilters } from "../study/StudyFilters.js";
import { CoveragePanel } from "./CoveragePanel.js";

export const COVERAGE_PAGE_TEXT = {
  configuration: "Configuration",
  configurationDescription: "Pick the game the coverage is shown for.",
  coverage: "Coverage",
  choosePair: "Choose a pair to see its flops and queue, or to request it.",
  loadingCatalog: "Loading the catalog.",
} as const;

function useCoverageNavigation(search: LibrarySearch) {
  const navigate = useNavigate();
  function replaceWith(next: LibrarySearch): void {
    navigate({ to: "/library/$section", params: { section: "coverage" }, search: next, replace: true }).catch((error: unknown) => {
      console.error(`g-tee-oh: the library navigation failed (${describeFailureForLog(error)})`);
    });
  }
  return {
    setFilter: (key: FilterKey, raw: string) => replaceWith(withLibraryFilter(search, key, raw)),
    setPair: (pair: string) => replaceWith(withPair(search, pair)),
  };
}

interface CoverageAreaProps {
  api: AppApi;
  search: LibrarySearch;
  catalog: StudyCatalog;
  onSelectPair: (pair: string) => void;
}

function CoverageArea({ api, search, catalog, onSelectPair }: CoverageAreaProps) {
  const { configId, pairs } = catalog;
  if (configId === undefined || pairs === undefined) {
    if (catalog.error !== null) return null;
    return (
      <Card title={COVERAGE_PAGE_TEXT.coverage}>
        {catalog.loading ? (
          <LoadingNote text={COVERAGE_PAGE_TEXT.loadingCatalog} />
        ) : (
          <p className="text-sm text-muted">{FILTER_PROMPTS[missingFilter(search, configId) ?? "depth"]}</p>
        )}
      </Card>
    );
  }
  const selected = pairs.find((entry) => entry.pair === search.pair);
  return (
    <>
      <Card title={COVERAGE_PAGE_TEXT.coverage}>
        <CoverageGrid pairs={pairs} selectedPair={selected?.pair} onSelectPair={onSelectPair} />
        {selected === undefined ? <p className="text-sm text-muted">{COVERAGE_PAGE_TEXT.choosePair}</p> : null}
      </Card>
      {selected === undefined ? null : (
        // Keyed by the spot, so a new selection starts with an empty flop field, no earlier
        // answer in the live region and no held Idempotency-Key (PR #28 review M2).
        <CoveragePanel
          key={`${configId}|${selected.pair}`}
          api={api}
          configId={configId}
          pair={selected.pair}
          preflopAvailable={selected.preflop_available}
        />
      )}
    </>
  );
}

export interface CoveragePageProps {
  api: AppApi;
  search: LibrarySearch;
  catalog: StudyCatalog;
}

export function CoveragePage({ api, search, catalog }: CoveragePageProps) {
  const navigation = useCoverageNavigation(search);
  return (
    <>
      <Card title={COVERAGE_PAGE_TEXT.configuration} description={COVERAGE_PAGE_TEXT.configurationDescription}>
        <StudyFilters search={search} catalog={catalog} onFilterChange={navigation.setFilter} hidePair label="Library filters" />
      </Card>
      {catalog.error === null ? null : <FailureAlert failure={catalogFailure()} onRetry={catalog.retry} />}
      <CoverageArea api={api} search={search} catalog={catalog} onSelectPair={navigation.setPair} />
    </>
  );
}
