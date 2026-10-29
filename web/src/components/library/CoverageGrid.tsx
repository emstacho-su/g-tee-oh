/**
 * CoverageGrid (S28, R3.4, A7 sections 2 and 3, O-291, ADR 0018): what the library holds at one
 * configuration. One cell per canonical pair from GET /configs/{id}/pairs says whether its
 * preflop solution is in the library; selecting a cell selects the pair. For the selected pair,
 * CoverageDetail shows the flop families and the build queue from GET /coverage.
 *
 * Color is never the only signal (A7 section 4): every cell says "In the library" or "Not in
 * the library" in words, and an uncovered cell also has a dashed border. The pair reads in words
 * with its token as the tooltip (S47 critic, spot-words.ts).
 *
 * S40 (O-406): the body of the coverage page's "Coverage" card, so it brings no heading of its
 * own. Each cell is a tactile button on the control edge; the selected cell is raised with an
 * accent ring and its aria-pressed state, so the choice never rests on colour alone.
 */
import { capitalize, pairWords } from "../../progress/spot-words.js";
import type { PositionPairEntry } from "../../study/queries.js";
import { cn, CONTROL_EDGE_CLASS, TACTILE_CLASS } from "../ui/index.js";

export const IN_LIBRARY = "In the library";
export const NOT_IN_LIBRARY_TEXT = "Not in the library";

export interface CoverageGridProps {
  pairs: readonly PositionPairEntry[];
  selectedPair: string | undefined;
  onSelectPair: (pair: string) => void;
}

export function CoverageGrid({ pairs, selectedPair, onSelectPair }: CoverageGridProps) {
  const covered = pairs.filter((entry) => entry.preflop_available).length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{`${covered} of ${pairs.length} pairs are in the library at this configuration.`}</p>
      <ul aria-label="Pairs" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {pairs.map((entry) => (
          <li key={entry.pair}>
            <button
              type="button"
              aria-pressed={entry.pair === selectedPair}
              title={entry.pair}
              onClick={() => onSelectPair(entry.pair)}
              className={cn(
                "flex w-full flex-col items-start rounded-xl px-3 py-2 text-left text-sm",
                TACTILE_CLASS,
                entry.preflop_available ? cn(CONTROL_EDGE_CLASS, "bg-surface-raised") : "border border-dashed border-warning bg-surface-sunken",
                entry.pair === selectedPair && "ring-2 ring-accent ring-offset-2 ring-offset-surface-raised",
              )}
            >
              <span className="font-semibold">{capitalize(pairWords(entry.pair))}</span>
              <span className="text-xs text-muted">{entry.preflop_available ? IN_LIBRARY : NOT_IN_LIBRARY_TEXT}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
