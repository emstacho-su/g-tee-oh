/**
 * The covered-part notes of the drill run screen (S26, R3.14, O-312, ADR 0018). Nothing here waits
 * on a solve: the library is built in the background and the session runs on what it holds.
 *
 * - CoverageNote: when POST /sessions answered coverage with pairs_queued above zero, the session
 *   runs on the covered part and the note says "Running on X of Y spots; Z queued for the builder"
 *   with a link to /library. A fully covered drill, or a session answer without coverage, shows
 *   nothing.
 * - NoCoverageNote: when POST /sessions refused a fully uncovered drill (422 no-coverage), the
 *   alert above says so in fixed text; this note adds the queued count the 422 named (read into
 *   SpotProblem.queued, never the detail text itself) and the same link.
 * The link is a plain anchor, so the notes render outside the router too (the screen's tests).
 */
import type { SessionCoverage } from "../../trainer/session-types.js";
import type { SpotProblem } from "../../trainer/spot-problem.js";
import { LIBRARY_PATH, SESSION_TEXT } from "./labels.js";

const NOTE_CLASSES = "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface-raised px-3 py-2 text-sm";

function LibraryLink() {
  return (
    <a href={LIBRARY_PATH} className="font-medium underline">
      {SESSION_TEXT.openLibrary}
    </a>
  );
}

export interface CoverageNoteProps {
  coverage: SessionCoverage | undefined;
}

export function CoverageNote({ coverage }: CoverageNoteProps) {
  if (coverage === undefined || coverage.pairs_queued <= 0) return null;
  return (
    <p data-testid="coverage-note" className={NOTE_CLASSES}>
      <span>{`Running on ${coverage.pairs_covered} of ${coverage.pairs_total} spots; ${coverage.pairs_queued} queued for the builder.`}</span>
      <LibraryLink />
    </p>
  );
}

export interface NoCoverageNoteProps {
  problem: SpotProblem;
}

export function NoCoverageNote({ problem }: NoCoverageNoteProps) {
  if (problem.kind !== "no_coverage") return null;
  const { queued } = problem;
  return (
    <p data-testid="no-coverage-note" className={NOTE_CLASSES}>
      {queued === undefined ? null : <span>{`${queued.queued} of this drill's ${queued.total} spots were queued for the builder.`}</span>}
      <LibraryLink />
    </p>
  );
}
