/**
 * The gap request of the coverage view (S28, R3.4, O-240, O-232, ADR 0018).
 *
 * Mechanism: one intent mutation (use-intent-mutation.ts) per selected spot, so a double click
 * sends one request and a retry after a failure reuses its Idempotency-Key. The 202 answer is
 * kept for the screen to show (with its queue position when queued), and the spot's coverage read
 * is invalidated so the queue table shows the new order. The request returns as soon as the api
 * has raised the build or recorded the request; nothing here waits on a solve. The owner
 * (CoveragePanel) is keyed by configuration and pair, so a new spot starts with no answer, no
 * error and no held key (PR #28 review M2).
 */
import { useQueryClient } from "@tanstack/react-query";

import type { AppApi } from "../api/index.js";
import { coverageKey, requestCoverage, type CoverageRequestResult } from "./queries.js";
import { useIntentMutation } from "./use-intent-mutation.js";

export interface GapRequestTarget {
  /** A flop for a postflop gap; absent for a preflop gap. */
  flop?: string;
}

export interface GapRequestState {
  send: (target: GapRequestTarget) => void;
  pending: boolean;
  /** The target of the last request; undefined before any request. */
  target: GapRequestTarget | undefined;
  result: CoverageRequestResult | undefined;
  error: unknown;
}

export function useGapRequest(api: AppApi, configId: string, pair: string): GapRequestState {
  const queryClient = useQueryClient();
  const mutation = useIntentMutation<GapRequestTarget, CoverageRequestResult>({
    run: (target, key) =>
      requestCoverage(api, { config_id: configId, pair, ...(target.flop === undefined ? {} : { flop: target.flop }) }, key),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: coverageKey(configId, pair) });
    },
  });
  return {
    send: mutation.send,
    pending: mutation.busy,
    target: mutation.input,
    result: mutation.result,
    error: mutation.error,
  };
}
