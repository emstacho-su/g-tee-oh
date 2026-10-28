/**
 * The /paint screen (S27 lane B, R3.17, 05 section 8, O-300, O-302): range painting over a
 * drill-backed range_paint session.
 *
 * Mechanism: the page lists the user's drills (GET /drills, the drill list shared with /predict,
 * PR #29 review L11) with the address's drill preselected,
 * and Start painting posts POST /sessions with mode range_paint, the drill and the address's
 * validated seed (so a session replays), under one Idempotency-Key per start attempt (O-232). Once
 * the session exists, PaintRun.tsx paints its prompts. Failures show fixed sentences, never a
 * problem's text.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useAppApi } from "../../auth/index.js";
import { LoadingNote } from "../../components/ui/index.js";
import { drillListQuery } from "../../practice/drill-list-query.js";
import type { PracticeSearch } from "../../practice/search.js";
import { validatePracticeSearch } from "../../practice/search.js";
import { useTrainerDeps } from "../../trainer/trainer-deps.js";
import { DrillPicker } from "./DrillPicker.js";
import { createPaintSession, paintFailureText } from "./paint-api.js";
import { PaintRun } from "./PaintRun.js";

export const PAINT_PAGE_TEXT = {
  heading: "Range painting",
  intro: "Paint an action onto every hand class at a spot, then see what each choice costs. Unrated practice.",
  loadingDrills: "Loading your drills.",
  drillsFailed: "Your drills could not be loaded. Reload the page to try again.",
} as const;

export interface PaintPageProps {
  search: PracticeSearch;
}

export function PaintPage({ search }: PaintPageProps) {
  const api = useAppApi();
  const { newKey } = useTrainerDeps();
  // The router merges the parent's unvalidated search into the child's, so check it again here.
  const { drill: wanted, seed } = validatePracticeSearch({ ...search });
  const drills = useQuery(drillListQuery(api));
  const [selected, setSelected] = useState<string | null>(wanted ?? null);
  const start = useMutation({
    mutationFn: (drillId: string) => createPaintSession(api, { drillId, seed, key: newKey() }),
  });
  const session = start.data;
  return (
    <section className="flex flex-col gap-4" data-drill={wanted ?? ""}>
      <h1 className="text-2xl font-semibold">{PAINT_PAGE_TEXT.heading}</h1>
      {session === undefined ? <p className="text-sm text-muted">{PAINT_PAGE_TEXT.intro}</p> : null}
      {drills.isPending && session === undefined ? <LoadingNote text={PAINT_PAGE_TEXT.loadingDrills} /> : null}
      {drills.isError && session === undefined ? (
        <p role="alert" className="text-danger">
          {PAINT_PAGE_TEXT.drillsFailed}
        </p>
      ) : null}
      {start.isError ? (
        <p role="alert" className="text-danger">
          {paintFailureText(start.error)}
        </p>
      ) : null}
      {session === undefined && drills.data !== undefined ? (
        <DrillPicker
          drills={drills.data}
          selected={selected}
          starting={start.isPending}
          onSelect={setSelected}
          onStart={() => {
            if (selected !== null) start.mutate(selected);
          }}
        />
      ) : null}
      {session === undefined ? null : <PaintRun sessionId={session.session_id} initialVersion={session.state_version} />}
    </section>
  );
}
