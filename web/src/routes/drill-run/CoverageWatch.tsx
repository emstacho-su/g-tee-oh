/**
 * Start again when the library catches up (S47, R3.4, ADR 0018): after POST /sessions refused a
 * drill with 422 no-coverage, this watches the api's event stream (library/use-server-events.ts)
 * for a coverage_added on a spot the drill reaches, and offers Start only once the library shows
 * the drill now reaches a covered spot, so nothing polls and Start is offered the moment it can
 * succeed.
 *
 * Mechanism (PR #48 review MEDIUM 4, round 3 MEDIUM 2, 6 and 7, review 4 finding 6, PR #51 review
 * HIGH 2, PR #51 review round 2): once the configuration list has loaded, each configuration the
 * drill reaches is read once, its baseline (a failed read is tried once more after a short pause
 * before an empty baseline stands in). Coverage can land between the refusal and that read answering, so a baseline
 * that already shows one of the drill's pairs covered tells the screen at once. An event counts
 * when its pair is one of the drill's pairs (matched by the unordered seat set, reach-model.ts, so
 * the web applies no ordering rule) and its configuration is one the drill reaches (any other is
 * dropped); it waits until that configuration's baseline is in, then is read again, one read per
 * configuration however many events named it. A drill pair covered now and not in the baseline
 * tells the screen, and clears the refusal; otherwise the read becomes the new baseline and it
 * keeps watching. It tells the screen once, and never after it has left the screen (a cancelled
 * re-read).
 *
 * It is mounted only while the refusal is on screen: the api allows four streams per user, so a
 * drill screen holds one only when it is waiting on the builder.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { describeFailureForLog } from "../../api/http-status.js";
import { useAppApi } from "../../auth/index.js";
import { configsReached, coveredKeys, pairKeyOf, pairKeyOfText, pairKeys } from "../../drills/reach-model.js";
import { useServerEvents } from "../../library/use-server-events.js";
import { practicePairsQuery, type PositionPairEntry } from "../../practice/catalog-spot.js";
import { capitalize, configurationWords, pairWords } from "../../progress/spot-words.js";
import type { GameConfig } from "../../progress/types.js";
import type { Drill } from "../../trainer/session-types.js";
import { allConfigsQuery } from "../settings/configs-query.js";

/** The baseline read's retries and the pause before each: one more read after a short wait. */
export const BASELINE_RETRIES = 1;
export const BASELINE_RETRY_DELAY_MS = 750;

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
  const { table_size: tableSize } = filter.game_config;
  // The drill's pair keys, computed once per seat choice (review 4 finding 6).
  const drillPairs = useMemo(
    () => new Set(pairKeys(tableSize, filter.hero_positions, filter.villain_positions)),
    [tableSize, filter.hero_positions, filter.villain_positions],
  );
  // The screen's latest callback, so a new function each render never re-runs the reads.
  const onCoverageRef = useRef(onCoverage);
  onCoverageRef.current = onCoverage;
  // Configuration ids an event named, waiting for their baseline or their re-read.
  const [queued, setQueued] = useState<readonly string[]>([]);
  // Each reached configuration's drill pairs covered at its last read; set by the first read.
  const baselines = useRef<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
  const [baselineCount, setBaselineCount] = useState(0);
  const baselineStarted = useRef(false);
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

  const drillCoveredIn = useCallback(
    (pairs: readonly PositionPairEntry[]): Set<string> => new Set([...coveredKeys(pairs)].filter((key) => drillPairs.has(key))),
    [drillPairs],
  );
  const announce = useCallback((pair: string, config: GameConfig): void => {
    if (!mounted.current || fired.current) return;
    fired.current = true;
    onCoverageRef.current(COVERAGE_WATCH_TEXT.added(pair, config));
  }, []);
  const setBaseline = useCallback((configId: string, covered: ReadonlySet<string>): void => {
    baselines.current = new Map([...baselines.current, [configId, covered]]);
    setBaselineCount((count) => count + 1);
  }, []);
  const readPairs = useCallback(
    (configId: string) => queryClient.fetchQuery({ ...practicePairsQuery(api, configId), staleTime: 0 }),
    [api, queryClient],
  );
  // The baseline read is the query's own retry, once, after a pause, so a 429 or 503 is not asked
  // again in the same tick (PR #51 review round 2, code review round 1, 6).
  const readBaseline = useCallback(
    (configId: string) => queryClient.fetchQuery({ ...practicePairsQuery(api, configId), staleTime: 0, retry: BASELINE_RETRIES, retryDelay: BASELINE_RETRY_DELAY_MS }),
    [api, queryClient],
  );

  // The baseline: one read of each reached configuration, tried once more when it fails; a drill
  // pair it already shows covered is offered (HIGH 2).
  useEffect(() => {
    if (configs.data === undefined || baselineStarted.current) return;
    baselineStarted.current = true;
    for (const config of configsReached(filter, configs.data)) {
      readBaseline(config.config_id)
        .then((pairs) => {
          const covered = drillCoveredIn(pairs);
          const already = pairs.find((entry) => covered.has(pairKeyOf(entry.oop, entry.ip)));
          if (already !== undefined) announce(already.pair, config);
          setBaseline(config.config_id, covered);
        })
        .catch((error: unknown) => {
          // Both reads failed: without a first read, every drill pair counts as uncovered, so the next event can still offer Start.
          console.error(`g-tee-oh: reading the pairs for the coverage baseline failed twice (${describeFailureForLog(error)})`);
          setBaseline(config.config_id, new Set());
        });
    }
  }, [configs.data, filter, readBaseline, setBaseline, drillCoveredIn, announce]);

  // The events: a configuration with its baseline in is read again, once per batch.
  useEffect(() => {
    if (configs.data === undefined || queued.length === 0) return;
    const reached = configsReached(filter, configs.data);
    const reachedIds = new Set(reached.map((config) => config.config_id));
    const ready = reached.filter((config) => queued.includes(config.config_id) && baselines.current.has(config.config_id));
    const readyIds = new Set(ready.map((config) => config.config_id));
    // A configuration the drill does not reach is dropped; a reached one waits for its baseline (PR #51 review 5).
    if (ready.length > 0 || queued.some((id) => !reachedIds.has(id))) {
      setQueued((current) => current.filter((id) => reachedIds.has(id) && !readyIds.has(id)));
    }
    for (const config of ready) {
      readPairs(config.config_id)
        .then((pairs) => {
          const before = baselines.current.get(config.config_id) ?? new Set<string>();
          const covered = drillCoveredIn(pairs);
          // reach-model's own rule for a covered pair (round 3 MEDIUM 7), counted only when it is new.
          const added = pairs.find((entry) => {
            const key = pairKeyOf(entry.oop, entry.ip);
            return covered.has(key) && !before.has(key);
          });
          if (added === undefined) {
            setBaseline(config.config_id, covered);
            return;
          }
          announce(added.pair, config);
        })
        .catch((error: unknown) => {
          // A failed re-read keeps the watch running; the next event tries again.
          console.error(`g-tee-oh: re-reading the pairs after coverage_added failed (${describeFailureForLog(error)})`);
        });
    }
  }, [queued, baselineCount, configs.data, filter, readPairs, setBaseline, drillCoveredIn, announce]);

  return (
    <p role="status" data-testid="coverage-watch" className="text-sm text-muted">
      {COVERAGE_WATCH_TEXT.waiting}
    </p>
  );
}
