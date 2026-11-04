/**
 * The Compare tab of the study screen's right column (S45 follow-up, R3.26, item 10, O-462): for the
 * hand (hovered or selected), every action with the loss solver-query serves against the best
 * action, in percent of the pot (loss_pct_pot, ADR 0024's Best), and a button per action that
 * opens Compare to Best on the matrix for it. Nothing is subtracted here (ADR 0004): the losses are
 * the api's, only formatted. Without a hand it asks for one; a hand with no row says it is not in
 * the range.
 */
import { memo } from "react";

import { ActionSwatch } from "../../components/trainer/ActionSwatch.js";
import { Button } from "../../components/ui/index.js";
import type { StudyNode } from "../../contracts.js";
import { exactActionLabel, formatPercent } from "../../poker/format.js";
import { COMPARE_NEUTRAL_PCT_POT } from "../../components/range-matrix/scales.js";

export const COMPARE_TEXT = {
  pick: "Pick a cell in the matrix to see what each action gives up against the best.",
  list: (hand: string) => `${hand} against the best action`,
  best: "the best action",
  behind: (loss: string) => `${loss} of the pot behind the best`,
  show: (name: string) => `Compare ${name} on the matrix`,
  notInRange: (hand: string) => `${hand} is not in the range at this node.`,
} as const;

const LOSS_DECIMALS = 2;

export interface CompareTabProps {
  node: Pick<StudyNode, "actions" | "hands">;
  hand: string | undefined;
  onCompare: (index: number) => void;
}

export const CompareTab = memo(function CompareTab({ node, hand, onCompare }: CompareTabProps) {
  if (hand === undefined) return <p className="text-sm text-muted">{COMPARE_TEXT.pick}</p>;
  const row = node.hands.find((candidate) => candidate.hand === hand);
  if (row === undefined) return <p className="text-sm text-muted">{COMPARE_TEXT.notInRange(hand)}</p>;
  return (
    <ul aria-label={COMPARE_TEXT.list(hand)} className="flex flex-col gap-2 text-sm">
      {node.actions.map((action, position) => {
        const loss = row.loss_pct_pot[position] ?? 0;
        const name = exactActionLabel(action);
        const text = loss < COMPARE_NEUTRAL_PCT_POT ? COMPARE_TEXT.best : COMPARE_TEXT.behind(formatPercent(loss, LOSS_DECIMALS));
        return (
          <li key={action.index} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-sunken/60 px-3 py-2">
            <span className="flex items-center gap-2">
              <ActionSwatch action={action} actions={node.actions} />
              <span>{`${name}: ${text}`}</span>
            </span>
            <Button size="sm" aria-label={COMPARE_TEXT.show(name)} onClick={() => onCompare(action.index)}>
              Show on matrix
            </Button>
          </li>
        );
      })}
    </ul>
  );
});
