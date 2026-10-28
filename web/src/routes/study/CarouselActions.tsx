/**
 * The selected seat's actions, dropped down under the position carousel (S39, R3.12, O-354,
 * O-280, O-395). Every action is a button: one with a next_node_key opens the child line (a
 * history push that marks a node switch request, through the caller), and one whose next_node_key
 * is null ends the solution, so it stays visible and focusable but aria-disabled, with "Ends the
 * solution" written inside it. The action whose child line is the node's next_likely_line says
 * "next likely" (its node is already prefetched, O-286). Each button carries a swatch in the
 * action's matrix colour beside its exact-size label, so the colour is never the only signal.
 */
import { Button } from "../../components/ui/index.js";
import type { NodeAction, StudyNode } from "../../contracts.js";
import { exactActionLabel } from "../../poker/format.js";
import { useThemeStore } from "../../store/theme.js";
import { childLine } from "../../study/line.js";
import { actionColor } from "../../theme/action-style.js";

export const ACTION_TEXT = {
  endsSolution: "Ends the solution",
  nextLikely: "next likely",
} as const;

export interface CarouselActionsProps {
  id: string;
  node: Pick<StudyNode, "to_act" | "actions" | "next_likely_line">;
  line: string | undefined;
  onOpenLine: (line: string) => void;
}

interface ActionButtonProps {
  action: NodeAction;
  actions: readonly NodeAction[];
  line: string | undefined;
  nextLikelyLine: string | null;
  onOpenLine: (line: string) => void;
}

function ActionButton({ action, actions, line, nextLikelyLine, onOpenLine }: ActionButtonProps) {
  const theme = useThemeStore((state) => state.theme);
  const ends = action.next_node_key === null;
  const child = childLine(line, action.token);
  const note = ends ? ACTION_TEXT.endsSolution : child === nextLikelyLine ? ACTION_TEXT.nextLikely : undefined;
  return (
    <li>
      <Button
        size="sm"
        variant={note === ACTION_TEXT.nextLikely ? "primary" : "secondary"}
        aria-disabled={ends ? true : undefined}
        data-next-likely={note === ACTION_TEXT.nextLikely ? "true" : "false"}
        onClick={() => {
          if (!ends) onOpenLine(child);
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

export function CarouselActions({ id, node, line, onOpenLine }: CarouselActionsProps) {
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
            onOpenLine={onOpenLine}
          />
        ))}
      </ul>
    </div>
  );
}
