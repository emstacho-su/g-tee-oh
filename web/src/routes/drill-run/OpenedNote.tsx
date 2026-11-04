/**
 * The line a leak's drill opens with (S47 follow-up, R4.12): /progress and the home queue open a
 * class's auto drill with from=leak-created or from=leak-reused, and the run screen says which,
 * once. The flag is kept in state and dropped from the address with a replace navigation (the
 * ?start=1 precedent in use-autostart.ts), so a reload, Back or a copied link does not say it again.
 * The line belongs to the drill it opened with: another drill on the same screen drops it (PR #51
 * review 6).
 */
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { describeFailureForLog } from "../../api/http-status.js";
import type { LeakOpen } from "../../trainer/run-search.js";

const OPENED_ENDINGS: Readonly<Record<LeakOpen, string>> = {
  "leak-created": "created for this spot",
  "leak-reused": "already in your drills",
};

export function openedText(open: LeakOpen, name: string): string {
  return `Opened ${name}, ${OPENED_ENDINGS[open]}.`;
}

interface OpenedFor {
  readonly drillId: string;
  readonly open: LeakOpen;
}

/** The from flag the screen opened this drill with, kept after the address drops it. */
export function useOpenedNote(from: LeakOpen | undefined, drillId: string): LeakOpen | null {
  const navigate = useNavigate();
  const [opened, setOpened] = useState<OpenedFor | null>(from === undefined ? null : { drillId, open: from });
  // A flag that arrives with a later drill replaces the line; none keeps it only for its own drill.
  if (from !== undefined && (opened?.drillId !== drillId || opened.open !== from)) setOpened({ drillId, open: from });
  useEffect(() => {
    if (from === undefined) return;
    navigate({ to: ".", search: (previous: Record<string, unknown>) => withoutFrom(previous), replace: true }).catch((error: unknown) => {
      console.error(`g-tee-oh: dropping from= from the run address failed (${describeFailureForLog(error)})`);
    });
  }, [from, navigate]);
  return opened !== null && opened.drillId === drillId ? opened.open : null;
}

function withoutFrom(search: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(search).filter(([key]) => key !== "from"));
}

export function OpenedNote({ open, name }: { open: LeakOpen; name: string }) {
  return (
    <p role="status" data-testid="opened-note" className="text-sm font-medium">
      {openedText(open, name)}
    </p>
  );
}
