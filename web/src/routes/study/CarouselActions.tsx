/**
 * The selected seat's actions, dropped down under the position carousel (S39, R3.12, O-354,
 * O-280, O-395, O-397). Every action is a button. One that opens a preflop child opens the child
 * line (a history push that marks a node switch request, through the caller). Two kinds stay
 * visible and focusable but aria-disabled, with the reason written inside: one whose next_node_key
 * is null ("Ends the solution"), and one whose child is a postflop node ("Postflop study arrives
 * in v1.5", review round 1; the street comes from reading the child, never from the key grammar).
 * A child whose street is not known yet stays enabled. The action whose child line is the node's
 * next_likely_line says "next likely" (its node is already prefetched, O-286). Each button carries
 * a swatch in the action's matrix colour beside its exact-size label, so the colour is never the
 * only signal.
 */
import { Button } from "../../components/ui/index.js";
import type { NodeAction, StudyNode } from "../../contracts.js";
import { exactActionLabel } from "../../poker/format.js";
import { useThemeStore } from "../../store/theme.js";
import { childLine } from "../../study/line.js";
import type { ChildStreets } from "../../study/use-line-nodes.js";
import { actionColor } from "../../theme/action-style.js";
import { POSTFLOP_V15 } from "./StudyNotices.js";

export const ACTION_TEXT = {
  endsSolution: "Ends the solution",
  nextLikely: "next likely",
  postflop: POSTFLOP_V15,
} as const;

export interface CarouselActionsProps {
  id: string;
  node: Pick<StudyNode, "to_act" | "actions" | "next_likely_line">;
  line: string | undefined;
  childStreets: ChildStreets;
  onOpenLine: (line: string) => void;
}

interface ActionButtonProps {
  action: NodeAction;
  actions: readonly NodeAction[];
  line: string | undefined;
  nextLikelyLine: string | null;
  childStreets: ChildStreets;
  onOpenLine: (line: string) => void;
}

/** Why the action cannot be followed, or undefined when it opens a preflop node. */
function blockedReason(action: NodeAction, childStreets: ChildStreets): string | undefined {
  if (action.next_node_key === null) return ACTION_TEXT.endsSolution;
  const street = childStreets.get(action.token);
  return street === undefined || street === "preflop" ? undefined : ACTION_TEXT.postflop;
}

function ActionButton({ action, actions, line, nextLikelyLine, childStreets, onOpenLine }: ActionButtonProps) {
  const theme = useThemeStore((state) => state.theme);
  const blocked = blockedReason(action, childStreets);
  const child = childLine(line, action.token);
  const nextLikely = blocked === undefined && child === nextLikelyLine;
  const note = blocked ?? (nextLikely ? ACTION_TEXT.nextLikely : undefined);
  return (
    <li>
      <Button
        size="sm"
        variant={nextLikely ? "primary" : "secondary"}
        aria-disabled={blocked === undefined ? undefined : true}
        data-next-likely={nextLikely ? "true" : "false"}
        onClick={() => {
          if (blocked === undefined) onOpenLine(child);
        }}
        className="h-auto min-h-8 py-1 aria-disabled:cursor-not-allowed aria-disabled:border-dashed"
      >
        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: actionColor(action, actions, theme) }} />
        <span>{exactActionLabel(action)}</span>
        {note === undefined ? null : (
          <span className="text-xs font-normal">
            <span className="sr-only">, </span>
            {note}
          </span>
        )}
      </Button>
    </li>
  );
}

export function CarouselActions({ id, node, line, childStreets, onOpenLine }: CarouselActionsProps) {
  return (
    <div id={id} role="region" aria-label={`${node.to_act}'s actions`} className="rounded-xl bg-surface-sunken p-2">
      <ul className="flex flex-wrap gap-2">
        {node.actions.map((action) => (
          <ActionButton
            key={action.index}
            action={action}
            actions={node.actions}
            line={line}
            nextLikelyLine={node.next_likely_line}
            childStreets={childStreets}
            onOpenLine={onOpenLine}
          />
        ))}
      </ul>
    </div>
  );
}
