/**
 * The way off a dead end on the study page (S39 review round 1, R3.12, O-354): a line that failed
 * to load, or a postflop node v1 does not serve. Built from the URL's line alone, so it works when
 * no node of the line could be read: "Back one decision" opens the line one token shorter (offered
 * when that is not the root itself), and "Back to the start of this spot" opens the pair's root.
 * Both push, like every carousel step, so browser back returns. At the root there is nothing to
 * step back to and it renders nothing; "Change settings" is the way out there.
 */
import { Button } from "../../components/ui/index.js";
import { LINE_SEPARATOR, lineTokens } from "../../study/line.js";

export const ESCAPE_TEXT = {
  backOne: "Back one decision",
  toStart: "Back to the start of this spot",
} as const;

export interface LineEscapeProps {
  line: string | undefined;
  onOpenLine: (line: string) => void;
}

export function LineEscape({ line, onOpenLine }: LineEscapeProps) {
  const tokens = lineTokens(line);
  if (tokens.length === 0) return null;
  const parent = tokens.slice(0, -1).join(LINE_SEPARATOR);
  return (
    <div className="flex flex-wrap gap-2">
      {parent === "" ? null : (
        <Button size="sm" onClick={() => onOpenLine(parent)}>
          {ESCAPE_TEXT.backOne}
        </Button>
      )}
      <Button size="sm" onClick={() => onOpenLine("")}>
        {ESCAPE_TEXT.toStart}
      </Button>
    </div>
  );
}
