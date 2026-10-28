/**
 * The screen-reader half of the frequency card (S41, R4.12, O-347, O-367): a visually hidden table
 * with the same numbers as the bars and hand rows. One row for all hands pooled, then one per hand
 * class in the api's order; one column per action holding "your share, the solver's share".
 */
import { formatPercent } from "../../progress/format.js";
import type { FrequencyRow, SpotFrequency } from "../../progress/frequency-model.js";

export interface FrequencyTableProps {
  spot: SpotFrequency;
  pooled: FrequencyRow;
  caption: string;
}

const ALL_HANDS = "All hands";

function Cells({ row, count }: { row: FrequencyRow; count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <td key={index}>
          {formatPercent(row.your_freq[index] ?? 0)}, {formatPercent(row.solver_freq[index] ?? 0)}
        </td>
      ))}
    </>
  );
}

export function FrequencyTable({ spot, pooled, caption }: FrequencyTableProps) {
  const count = spot.actions.length;
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Hands</th>
          <th scope="col">Decisions</th>
          {spot.actions.map((action) => (
            <th key={action.index} scope="col">
              {action.label}: you, solver
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">{ALL_HANDS}</th>
          <td>{spot.decisions}</td>
          <Cells row={pooled} count={count} />
        </tr>
        {spot.hands.map((hand) => (
          <tr key={hand.hand_class}>
            <th scope="row">{hand.hand_class}</th>
            <td>{hand.decisions}</td>
            <Cells row={hand} count={count} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}
