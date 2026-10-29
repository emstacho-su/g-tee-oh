/**
 * The bounded list of an api problem's field errors (S26, R3.14, PR #30 review MEDIUM 1). The
 * import dialog, the export dialog and the builder's alert all list the errors a validation
 * problem carries; DrillProblem (drills/problem.ts) already keeps at most MAX_LISTED_FIELD_ERRORS
 * of them, clipped, and counts the rest, so this list is never long: its lines, then one
 * "and N more" line when errors were left out. Lines may repeat, so they are keyed by position.
 */
import type { FieldError } from "../../drills/types.js";

/**
 * The locations an error path may start with: "body" for a request body field, "drill" for a
 * stored drill's field (the export's 422, PR #30 review MEDIUM 2). The line names the field only.
 */
const LOCATIONS: readonly string[] = ["body", "drill"];

/**
 * A refused import or export (S40, rows 39 and 40): a bordered block on the danger token whose first
 * line starts "Error:", so the refusal is carried by words and the edge, never colour alone (O-366).
 */
export const REFUSAL_CLASSES = "flex flex-col items-start gap-2 rounded-xl border border-danger bg-surface-raised p-3 text-sm";

export function moreErrorsText(omitted: number): string {
  return `and ${omitted} more`;
}

function withoutLocation(path: string): string {
  const location = LOCATIONS.find((name) => path === name || path.startsWith(`${name}.`));
  return location === undefined ? path : path.slice(location.length + 1);
}

/** "spot_filter.stake: message", with the location ("body." or "drill.") left out. */
export function fieldErrorLine({ path, message }: FieldError): string {
  const inner = withoutLocation(path);
  return inner === "" ? message : `${inner}: ${message}`;
}

export interface ErrorListProps {
  lines: readonly string[];
  omitted: number;
}

export function ErrorList({ lines, omitted }: ErrorListProps) {
  if (lines.length === 0 && omitted === 0) return null;
  return (
    <ul className="list-disc pl-5">
      {lines.map((line, position) => (
        <li key={position}>{line}</li>
      ))}
      {omitted > 0 ? <li>{moreErrorsText(omitted)}</li> : null}
    </ul>
  );
}
