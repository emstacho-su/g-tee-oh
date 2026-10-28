/**
 * URL updates for the study screen (S25, R3.12, O-286, O-287). The URL is the screen's state, so
 * every control changes it through the router: filter, mode and hand changes replace the history
 * entry (they are refinements of the same view), while line steps are links that push, so browser
 * back steps up the line. A change that opens another node marks a node switch request first
 * (node-switch-metrics.ts). A failed navigation is logged with no URL or search content.
 */
import { useNavigate } from "@tanstack/react-router";

import { describeFailureForLog } from "../api/http-status.js";
import type { MatrixMode } from "../components/range-matrix/model.js";
import { withFilter, withHand, withMode, type FilterKey } from "./filters.js";
import { useNodeSwitchMetrics } from "./node-switch-metrics.js";
import type { StudySearch } from "./search.js";

export interface StudyNavigation {
  setFilter: (key: FilterKey, raw: string) => void;
  setMode: (mode: MatrixMode) => void;
  setHand: (hand: string) => void;
}

export function useStudyNavigation(search: StudySearch): StudyNavigation {
  const navigate = useNavigate();
  const metrics = useNodeSwitchMetrics();

  function replaceWith(next: StudySearch): void {
    navigate({ to: "/study", search: next, replace: true }).catch((error: unknown) => {
      console.error(`g-tee-oh: the study navigation failed (${describeFailureForLog(error)})`);
    });
  }

  return {
    setFilter: (key, raw) => {
      const next = withFilter(search, key, raw);
      if (next.pair !== undefined) metrics.markRequest();
      replaceWith(next);
    },
    setMode: (mode) => replaceWith(withMode(search, mode)),
    setHand: (hand) => replaceWith(withHand(search, hand)),
  };
}
