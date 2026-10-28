/**
 * The gap request of the coverage view (S28, R3.4, O-240, ADR 0018).
 *
 * Mechanism: one mutation per selected spot. A request carries a fresh Idempotency-Key, so a
 * double click replays the first answer rather than raising twice. The 202 answer is kept for
 * the screen to show (with its queue position when queued), and the spot's coverage read is
 * invalidated so the queue table shows the new order. The request returns as soon as the api has
 * raised the build or recorded the request; nothing here waits on a solve. Changing the selected
 * spot clears the previous answer.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { AppApi } from "../api/index.js";
import { useLibraryDeps } from "./library-deps.js";
import { coverageKey, requestCoverage, type CoverageRequestResult } from "./queries.js";

export interface GapRequestTarget {
  /** A flop for a postflop gap; absent for a preflop gap. */
  flop?: string;
}

export interface GapRequestState {
  send: (target: GapRequestTarget) => void;
  pending: boolean;
  /** The flop of the last request, or null for a preflop gap; undefined before any request. */
  target: GapRequestTarget | undefined;
  result: CoverageRequestResult | undefined;
  error: unknown;
}

export function useGapRequest(api: AppApi, configId: string, pair: string): GapRequestState {
  const queryClient = useQueryClient();
  const { newKey } = useLibraryDeps();
  const mutation = useMutation<CoverageRequestResult, Error, GapRequestTarget>({
    mutationFn: (target) =>
      requestCoverage(api, { config_id: configId, pair, ...(target.flop === undefined ? {} : { flop: target.flop }) }, newKey()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: coverageKey(configId, pair) });
    },
  });
  const { reset } = mutation;

  useEffect(() => {
    reset();
  }, [configId, pair, reset]);

  return {
    send: (target) => mutation.mutate(target),
    pending: mutation.isPending,
    target: mutation.variables,
    result: mutation.data,
    error: mutation.error,
  };
}
