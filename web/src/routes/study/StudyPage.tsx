/**
 * The study browser, /study (S25, S39, R3.12, A7 sections 2 to 4, O-286, O-287, O-354, O-392).
 *
 * Mechanism: the URL's validated search (src/study/search.ts) is the confirmed spot. When its
 * five settings (format, table size, stake, depth, pair) name a configuration and a covered pair,
 * the page shows a one-line summary and the node area, with the position carousel and the matrix.
 * Otherwise, or after "Change settings", it shows the settings panel and reads no node: the panel
 * edits a draft in component state, seeded from the URL, and Confirm pushes the new settings
 * (searchFromDraft clears the line and hand only when a setting changed). The screen is keyed by
 * the URL's settings, so a confirmed change starts it afresh with the panel closed. While a
 * complete URL is being checked against the catalog the page says it is loading instead of
 * flashing the panel; only the catalog reads count for that, never the draft's, so editing never
 * unmounts the panel (review round 1). The panel's choices, its Confirm reason and its uncovered
 * notice are computed once per draft from the draft itself. Cancel puts the draft back to the URL,
 * so nothing it read lingers. A failed catalog read shows an alert with a retry; a failed read of
 * the draft's seats shows inside the panel. The page owns one node switch metrics instance per
 * mount and hands it down through context, so Confirm and the carousel mark their requests on the
 * same clock.
 */
import { useMemo, useState } from "react";

import type { AppApi } from "../../api/index.js";
import { useAppApi } from "../../auth/index.js";
import { LoadingNote, PageHeader } from "../../components/ui/index.js";
import { seatedPositions } from "../../drills/limits.js";
import { NodeSwitchMetricsContext, createNodeSwitchMetrics } from "../../study/node-switch-metrics.js";
import { catalogFailure } from "../../study/problem-text.js";
import type { StudySearch } from "../../study/search.js";
import {
  confirmBlocker,
  draftConfigId,
  draftFromSearch,
  draftPair,
  draftUncoveredPair,
  fieldStates,
  searchFromDraft,
  settingsSignature,
  settingsSummary,
  withSetting,
  type SettingKey,
  type SettingsDraft,
} from "../../study/settings.js";
import { useStudyEntry, type StudyEntry } from "../../study/use-study-entry.js";
import { useStudyNavigation, type StudyNavigation } from "../../study/use-study-navigation.js";
import { StudyNodeArea } from "./StudyNodeArea.js";
import { FailureAlert } from "./StudyNotices.js";
import { SettingsSummary, StudySettingsPanel } from "./StudySettingsPanel.js";

export interface StudyPageProps {
  search: StudySearch;
}

const PAGE_TITLE = "Solution browser";
const PAGE_DESCRIPTION = "Pick a spot, then follow the hand seat by seat.";

function uncoveredNotice(pair: string): string {
  return `${pair} is not in the library at this configuration.`;
}

function hasAllSettings(search: StudySearch): boolean {
  return [search.format, search.table_size, search.stake, search.depth, search.pair].every((value) => value !== undefined);
}

interface SettingsAreaProps {
  entry: StudyEntry;
  search: StudySearch;
  draft: SettingsDraft;
  onDraftChange: (draft: SettingsDraft) => void;
  navigation: StudyNavigation;
  onClose?: () => void;
}

function SettingsArea({ entry, search, draft, onDraftChange, navigation, onClose }: SettingsAreaProps) {
  const { catalog, draftSeats } = entry;
  const seatsFailed = draftSeats.failed;
  const fields = useMemo(() => fieldStates(catalog, draft, { seatsFailed }), [catalog, draft, seatsFailed]);
  const blocker = confirmBlocker(catalog, draft, { states: fields, seatsFailed });
  const uncovered = catalog === undefined ? undefined : draftUncoveredPair(catalog, draft);
  const onConfirm = () => {
    if (catalog === undefined || blocker !== undefined) return;
    const configId = draftConfigId(catalog.configs, draft);
    const pair = draftPair(configId === undefined ? undefined : catalog.pairsOf(configId), draft);
    if (pair === undefined) return;
    const next = searchFromDraft(search, draft, pair.pair);
    if (next === search) onClose?.();
    else navigation.confirm(next);
  };
  const onChange = (key: SettingKey, raw: string) => {
    if (catalog !== undefined) onDraftChange(withSetting(catalog, draft, key, raw));
  };
  return (
    <StudySettingsPanel
      fields={fields}
      draft={draft}
      blocker={blocker}
      {...(uncovered === undefined ? {} : { notice: uncoveredNotice(uncovered) })}
      {...(seatsFailed ? { seatsFailure: { onRetry: draftSeats.retry } } : {})}
      onChange={onChange}
      onConfirm={onConfirm}
      {...(onClose === undefined ? {} : { onCancel: onClose })}
    />
  );
}

interface StudyScreenProps {
  api: AppApi;
  search: StudySearch;
}

function StudyScreen({ api, search }: StudyScreenProps) {
  const navigation = useStudyNavigation(search);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFromSearch(search));
  const entry = useStudyEntry(api, search, draft);
  const { configId, studyPair, catalogReads } = entry;
  const confirmed = configId !== undefined && studyPair !== undefined && search.table_size !== undefined;
  const settling = hasAllSettings(search) && catalogReads.error === null && !entry.urlSettled;

  const openSettings = () => {
    setDraft(draftFromSearch(search));
    setEditing(true);
  };
  const closeSettings = () => {
    setDraft(draftFromSearch(search));
    setEditing(false);
  };

  function body() {
    if (settling) return <LoadingNote text="Loading the catalog." />;
    if (!confirmed || editing) {
      return (
        <SettingsArea
          entry={entry}
          search={search}
          draft={draft}
          onDraftChange={setDraft}
          navigation={navigation}
          {...(confirmed ? { onClose: closeSettings } : {})}
        />
      );
    }
    return (
      <>
        <SettingsSummary summary={settingsSummary(entry.stakes ?? [], search)} onChange={openSettings} />
        <StudyNodeArea
          api={api}
          configId={configId}
          pair={studyPair}
          seats={seatedPositions(search.table_size ?? 0)}
          search={search}
          onModeChange={navigation.setMode}
          onSelectHand={navigation.setHand}
          onOpenLine={navigation.openLine}
          onLensChange={navigation.setLens}
        />
      </>
    );
  }

  return (
    <section className="flex flex-col gap-4" data-pair={search.pair}>
      <PageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
      {catalogReads.error === null ? null : <FailureAlert failure={catalogFailure()} onRetry={catalogReads.retry} />}
      {body()}
    </section>
  );
}

export function StudyPage({ search }: StudyPageProps) {
  const api = useAppApi();
  const [metrics] = useState(createNodeSwitchMetrics);
  return (
    <NodeSwitchMetricsContext.Provider value={metrics}>
      <StudyScreen key={settingsSignature(search)} api={api} search={search} />
    </NodeSwitchMetricsContext.Provider>
  );
}
