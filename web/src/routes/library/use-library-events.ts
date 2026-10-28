/**
 * What the library screen does with each server-sent event (S28, R3.4, R3.5, O-297, O-295).
 *
 * - coverage_added: when it is for the configuration on screen, the configuration's pairs list is
 *   refetched (a preflop build changes availability) and, when it is also the selected pair, so
 *   is that pair's coverage; the newest such event becomes the live note. The note belongs to its
 *   configuration: choosing another one clears it (PR #28 review M3).
 * - builder_state: folded into the cached builder status as a new object (applyBuilderState).
 * - build_progress (admins only): the latest one is kept for BuilderHealth. It is cleared when a
 *   coverage_added arrives for any configuration or the builder reports idle or paused (review
 *   M4). A coverage_added cannot be matched to its job by id (build_id names the new solution,
 *   build_progress names the job, A4 section 4), but the builder runs one job at a time, so a
 *   publish ends the build that was in progress.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { BuilderStatus } from "../../contracts.js";
import type { BuilderReportedState, BuildProgressEvent, CoverageAddedEvent } from "../../library/events.js";
import { BUILDER_STATUS_KEY, coverageKey } from "../../library/queries.js";
import { applyBuilderState } from "../../library/use-builder.js";
import { useServerEvents, type StreamStatus } from "../../library/use-server-events.js";
import { CATALOG_QUERY_ROOT } from "../../study/queries.js";

/** The reported states in which no build is in progress. */
const NOT_BUILDING: readonly BuilderReportedState[] = ["idle", "paused"];

export interface LibraryEvents {
  status: StreamStatus;
  reconnect: () => void;
  latestCoverage: CoverageAddedEvent | null;
  progress: BuildProgressEvent | null;
}

export function useLibraryEvents(configId: string | undefined, pair: string | undefined): LibraryEvents {
  const queryClient = useQueryClient();
  const [latestCoverage, setLatestCoverage] = useState<CoverageAddedEvent | null>(null);
  const [noteConfigId, setNoteConfigId] = useState(configId);
  const [progress, setProgress] = useState<BuildProgressEvent | null>(null);
  // Adjusting state while rendering (the React pattern for a prop change): a new configuration
  // drops the previous one's note before anything is drawn with it.
  if (noteConfigId !== configId) {
    setNoteConfigId(configId);
    setLatestCoverage(null);
  }
  const stream = useServerEvents({
    onCoverageAdded: (event) => {
      setProgress(null);
      if (event.config_id !== configId) return;
      setLatestCoverage(event);
      void queryClient.invalidateQueries({ queryKey: [CATALOG_QUERY_ROOT, "pairs", event.config_id] });
      if (event.pair === pair) void queryClient.invalidateQueries({ queryKey: coverageKey(event.config_id, event.pair) });
    },
    onBuilderState: (event) => {
      if (NOT_BUILDING.includes(event.state)) setProgress(null);
      queryClient.setQueryData<BuilderStatus>(BUILDER_STATUS_KEY, (status) =>
        status === undefined ? status : applyBuilderState(status, event),
      );
    },
    onBuildProgress: setProgress,
  });
  return { ...stream, latestCoverage, progress };
}
