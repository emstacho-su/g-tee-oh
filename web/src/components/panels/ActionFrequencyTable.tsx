/**
 * The action frequency table (S24, S38, S45, A7, R3.12 study panel, also used by the feedback panel
 * for R3.13, screen review row 14). A real <table> with a caption, column headers and one row
 * header per action, so screen readers navigate it as a table; on screen it reads as a list.
 *
 * Look (S38): the caption is the heading, with one combined mix bar under it (every action's share
 * side by side, hidden from screen readers, who read the rows); the column headers are visually
 * hidden; each row shows the action's swatch and short letter (color is never the only signal),
 * its name and exact size, a Best chip when highlighted, the frequency as a percent with an inline
 * bar, and the EV (expected value) in big blinds when given. The table does no aggregation: callers
 * pass the numbers the api sent, in action order (ADR 0004). Lists of other lengths, or a frequency
 * outside 0 to 1, render an alert instead of a misleading table.
 *
 * S45 (R3.12, O-468, O-469, design rule 3): with onToggle each row header is a toggle button
 * carrying aria-pressed, so the table is the matrix's filter as well as its legend; combos, when
 * given, print beside the percent ("38.0%, 504 combos", the api's reach-weighted count, never a
 * product made here), and a note under the caption carries the range total. Without those props
 * the table is the read-only one the feedback panel shows.
 *
 * Numbering (O-198): highlightIndexes and pressedIndexes hold NodeAction.index values, the numbering
 * the contract's best_action_indexes carries, and a row is highlighted or pressed when its action's
 * index is listed. frequencies, evBb and combos stay positional (entry i belongs to actions[i]), as
 * the contract defines freq_by_action and ev_by_action. A highlight index that names no action
 * renders an alert, never a highlight on the wrong row.
 */
import { cn } from "../ui/index.js";
import type { NodeAction } from "../../contracts.js";
import { unknownIndexes } from "../../poker/action-index.js";
import { exactActionLabel, formatBb, formatCombos, formatShare } from "../../poker/format.js";
import { ACTION_FILL_CLASSES, ActionSwatch, actionFillStyle } from "../trainer/ActionSwatch.js";

export interface ActionFrequencyTableProps {
  actions: readonly NodeAction[];
  /** One share in 0..1 per action, by position in actions. */
  frequencies: readonly number[];
  /** One EV in big blinds per action, by position in actions. */
  evBb?: readonly number[];
  /** One reach-weighted combo count per action, by position (O-469); null entries print nothing. */
  combos?: readonly (number | null)[];
  /** NodeAction.index values to mark, for example the best actions (O-198). */
  highlightIndexes?: readonly number[];
  highlightLabel?: string;
  caption: string;
  /** A line under the caption, for example the range total (O-469). */
  note?: string;
  /** NodeAction.index values whose rows are pressed filters (O-468); needs onToggle. */
  pressedIndexes?: readonly number[];
  /** Makes each row a toggle button reporting its NodeAction.index (O-468). */
  onToggle?: (index: number) => void;
}

const PERCENT = 100;
const DEFAULT_HIGHLIGHT_LABEL = "Best";

/** The problem with the inputs, or null when they are consistent. */
export function frequencyTableProblem(
  actions: readonly NodeAction[],
  frequencies: readonly number[],
  evBb: readonly number[] | undefined,
  combos?: readonly (number | null)[],
): string | null {
  if (frequencies.length !== actions.length) {
    return `${actions.length} actions but ${frequencies.length} frequencies`;
  }
  if (evBb !== undefined && evBb.length !== actions.length) {
    return `${actions.length} actions but ${evBb.length} EV values`;
  }
  if (combos !== undefined && combos.length !== actions.length) {
    return `${actions.length} actions but ${combos.length} combo counts`;
  }
  const outside = frequencies.find((share) => !Number.isFinite(share) || share < 0 || share > 1);
  return outside === undefined ? null : `frequency ${outside} is outside 0 to 1`;
}

/** The first highlight index that names no action, as a sentence, or null when all are known. */
export function highlightProblem(
  actions: readonly NodeAction[],
  highlightIndexes: readonly number[],
  highlightLabel: string,
): string | null {
  const [unknown] = unknownIndexes(actions, highlightIndexes);
  return unknown === undefined ? null : `${highlightLabel} action ${unknown} is not one of the ${actions.length} actions`;
}

interface MixBarProps {
  actions: readonly NodeAction[];
  frequencies: readonly number[];
}

/** Every action's share side by side in one bar; decoration only, the rows carry the numbers. */
function MixBar({ actions, frequencies }: MixBarProps) {
  return (
    <span
      aria-hidden="true"
      data-testid="frequency-mix"
      className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-surface-sunken"
    >
      {actions.map((action, position) => {
        const share = frequencies[position] ?? 0;
        return share > 0 ? (
          <span
            key={action.index}
            data-testid="frequency-mix-segment"
            style={{ ...actionFillStyle(action, actions), width: `${share * PERCENT}%` }}
            className={cn("block h-full", ACTION_FILL_CLASSES)}
          />
        ) : null;
      })}
    </span>
  );
}

interface RowProps {
  action: NodeAction;
  actions: readonly NodeAction[];
  share: number;
  ev: number | undefined;
  combos: number | null | undefined;
  highlighted: boolean;
  highlightLabel: string;
  pressed: boolean;
  onToggle: ((index: number) => void) | undefined;
}

/** The row header's content: the swatch, the name and the Best chip; a toggle button when the table filters. */
function RowName({ action, actions, highlighted, highlightLabel, pressed, onToggle }: Omit<RowProps, "share" | "ev" | "combos">) {
  const content = (
    <>
      <ActionSwatch action={action} actions={actions} />
      <span className={highlighted ? "font-semibold" : undefined}>{exactActionLabel(action)}</span>
      {highlighted ? (
        <span data-testid="highlight-chip" className="rounded-full bg-accent px-2 text-xs font-semibold text-accent-text">
          {highlightLabel}
        </span>
      ) : null}
    </>
  );
  if (onToggle === undefined) return <span className="flex flex-wrap items-center gap-2">{content}</span>;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onToggle(action.index)}
      className={cn(
        "flex w-full flex-wrap items-center gap-2 rounded-lg px-1 py-0.5 text-left",
        pressed ? "bg-surface-sunken ring-1 ring-border-strong" : "hover:bg-surface-sunken/60",
      )}
    >
      {content}
    </button>
  );
}

function ActionRow(props: RowProps) {
  const { action, actions, share, ev, combos, highlighted, pressed } = props;
  const shareText = combos === null || combos === undefined ? formatShare(share) : `${formatShare(share)}, ${formatCombos(combos)}`;
  return (
    <tr
      data-highlight={highlighted ? "true" : "false"}
      data-pressed={pressed ? "true" : "false"}
      className={cn("align-middle", highlighted && "bg-surface-sunken/70 font-semibold")}
    >
      <th scope="row" className="rounded-l-lg py-1.5 pr-2 pl-2 text-left font-normal">
        <RowName {...props} />
      </th>
      <td className={cn("py-1.5 pr-2", ev === undefined && "rounded-r-lg")}>
        <span className="flex items-center gap-2">
          <span className={cn("text-right tabular-nums", combos === null || combos === undefined ? "w-14" : "w-32")}>{shareText}</span>
          <span aria-hidden="true" className="h-2 min-w-12 flex-1 overflow-hidden rounded-full bg-surface-sunken">
            <span
              data-testid="frequency-bar"
              style={{ ...actionFillStyle(action, actions), width: `${share * PERCENT}%` }}
              className={cn("block h-full", ACTION_FILL_CLASSES)}
            />
          </span>
        </span>
      </td>
      {ev === undefined ? null : <td className="rounded-r-lg py-1.5 pr-2 text-right tabular-nums">{formatBb(ev)}</td>}
    </tr>
  );
}

export function ActionFrequencyTable({
  actions,
  frequencies,
  evBb,
  combos,
  highlightIndexes = [],
  highlightLabel = DEFAULT_HIGHLIGHT_LABEL,
  caption,
  note,
  pressedIndexes = [],
  onToggle,
}: ActionFrequencyTableProps) {
  const problem = frequencyTableProblem(actions, frequencies, evBb, combos) ?? highlightProblem(actions, highlightIndexes, highlightLabel);
  if (problem !== null) {
    return (
      <p role="alert" data-testid="action-frequency-table" className="text-danger">
        {`Cannot show ${caption}: ${problem}.`}
      </p>
    );
  }
  return (
    <table data-testid="action-frequency-table" className="w-full border-separate border-spacing-y-1 text-sm">
      <caption className="pb-1 text-left font-semibold">
        {caption}
        {note === undefined ? null : <span className="block text-xs font-normal text-muted">{note}</span>}
        <MixBar actions={actions} frequencies={frequencies} />
      </caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Action</th>
          <th scope="col">Frequency</th>
          {evBb === undefined ? null : <th scope="col">EV</th>}
        </tr>
      </thead>
      <tbody>
        {actions.map((action, position) => (
          <ActionRow
            key={action.index}
            action={action}
            actions={actions}
            share={frequencies[position] ?? 0}
            ev={evBb?.[position]}
            combos={combos?.[position]}
            highlighted={highlightIndexes.includes(action.index)}
            highlightLabel={highlightLabel}
            pressed={pressedIndexes.includes(action.index)}
            onToggle={onToggle}
          />
        ))}
      </tbody>
    </table>
  );
}
