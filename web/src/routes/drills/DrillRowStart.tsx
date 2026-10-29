/**
 * Start on a drill row (S47, R3.36, R3.4, O-482, O-484): the one-click way into a session. The
 * link opens /drills/$id/run?start=1, where the run screen reads the drill and starts by itself.
 * Beside it the coverage badge says what the library holds for the drill; when nothing is covered
 * Start is demoted to a plain link and "Open the library" is offered first (ADR 0018: an
 * uncovered spot is listed with its reason and a request costs nothing).
 */
import { Link } from "@tanstack/react-router";

import { Button } from "../../components/ui/index.js";
import type { Drill } from "../../drills/types.js";
import { AUTOSTART_FLAG } from "../../trainer/run-search.js";
import { LIBRARY_PATH } from "../drill-run/labels.js";
import { CoverageBadgeView, useCoverageBadge } from "./CoverageBadge.js";

export const ROW_START_TEXT = {
  start: "Start",
  openLibrary: "Open the library",
} as const;

export function DrillRowStart({ drill }: { drill: Drill }) {
  const badge = useCoverageBadge(drill.spot_filter);
  const dead = badge?.kind === "none" || badge?.kind === "no-config";
  return (
    <div className="flex flex-col items-start gap-1 md:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {dead ? (
          <Button asChild size="sm" variant="primary">
            <Link to={LIBRARY_PATH} aria-label={`${ROW_START_TEXT.openLibrary} for ${drill.name}`}>
              {ROW_START_TEXT.openLibrary}
            </Link>
          </Button>
        ) : null}
        <Button asChild size="sm" variant={dead ? "ghost" : "primary"}>
          <Link to="/drills/$id/run" params={{ id: drill.id }} search={{ start: AUTOSTART_FLAG }} aria-label={`${ROW_START_TEXT.start} ${drill.name}`} aria-describedby={dead ? `badge-${drill.id}` : undefined}>
            {ROW_START_TEXT.start}
          </Link>
        </Button>
      </div>
      <span id={`badge-${drill.id}`}>
        <CoverageBadgeView badge={badge} />
      </span>
    </div>
  );
}
