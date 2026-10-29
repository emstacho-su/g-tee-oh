/**
 * Start again when the library catches up (S47, R3.4, ADR 0018): after POST /sessions refused a
 * drill with 422 no-coverage, this watches the api's event stream (library/use-server-events.ts)
 * for a coverage_added on a configuration the drill reaches and, when one arrives, refreshes that
 * configuration's pairs read, tells the run screen (which clears the refusal) and says in words
 * what was added, so nothing polls and Start is offered the moment it can succeed.
 *
 * It is mounted only while the refusal is on screen: the api allows four streams per user, so a
 * drill screen holds one only when it is waiting on the builder.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAppApi } from "../../auth/index.js";
import { configsReached } from "../../drills/reach-model.js";
import type { CoverageAddedEvent } from "../../library/events.js";
import { useServerEvents } from "../../library/use-server-events.js";
import { PRACTICE_PAIRS_KEY_ROOT } from "../../practice/catalog-spot.js";
import { capitalize, configurationWords, pairWords } from "../../progress/spot-words.js";
import type { GameConfig } from "../../progress/types.js";
import { allConfigsQuery } from "../settings/configs-query.js";
import type { Drill } from "../../trainer/session-types.js";

export const COVERAGE_WATCH_TEXT = {
  waiting: "Watching the library: Start is offered again as soon as the builder adds one of this drill's spots.",
  added: (pair: string, config: GameConfig | undefined, configId: string) =>
    `The library just added ${capitalize(pairWords(pair))} at ${configurationWords(config, configId)}. Start again.`,
} as const;

export interface CoverageWatchProps {
  drill: Drill;
  /** A spot the drill reaches was added; the screen clears the refusal and shows the text. */
  onCoverage: (text: string) => void;
}

export function CoverageWatch({ drill, onCoverage }: CoverageWatchProps) {
  const api = useAppApi();
  const queryClient = useQueryClient();
  const configs = useQuery(allConfigsQuery(api));
  const [seen, setSeen] = useState<CoverageAddedEvent | null>(null);
  useServerEvents({
    onCoverageAdded: (event) => {
      const list = configs.data ?? [];
      const reached = configsReached(drill.spot_filter, list);
      const config = reached.find((entry) => entry.config_id === event.config_id);
      if (config === undefined) return;
      void queryClient.invalidateQueries({ queryKey: [PRACTICE_PAIRS_KEY_ROOT, "pairs", event.config_id] });
      setSeen(event);
      onCoverage(COVERAGE_WATCH_TEXT.added(event.pair, config, event.config_id));
    },
  });
  return (
    <p role="status" data-testid="coverage-watch" className="text-sm text-muted">
      {seen === null ? COVERAGE_WATCH_TEXT.waiting : ""}
    </p>
  );
}
