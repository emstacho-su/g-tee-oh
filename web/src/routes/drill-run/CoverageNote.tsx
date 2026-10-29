/**
 * The covered-part notes of the drill run screen (S26, R3.14, O-312, ADR 0018). Nothing here waits
 * on a solve: the library is built in the background and the session runs on what it holds.
 *
 * - CoverageNote: when POST /sessions answered coverage with pairs_queued above zero, the session
 *   runs on the covered part and the note says "Running on X of Y spots; Z queued for the builder"
 *   with a link to /library. A fully covered drill, or a session answer without coverage, shows
 *   nothing.
 * - NoCoverageNote: when POST /sessions refused a fully uncovered drill (422 no-coverage), the
 *   alert above says so in fixed text; this note adds the queued count the 422 carried as its
 *   typed pairs_queued and pairs_total (SpotProblem.queued, session-problem.ts; the detail text is
 *   never read) and the same link.
 * The link is the router Link (PR #30 review MEDIUM 4): following it is a client-side navigation,
 * so the app, its query cache and the session's state are kept, never thrown away by a full page
 * load. The screen's tests render the notes inside a router (test/trainer-screen/screen-router.tsx).
 *
 * S40 (screen review row 36): both notes are raised notes on the shared tokens with the warning
 * edge on their start side; the words carry the meaning, never the colour. Text and logic are as
 * S26 left them (row 35 waits on the real stack, O-355).
 */
import { Link } from "@tanstack/react-router";

import type { SessionCoverage } from "../../trainer/session-types.js";
import type { SpotProblem } from "../../trainer/spot-problem.js";
import { cn, RAISED_CLASS } from "../../components/ui/index.js";
import { LIBRARY_PATH, SESSION_TEXT } from "./labels.js";

const NOTE_CLASSES = cn(
  "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-border/50 border-l-4 border-l-warning bg-surface-raised px-4 py-3 text-sm",
  RAISED_CLASS,
);

function LibraryLink() {
  return (
    <Link to={LIBRARY_PATH} className="font-semibold text-accent underline underline-offset-2">
      {SESSION_TEXT.openLibrary}
    </Link>
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
