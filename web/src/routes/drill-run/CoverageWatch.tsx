/**
 * Start again when the library catches up (S47, R3.4, ADR 0018): after POST /sessions refused a
 * drill with 422 no-coverage, this watches the api's event stream (library/use-server-events.ts)
 * for a coverage_added on a spot the drill reaches, and offers Start only once the library shows
 * the drill now reaches a covered spot, so nothing polls and Start is offered the moment it can
 * succeed.
 *
 * Mechanism (PR #48 review MEDIUM 4, round 3 MEDIUM 2, 6 and 7): an event counts when its pair is
 * one of the drill's pairs (matched by the unordered seat set, reach-model.ts, so the web applies
 * no ordering rule); its configuration is queued. Every configuration the drill reaches is also
 * queued once on mount, so an event that arrived between the refusal and the subscription is not
 * lost. Once the configuration list has loaded (events that came earlier wait in the queue), the
 * queued configurations the drill reaches are read again, one read per configuration however many
 * events named it; only when a read marks one of the drill's pairs preflop_available is the screen
 * told, and the refusal cleared. Otherwise it keeps watching. It tells the screen once, and never
 * after it has left the screen (a cancelled re-read).
 *
 * It is mounted only while the refusal is on screen: the api allows four streams per user, so a
 * drill screen holds one only when it is waiting on the builder.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { describeFailureForLog } from "../../api/http-status.js";
import { useAppApi } from "../../auth/index.js";
import { configsReached, coveredKeys, pairKeyOf, pairKeyOfText, pairKeys } from "../../drills/reach-model.js";
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

export interface CoverageWatchProps {
  drill: Drill;
  /** A spot the drill reaches is now covered; the screen clears the refusal and shows the text. */
  onCoverage: (text: string) => void;
}

export function CoverageWatch({ drill, onCoverage }: CoverageWatchProps) {
  const api = useAppApi();
  const queryClient = useQueryClient();
  const configs = useQuery(allConfigsQuery(api));
  const filter = drill.spot_filter;
  const drillPairs = new Set(pairKeys(filter.game_config.table_size, filter.hero_positions, filter.villain_positions));
  // Configuration ids waiting for a re-read; the mount check queues every reached one once.
  const [queued, setQueued] = useState<readonly string[]>([]);
  const mountChecked = useRef(false);
  useServerEvents({
    onCoverageAdded: (event) => {
      const key = pairKeyOfText(event.pair);
      if (key !== null && drillPairs.has(key)) setQueued((current) => [...current, event.config_id]);
    },
  });
  // A re-read that answers after the watch left the screen, or after one answer already told the
  // screen, does nothing (PR #48 review round 2 HIGH 2): fired once, and cancelled on unmount.
  const mounted = useRef(true);
  const fired = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (configs.data === undefined) return;
    const reached = configsReached(filter, configs.data);
    if (!mountChecked.current) {
      mountChecked.current = true;
      setQueued((current) => [...current, ...reached.map((config) => config.config_id)]);
      return;
    }
    if (queued.length === 0) return;
    const batch = queued;
    setQueued((current) => current.slice(batch.length));
    const keys = new Set(pairKeys(filter.game_config.table_size, filter.hero_positions, filter.villain_positions));
    // One read per configuration, however many events named it (round 3 MEDIUM 6).
    for (const config of reached.filter((entry) => batch.includes(entry.config_id))) {
      queryClient
        .fetchQuery({ ...practicePairsQuery(api, config.config_id), staleTime: 0 })
        .then((pairs) => {
          // reach-model's own rule for a covered pair (round 3 MEDIUM 7), limited to the drill's pairs.
          const covered = coveredKeys(pairs);
          const pair = pairs.find((entry) => {
            const key = pairKeyOf(entry.oop, entry.ip);
            return covered.has(key) && keys.has(key);
          });
          if (pair === undefined || !mounted.current || fired.current) return;
          fired.current = true;
          onCoverage(COVERAGE_WATCH_TEXT.added(pair.pair, config));
        })
        .catch((error: unknown) => {
          // A failed re-read keeps the watch running; the next event tries again.
          console.error(`g-tee-oh: re-reading the pairs after coverage_added failed (${describeFailureForLog(error)})`);
        });
    }
  }, [queued, configs.data, filter, api, queryClient, onCoverage]);

  return (
    <p role="status" data-testid="coverage-watch" className="text-sm text-muted">
      {COVERAGE_WATCH_TEXT.waiting}
    </p>
  );
}
