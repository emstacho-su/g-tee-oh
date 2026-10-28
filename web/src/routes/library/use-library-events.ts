/**
 * What the library screen does with each server-sent event (S28, R3.4, R3.5, O-297, O-295).
 *
 * - coverage_added: when it is for the configuration on screen, the configuration's pairs list is
 *   refetched (a preflop build changes availability) and, when it is also the selected pair, so
 *   is that pair's coverage; the newest such event becomes the live note.
 * - builder_state: folded into the cached builder status as a new object (applyBuilderState).
 * - build_progress (admins only): the latest one is kept for BuilderHealth.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { BuilderStatus } from "../../contracts.js";
import type { BuildProgressEvent, CoverageAddedEvent } from "../../library/events.js";
import { BUILDER_STATUS_KEY, coverageKey } from "../../library/queries.js";
import { applyBuilderState } from "../../library/use-builder.js";
import { useServerEvents, type StreamStatus } from "../../library/use-server-events.js";
import { CATALOG_QUERY_ROOT } from "../../study/queries.js";

export interface LibraryEvents {
  status: StreamStatus;
  reconnect: () => void;
  latestCoverage: CoverageAddedEvent | null;
  progress: BuildProgressEvent | null;
}

export function useLibraryEvents(configId: string | undefined, pair: string | undefined): LibraryEvents {
  const queryClient = useQueryClient();
  const [latestCoverage, setLatestCoverage] = useState<CoverageAddedEvent | null>(null);
  const [progress, setProgress] = useState<BuildProgressEvent | null>(null);
  const stream = useServerEvents({
    onCoverageAdded: (event) => {
      if (event.config_id !== configId) return;
      setLatestCoverage(event);
      void queryClient.invalidateQueries({ queryKey: [CATALOG_QUERY_ROOT, "pairs", event.config_id] });
      if (event.pair === pair) void queryClient.invalidateQueries({ queryKey: coverageKey(event.config_id, event.pair) });
    },
    onBuilderState: (event) => {
      queryClient.setQueryData<BuilderStatus>(BUILDER_STATUS_KEY, (status) =>
        status === undefined ? status : applyBuilderState(status, event),
      );
    },
    onBuildProgress: setProgress,
  });
  return { ...stream, latestCoverage, progress };
}
