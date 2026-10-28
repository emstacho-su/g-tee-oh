/**
 * The node's actions as line steps (S25, R3.12, O-280, ADR 0020). Each tree action with a
 * next_node_key is a link to the child line (the line plus its token), which pushes a history
 * entry and marks a node switch request (O-287); an action whose next_node_key is null ends the
 * solution and is shown as text saying so, never as a control. The action whose child line is
 * the node's next_likely_line carries a "next likely" label (its node is already prefetched,
 * O-286). Labels are the exact-size labels the actions table uses.
 */
import { Link } from "@tanstack/react-router";

import type { NodeAction, StudyNode } from "../../contracts.js";
import { exactActionLabel } from "../../poker/format.js";
import { withLine } from "../../study/filters.js";
import { childLine } from "../../study/line.js";
import { useNodeSwitchMetrics } from "../../study/node-switch-metrics.js";
import type { StudySearch } from "../../study/search.js";

export const NEXT_LIKELY_LABEL = "next likely";

export interface LineActionsProps {
  node: Pick<StudyNode, "actions" | "next_likely_line">;
  search: StudySearch;
}

interface LineActionProps {
  action: NodeAction;
  search: StudySearch;
  nextLikelyLine: string | null;
}

function LineAction({ action, search, nextLikelyLine }: LineActionProps) {
  const metrics = useNodeSwitchMetrics();
  const label = exactActionLabel(action);
  if (action.next_node_key === null) {
    return (
      <li className="flex items-center gap-2">
        <span>{label}</span>
        <span className="text-xs text-muted">ends the line</span>
      </li>
    );
  }
  const line = childLine(search.line, action.token);
  const nextLikely = line === nextLikelyLine;
  return (
    <li>
      <Link
        to="/study"
        search={withLine(search, line)}
        onClick={() => metrics.markRequest()}
        data-next-likely={nextLikely ? "true" : "false"}
        className="text-accent underline-offset-2 hover:underline"
      >
        {nextLikely ? `${label}, ${NEXT_LIKELY_LABEL}` : label}
      </Link>
    </li>
  );
}

export function LineActions({ node, search }: LineActionsProps) {
  return (
    <section aria-label="Line steps" className="text-sm">
      <h2 className="mb-1 font-semibold">Follow an action</h2>
      <ul aria-label="Actions at this node" className="flex flex-col gap-1">
        {node.actions.map((action) => (
          <LineAction key={action.index} action={action} search={search} nextLikelyLine={node.next_likely_line} />
        ))}
      </ul>
    </section>
  );
}
