/**
 * The table of a trainer prompt (S25, R3.13, O-57, O-281, A7 section 3): the synthetic banner when
 * the prompt's solution is synthetic test data, the PokerTable with the seats from the prompt
 * (prompt-seats.ts) and the board in its center, and the action so far as an ordered list. Every
 * amount is the api's, only formatted (ADR 0004).
 */
import { useId } from "react";

import { BoardReveal, PokerTable } from "../../components/table/index.js";
import { SyntheticBanner } from "../../components/ui/index.js";
import type { TrainerPrompt } from "../../contracts.js";
import { seatsOfPrompt } from "../../trainer/prompt-seats.js";

export interface SpotTableProps {
  prompt: TrainerPrompt;
}

export function SpotTable({ prompt }: SpotTableProps) {
  const historyId = useId();
  return (
    <div className="flex flex-col gap-3">
      {prompt.synthetic ? <SyntheticBanner /> : null}
      <PokerTable seats={seatsOfPrompt(prompt)} potCbb={prompt.pot_cbb} center={<BoardReveal cards={prompt.board} />} />
      <div>
        <h2 id={historyId} className="text-sm font-semibold text-muted">
          Action so far
        </h2>
        <ol aria-labelledby={historyId} className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {prompt.history.length === 0 ? <li>No action yet</li> : null}
          {prompt.history.map((entry, step) => (
            <li key={`${step}-${entry.position}`}>{`${entry.position} ${entry.label}`}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
