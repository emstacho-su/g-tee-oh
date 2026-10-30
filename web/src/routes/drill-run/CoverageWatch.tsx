/**
 * Start again when the library catches up (S47, R3.4, ADR 0018): after POST /sessions refused a
 * drill with 422 no-coverage, this watches the api's event stream (library/use-server-events.ts)
 * for a coverage_added on a spot the drill reaches, and offers Start only once the library shows
 * the drill now reaches a covered spot, so nothing polls and Start is offered the moment it can
 * succeed.
 *
 * Mechanism (PR #48 review MEDIUM 4): every event is queued, so one that arrives before the
 * configuration list has loaded is checked once it has, never dropped. A queued event counts when
 * its configuration is one the drill reaches and its pair is one of the drill's pairs (matched by
 * the unordered seat set, reach-model.ts pairKeyOf, so the web applies no ordering rule). For such
 * an event the configuration's pairs are read again; only when that read marks one of the drill's
 * pairs preflop_available is the screen told, and the refusal cleared. Otherwise it keeps watching.
 *
 * It is mounted only while the refusal is on screen: the api allows four streams per user, so a
 * drill screen holds one only when it is waiting on the builder.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { describeFailureForLog } from "../../api/http-status.js";
import { useAppApi } from "../../auth/index.js";
import { configsReached, pairKeyOf, pairKeys } from "../../drills/reach-model.js";
import type { CoverageAddedEvent } from "../../library/events.js";
import { useServerEvents } from "../../library/use-server-events.js";
import { practicePairsQuery } from "../../practice/catalog-spot.js";
import { capitalize, configurationWords, pairWords } from "../../progress/spot-words.js";
import type { GameConfig } from "../../progress/types.js";
import type { Drill } from "../../trainer/session-types.js";
import { allConfigsQuery } from "../settings/configs-query.js";

export const COVERAGE_WATCH_TEXT = {
  waiting: "Watching the library: Start is offered again as soon as the builder adds one of this drill's spots.",
  added: (pair: string, config: GameConfig | undefined) =>
    `The library just added ${capitalize(pairWords(pair))} at ${configurationWords(config)}. Start again.`,
} as const;

const PAIR_SEPARATOR = "-";

export interface CoverageWatchProps {
  drill: Drill;
  /** A spot the drill reaches is now covered; the screen clears the refusal and shows the text. */
  onCoverage: (text: string) => void;
}

/** The event's pair as a seat-set key, or null when it is not two seats. */
function eventPairKey(event: CoverageAddedEvent): string | null {
  const seats = event.pair.split(PAIR_SEPARATOR);
  const [first, second] = seats;
  return seats.length === 2 && first !== undefined && second !== undefined ? pairKeyOf(first, second) : null;
}

export function CoverageWatch({ drill, onCoverage }: CoverageWatchProps) {
  const api = useAppApi();
  const queryClient = useQueryClient();
  const configs = useQuery(allConfigsQuery(api));
  const [queued, setQueued] = useState<readonly CoverageAddedEvent[]>([]);
  useServerEvents({ onCoverageAdded: (event) => setQueued((current) => [...current, event]) });

  useEffect(() => {
    if (configs.data === undefined || queued.length === 0) return;
    const batch = queued;
    setQueued((current) => current.filter((event) => !batch.includes(event)));
    const filter = drill.spot_filter;
    const reached = configsReached(filter, configs.data);
    const drillPairs = new Set(pairKeys(filter.game_config.table_size, filter.hero_positions, filter.villain_positions));
    for (const event of batch) {
      const config = reached.find((entry) => entry.config_id === event.config_id);
      const key = eventPairKey(event);
      if (config === undefined || key === null || !drillPairs.has(key)) continue;
      // The pairs read again, fresh: Start is offered only when it shows one of the drill's pairs covered.
      queryClient
        .fetchQuery({ ...practicePairsQuery(api, config.config_id), staleTime: 0 })
        .then((pairs) => {
          const nowCovered = pairs.some((pair) => pair.preflop_available && drillPairs.has(pairKeyOf(pair.oop, pair.ip)));
          if (nowCovered) onCoverage(COVERAGE_WATCH_TEXT.added(event.pair, config));
        })
        .catch((error: unknown) => {
          // A failed re-read keeps the watch running; the next event tries again.
          console.error(`g-tee-oh: re-reading the pairs after coverage_added failed (${describeFailureForLog(error)})`);
        });
    }
  }, [queued, configs.data, drill.spot_filter, api, queryClient, onCoverage]);

  return (
    <p role="status" data-testid="coverage-watch" className="text-sm text-muted">
      {COVERAGE_WATCH_TEXT.waiting}
    </p>
  );
}
