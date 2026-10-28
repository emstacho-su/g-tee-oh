/**
 * /library: the coverage view and builder health (S28, R3.4, R3.5, A7 sections 2 and 3, O-36,
 * O-291, O-297, ADR 0018). Library-first serving made visible: what the library holds, what is
 * queued, and a way to ask for a gap that never waits on a solve.
 *
 * Mechanism: the URL's validated search (library/search.ts) is the screen state. The study
 * filters pick the configuration (format, table size, stake, depth; their pair select is hidden),
 * the catalog reads resolve its config_id and pairs (useStudyCatalog), and CoverageGrid picks the
 * pair, written to the URL. The selected pair's CoveragePanel reads its coverage and sends gap
 * requests. One event stream is open while the page is mounted (useLibraryEvents). The builder
 * panel follows for an admin (O-290).
 */
import { useNavigate } from "@tanstack/react-router";

import type { AppApi } from "../../api/index.js";
import { describeFailureForLog } from "../../api/http-status.js";
import { useAppApi } from "../../auth/index.js";
import { CoverageGrid } from "../../components/library/CoverageGrid.js";
import { LoadingNote } from "../../components/ui/index.js";
import { withLibraryFilter, withPair, type LibrarySearch } from "../../library/search.js";
import { useIsAdmin } from "../../library/use-builder.js";
import { FILTER_PROMPTS, missingFilter, type FilterKey } from "../../study/filters.js";
import { catalogFailure } from "../../study/problem-text.js";
import { useStudyCatalog, type StudyCatalog } from "../../study/use-study-catalog.js";
import { FailureAlert } from "../study/StudyNotices.js";
import { StudyFilters } from "../study/StudyFilters.js";
import { BuilderPanel } from "./BuilderPanel.js";
import { CoveragePanel } from "./CoveragePanel.js";
import { LiveStatus } from "./LiveStatus.js";
import { useLibraryEvents } from "./use-library-events.js";

export interface LibraryPageProps {
  search: LibrarySearch;
}

function useLibraryNavigation(search: LibrarySearch) {
  const navigate = useNavigate();
  function replaceWith(next: LibrarySearch): void {
    navigate({ to: "/library", search: next, replace: true }).catch((error: unknown) => {
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
    if (catalog.loading) return <LoadingNote text="Loading the catalog." />;
    return <p className="text-muted">{FILTER_PROMPTS[missingFilter(search, configId) ?? "depth"]}</p>;
  }
  const selected = pairs.find((entry) => entry.pair === search.pair);
  return (
    <>
      <CoverageGrid pairs={pairs} selectedPair={selected?.pair} onSelectPair={onSelectPair} />
      {selected === undefined ? (
        <p className="text-muted">Choose a pair to see its flops and queue, or to request it.</p>
      ) : (
        <CoveragePanel api={api} configId={configId} pair={selected.pair} preflopAvailable={selected.preflop_available} />
      )}
    </>
  );
}

export function LibraryPage({ search }: LibraryPageProps) {
  const api = useAppApi();
  const catalog = useStudyCatalog(api, search);
  const navigation = useLibraryNavigation(search);
  const isAdmin = useIsAdmin();
  const events = useLibraryEvents(catalog.configId, search.pair);
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Coverage and builder health</h1>
        <LiveStatus status={events.status} onReconnect={events.reconnect} latest={events.latestCoverage} />
      </div>
      <StudyFilters search={search} catalog={catalog} onFilterChange={navigation.setFilter} hidePair label="Library filters" />
      {catalog.error === null ? null : <FailureAlert failure={catalogFailure()} onRetry={catalog.retry} />}
      <CoverageArea api={api} search={search} catalog={catalog} onSelectPair={navigation.setPair} />
      <BuilderPanel api={api} isAdmin={isAdmin} progress={events.progress} />
    </section>
  );
}
