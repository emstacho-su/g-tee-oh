/**
 * The /paint screen (S27 lane B, S41, R3.17, 05 section 8, O-300, O-302, O-351, O-415): range
 * painting by table, seat and spot.
 *
 * Mechanism: the address decides what shows. A full valid choice (config, position, spot, the
 * optional opener vs and seed, paint-search.ts) starts a catalog-spot range_paint session; an old
 * ?drill=<uuid> link starts a drill-backed one. Anything else shows the spot picker, filled from
 * the address's valid parts; Start painting writes the choice to the address. The start posts POST
 * /sessions under one Idempotency-Key per start attempt (O-232): a failed start shows a fixed
 * sentence and Try again, which is a new attempt with a new key. Once the session exists,
 * PaintRun.tsx paints its prompts. Keying the start by the address starts afresh when it changes.
 */
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useAppApi } from "../../auth/index.js";
import { Button, LoadingNote, PageHeader } from "../../components/ui/index.js";
import { paintChoiceOf, paintSearchOf, partialPaintChoice, validatePaintSearch, type PaintChoice, type PaintSearch } from "../../practice/paint-search.js";
import { useTrainerDeps } from "../../trainer/trainer-deps.js";
import { createPaintSession, paintFailureText, type PaintSource } from "./paint-api.js";
import { PaintRun } from "./PaintRun.js";
import { PICKER_TEXT, SpotPicker } from "./SpotPicker.js";

export const PAINT_PAGE_TEXT = {
  heading: "Range painting",
  starting: "Starting a range-painting session.",
  retry: "Try again",
} as const;

export interface PaintPageProps {
  search: PaintSearch;
}

interface PaintStartProps {
  source: PaintSource;
  seed: string | undefined;
}

function sourceOf(search: PaintSearch): PaintSource | null {
  if (search.drill !== undefined) return { kind: "drill", drillId: search.drill };
  const choice = paintChoiceOf(search);
  return choice === null ? null : { kind: "spot", choice };
}

/** Starts the session once on mount; Try again is a new attempt under a new Idempotency-Key. */
function PaintStart({ source, seed }: PaintStartProps) {
  const api = useAppApi();
  const { newKey } = useTrainerDeps();
  const start = useMutation({ mutationFn: () => createPaintSession(api, { source, seed, key: newKey() }) });
  const requested = useRef(false);
  const { mutate } = start;
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    mutate();
  }, [mutate]);
  const session = start.data;
  if (session !== undefined) return <PaintRun sessionId={session.session_id} initialVersion={session.state_version} />;
  if (start.isError) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-danger">{paintFailureText(start.error)}</span>
        <Button size="sm" onClick={() => mutate()}>
          {PAINT_PAGE_TEXT.retry}
        </Button>
      </div>
    );
  }
  return <LoadingNote text={PAINT_PAGE_TEXT.starting} />;
}

export function PaintPage({ search }: PaintPageProps) {
  const navigate = useNavigate();
  // The router merges the parent's unvalidated search into the child's, so check it again here.
  const checked = validatePaintSearch({ ...search });
  const source = sourceOf(checked);
  const start = (choice: PaintChoice) => void navigate({ to: "/paint", search: paintSearchOf(choice, checked.seed) });
  return (
    <section className="flex flex-col gap-4">
      <PageHeader title={PAINT_PAGE_TEXT.heading} description={PICKER_TEXT.goal} />
      {source === null ? (
        <SpotPicker key={JSON.stringify(checked)} initial={partialPaintChoice(checked)} onStart={start} />
      ) : (
        <PaintStart key={`${JSON.stringify(source)}:${checked.seed ?? ""}`} source={source} seed={checked.seed} />
      )}
    </section>
  );
}
