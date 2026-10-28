/**
 * Line helpers for the study screen (S25, R3.12, O-286). A line is the dot-separated action tokens
 * from the pair's root (the contract's pattern ^[a-z][0-9]*(\.[a-z][0-9]*)*$); the root is the
 * empty line. The child line of an action is the line plus its token, the same rule the api walks
 * (services/api study/line-walk.ts), and the breadcrumb is every prefix of the line, so each step
 * back is its own linkable URL. Pure string work; nothing here reads a node.
 */
export const LINE_SEPARATOR = ".";
export const ROOT_STEP_LABEL = "Root";
/** The node-switch log names the root this way (O-287). */
export const ROOT_LOG_LABEL = "root";

export interface BreadcrumbStep {
  readonly label: string;
  /** The line this step opens; "" is the root. */
  readonly line: string;
}

export function lineTokens(line: string | undefined): string[] {
  return line === undefined || line === "" ? [] : line.split(LINE_SEPARATOR);
}

export function childLine(line: string | undefined, token: string): string {
  return line === undefined || line === "" ? token : `${line}${LINE_SEPARATOR}${token}`;
}

export function breadcrumbSteps(line: string | undefined): BreadcrumbStep[] {
  const tokens = lineTokens(line);
  const steps = tokens.map((token, position) => ({
    label: token,
    line: tokens.slice(0, position + 1).join(LINE_SEPARATOR),
  }));
  return [{ label: ROOT_STEP_LABEL, line: "" }, ...steps];
}

export function lineLabel(line: string | undefined): string {
  return line === undefined || line === "" ? ROOT_LOG_LABEL : line;
}
