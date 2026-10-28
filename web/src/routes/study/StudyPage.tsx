/**
 * The study browser, /study (S25, R3.12, A7 sections 2 to 4, O-286, O-287).
 *
 * Mechanism: the URL's validated search (src/study/search.ts) is the whole screen state. The page
 * composes the filters (format, table size, stake, depth, pair; the catalog reads resolve the
 * config_id), then, once the config and a covered pair are known, the line breadcrumb and the node
 * area. Until then it asks for the first missing filter and reads no node. A pair the library does
 * not cover says so (coverage requests are the library screen's, S28). A failed catalog read
 * shows an alert with a retry. The page owns one node switch metrics instance per mount and hands
 * it down through context, so filter changes, line links and breadcrumb links all mark their
 * requests on the same clock.
 */
import { useState } from "react";

import type { AppApi } from "../../api/index.js";
import { useAppApi } from "../../auth/index.js";
import { FILTER_PROMPTS, missingFilter } from "../../study/filters.js";
import { NodeSwitchMetricsContext, createNodeSwitchMetrics } from "../../study/node-switch-metrics.js";
import { catalogFailure } from "../../study/problem-text.js";
import type { StudySearch } from "../../study/search.js";
import { useStudyCatalog, type StudyCatalog } from "../../study/use-study-catalog.js";
import { useStudyNavigation, type StudyNavigation } from "../../study/use-study-navigation.js";
import { LineBreadcrumb } from "./LineBreadcrumb.js";
import { StudyFilters } from "./StudyFilters.js";
import { StudyNodeArea } from "./StudyNodeArea.js";
import { FailureAlert, LoadingNote } from "./StudyNotices.js";

export interface StudyPageProps {
  search: StudySearch;
}

interface StudyBodyProps {
  api: AppApi;
  search: StudySearch;
  catalog: StudyCatalog;
  navigation: StudyNavigation;
}

function StudyBody({ api, search, catalog, navigation }: StudyBodyProps) {
  const { configId, studyPair, uncoveredPair } = catalog;
  if (configId !== undefined && studyPair !== undefined) {
    return (
      <>
        <LineBreadcrumb search={search} />
        <StudyNodeArea
          api={api}
          configId={configId}
          pair={studyPair}
          search={search}
          onModeChange={navigation.setMode}
          onSelectHand={navigation.setHand}
        />
      </>
    );
  }
  if (uncoveredPair !== undefined) {
    return <p className="text-muted">{`${uncoveredPair} is not in the library at this configuration.`}</p>;
  }
  if (catalog.error !== null) return null;
  if (catalog.loading) return <LoadingNote text="Loading the catalog." />;
  return <p className="text-muted">{FILTER_PROMPTS[missingFilter(search, configId) ?? "pair"]}</p>;
}

interface StudyScreenProps {
  api: AppApi;
  search: StudySearch;
}

function StudyScreen({ api, search }: StudyScreenProps) {
  const catalog = useStudyCatalog(api, search);
  const navigation = useStudyNavigation(search);
  return (
    <section className="flex flex-col gap-4" data-pair={search.pair}>
      <h1 className="text-2xl font-semibold">Solution browser</h1>
      <StudyFilters search={search} catalog={catalog} onFilterChange={navigation.setFilter} />
      {catalog.error === null ? null : <FailureAlert failure={catalogFailure()} onRetry={catalog.retry} />}
      <StudyBody api={api} search={search} catalog={catalog} navigation={navigation} />
    </section>
  );
}

export function StudyPage({ search }: StudyPageProps) {
  const api = useAppApi();
  const [metrics] = useState(createNodeSwitchMetrics);
  return (
    <NodeSwitchMetricsContext.Provider value={metrics}>
      <StudyScreen api={api} search={search} />
    </NodeSwitchMetricsContext.Provider>
  );
}
