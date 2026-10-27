/**
 * The action frequency table (S24, A7, R3.12 study panel, also used by the feedback panel for
 * R3.13). A real <table> with a caption, column headers and one row header per action, so screen
 * readers navigate it as a table.
 *
 * Each row shows the action's swatch and short letter (color is never the only signal), its name
 * and exact size, the frequency as a percent with an inline bar, and the EV (expected value) in
 * big blinds when given. Highlighted rows say so in text ("Best" by default). The table does no
 * aggregation: callers pass the numbers the api sent, in action order (ADR 0004). Lists of other
 * lengths, or a frequency outside 0 to 1, render an alert instead of a misleading table.
 */
import { cn } from "../ui/index.js";
import type { NodeAction } from "../../contracts.js";
import { exactActionLabel, formatBb, formatShare } from "../../poker/format.js";
import { ACTION_FILL_CLASSES, ActionSwatch, actionFillStyle } from "../trainer/ActionSwatch.js";

export interface ActionFrequencyTableProps {
  actions: readonly NodeAction[];
  /** One share in 0..1 per action, in the same order. */
  frequencies: readonly number[];
  /** One EV in big blinds per action, in the same order. */
  evBb?: readonly number[];
  /** Positions in actions to mark, for example the best actions. */
  highlightIndexes?: readonly number[];
  highlightLabel?: string;
  caption: string;
}

const PERCENT = 100;
const DEFAULT_HIGHLIGHT_LABEL = "Best";

/** The problem with the inputs, or null when they are consistent. */
export function frequencyTableProblem(
  actions: readonly NodeAction[],
  frequencies: readonly number[],
  evBb: readonly number[] | undefined,
): string | null {
  if (frequencies.length !== actions.length) {
    return `${actions.length} actions but ${frequencies.length} frequencies`;
  }
  if (evBb !== undefined && evBb.length !== actions.length) {
    return `${actions.length} actions but ${evBb.length} EV values`;
  }
  const outside = frequencies.find((share) => !Number.isFinite(share) || share < 0 || share > 1);
  return outside === undefined ? null : `frequency ${outside} is outside 0 to 1`;
}

export function ActionFrequencyTable({
  actions,
  frequencies,
  evBb,
  highlightIndexes = [],
  highlightLabel = DEFAULT_HIGHLIGHT_LABEL,
  caption,
}: ActionFrequencyTableProps) {
  const problem = frequencyTableProblem(actions, frequencies, evBb);
  if (problem !== null) {
    return (
      <p role="alert" data-testid="action-frequency-table" className="text-danger">
        {`Cannot show ${caption}: ${problem}.`}
      </p>
    );
  }
  return (
    <table data-testid="action-frequency-table" className="w-full border-collapse text-sm">
      <caption className="pb-1 text-left font-semibold">{caption}</caption>
      <thead>
        <tr className="border-b border-border text-left text-muted">
          <th scope="col" className="py-1 font-medium">
            Action
          </th>
          <th scope="col" className="py-1 font-medium">
            Frequency
          </th>
          {evBb === undefined ? null : (
            <th scope="col" className="py-1 text-right font-medium">
              EV
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {actions.map((action, position) => {
          const share = frequencies[position] ?? 0;
          const highlighted = highlightIndexes.includes(position);
          const ev = evBb?.[position];
          return (
            <tr
              key={action.index}
              data-highlight={highlighted ? "true" : "false"}
              className={cn("border-b border-border/60", highlighted && "bg-surface-sunken font-semibold")}
            >
              <th scope="row" className="py-1 text-left font-normal">
                <span className="flex items-center gap-2">
                  <ActionSwatch action={action} actions={actions} />
                  <span>{exactActionLabel(action)}</span>
                  {highlighted ? (
                    <span className="rounded bg-accent px-1 text-xs text-accent-text">{highlightLabel}</span>
                  ) : null}
                </span>
              </th>
              <td className="py-1">
                <span className="flex items-center gap-2">
                  <span className="w-14 text-right tabular-nums">{formatShare(share)}</span>
                  <span aria-hidden="true" className="h-2.5 flex-1 overflow-hidden rounded bg-surface-sunken">
                    <span
                      data-testid="frequency-bar"
                      style={{ ...actionFillStyle(action, actions), width: `${share * PERCENT}%` }}
                      className={cn("block h-full", ACTION_FILL_CLASSES)}
                    />
                  </span>
                </span>
              </td>
              {ev === undefined ? null : <td className="py-1 text-right tabular-nums">{formatBb(ev)}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
