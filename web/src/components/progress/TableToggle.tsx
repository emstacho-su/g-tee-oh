/**
 * The chart or table switch every progress chart carries (S32, R4.12, O-320, A7 section 4): the
 * table holds the same values as the chart, for screen readers and for reading exact figures.
 * A plain button whose words say what a press shows next (no aria-pressed, since the name itself
 * changes).
 */
import { Button } from "../ui/index.js";

export const SHOW_TABLE_TEXT = "Show table";
export const SHOW_CHART_TEXT = "Show chart";

export interface TableToggleProps {
  showTable: boolean;
  onChange: (showTable: boolean) => void;
  /** What the chart is, for the accessible name ("Show table: leak cost trend"). */
  subject: string;
}

export function TableToggle({ showTable, onChange, subject }: TableToggleProps) {
  const text = showTable ? SHOW_CHART_TEXT : SHOW_TABLE_TEXT;
  return (
    <Button size="sm" aria-label={`${text}: ${subject}`} onClick={() => onChange(!showTable)}>
      {text}
    </Button>
  );
}
