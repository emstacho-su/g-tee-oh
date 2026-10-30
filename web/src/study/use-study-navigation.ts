/**
 * URL updates for the study screen (S25, S39, R3.12, O-286, O-287, O-392, O-395). The URL is the
 * screen's state, so every control changes it through the router. Mode and hand changes replace
 * the history entry (they refine the same view). Confirming the settings and choosing an action
 * or a seat in the position carousel push one, so browser back returns to the previous spot or
 * step. A change that opens another node marks a node switch request first
 * (node-switch-metrics.ts). A failed navigation is logged with no URL or search content.
 */
import { useNavigate } from "@tanstack/react-router";

import { describeFailureForLog } from "../api/http-status.js";
import type { MatrixMode } from "../components/range-matrix/model.js";
import { withFilters } from "./action-filters.js";
import { withHand, withLens, withLine, withMode } from "./filters.js";
import { useNodeSwitchMetrics } from "./node-switch-metrics.js";
import type { StudySearch } from "./search.js";

export interface StudyNavigation {
  /** Writes confirmed settings (a push). */
  confirm: (next: StudySearch) => void;
  /** Opens another line of the same pair (a push); "" is the root. */
  openLine: (line: string) => void;
  setMode: (mode: MatrixMode) => void;
  setHand: (hand: string) => void;
  /** Compares another action in the compare lens (a replace, S45, R3.24). */
  setLens: (lens: number) => void;
  /** Writes the action filter set (a replace, S45, O-468); with `compare`, also opens Compare to Best on that action. */
  setFilters: (filters: readonly number[], compare?: number) => void;
}

export function useStudyNavigation(search: StudySearch): StudyNavigation {
  const navigate = useNavigate();
  const metrics = useNodeSwitchMetrics();

  function go(next: StudySearch, replace: boolean): void {
    navigate({ to: "/study", search: next, replace }).catch((error: unknown) => {
      console.error(`g-tee-oh: the study navigation failed (${describeFailureForLog(error)})`);
    });
  }

  return {
    confirm: (next) => {
      if (next.pair !== undefined) metrics.markRequest();
      go(next, false);
    },
    openLine: (line) => {
      metrics.markRequest();
      go(withLine(search, line), false);
    },
    setMode: (mode) => go(withMode(search, mode), true),
    setHand: (hand) => go(withHand(search, hand), true),
    setLens: (lens) => go(withLens(search, lens), true),
    setFilters: (filters, compare) => {
      const next = withFilters(search, filters);
      go(compare === undefined ? next : withLens(withMode(next, "compare"), compare), true);
    },
  };
}
