/**
 * The /paint screen (S27 lane B, S41, R3.17, 05 section 8, O-300, O-302, O-351, O-415): range
 * painting by table, seat and spot.
 *
 * Mechanism: the address only prefills; a session starts on the player's Start, never because a
 * link was opened (PR #39 security LOW 2). An old ?drill=<uuid> link shows a start card naming the
 * drill-backed painting session; anything else shows the spot picker, filled from the address's
 * valid parts (a full valid choice: config, position, spot, the optional opener vs and seed,
 * paint-search.ts). Start painting writes the choice to the address and arms the start for exactly
 * that address once the navigation lands there, so another address goes back to the picker instead
 * of starting, and leaving the address drops the arm, so browser Back or Forward never starts it
 * again (practice/use-start-arm.ts, PR #41 review round 1). The start posts POST /sessions under
 * one Idempotency-Key per start attempt (O-232): a failed start shows a fixed sentence and Try
 * again, which is a new attempt with a new key. Once the session exists, PaintRun.tsx paints its
 * prompts. Leaving the start (another address or route, a sign-out, a tab close) ends its session,
 * even one that arrives after the player left (practice/use-practice-session.ts). Keying the start
 * by the address starts afresh when it changes.
 */
import { useNavigate } from "@tanstack/react-router";

import { useAppApi } from "../../auth/index.js";
import { DrillStartCard } from "../../components/practice/DrillStartCard.js";
import { Button, LoadingNote, PageHeader } from "../../components/ui/index.js";
import { paintChoiceOf, paintSearchOf, partialPaintChoice, validatePaintSearch, type PaintChoice, type PaintSearch } from "../../practice/paint-search.js";
import { usePracticeSession } from "../../practice/use-practice-session.js";
import { useStartArm } from "../../practice/use-start-arm.js";
import { useTrainerDeps } from "../../trainer/trainer-deps.js";
import { createPaintSession, paintFailureText, type PaintSource } from "./paint-api.js";
import { PaintRun } from "./PaintRun.js";
import { PICKER_TEXT, SpotPicker } from "./SpotPicker.js";

export const PAINT_PAGE_TEXT = {
  heading: "Range painting",
  starting: "Starting a range-painting session.",
  retry: "Try again",
  drillTitle: "Paint a range from a saved drill",
  drillBody: "This link opens range painting over a saved drill. Nothing starts until you press Start painting.",
} as const;

const PAINT_PATH = "/paint";

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

/**
 * Starts the session once on mount, which the page allows only after the player's Start; Try again
 * is a new attempt under a new Idempotency-Key. Unmounting ends the session.
 */
function PaintStart({ source, seed }: PaintStartProps) {
  const api = useAppApi();
  const { newKey } = useTrainerDeps();
  const { start } = usePracticeSession(() => createPaintSession(api, { source, seed, key: newKey() }));
  const { mutate } = start;
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

/** The start key of an address as the route will validate it, so a Start and its address agree. */
function addressKey(search: Record<string, unknown>): string | null {
  const checked = validatePaintSearch({ ...search });
  const source = sourceOf(checked);
  return source === null ? null : `${JSON.stringify(source)}:${checked.seed ?? ""}`;
}

export function PaintPage({ search }: PaintPageProps) {
  const navigate = useNavigate();
  // The router merges the parent's unvalidated search into the child's, so check it again here.
  const checked = validatePaintSearch({ ...search });
  const source = sourceOf(checked);
  const currentKey = addressKey({ ...checked });
  const armed = useStartArm({ pathname: PAINT_PATH, currentKey, keyOf: addressKey });
  const start = (choice: PaintChoice) => {
    const next = paintSearchOf(choice, checked.seed);
    armed.startAfter(navigate({ to: PAINT_PATH, search: next }), addressKey({ ...next }));
  };
  return (
    <section className="flex flex-col gap-4">
      <PageHeader title={PAINT_PAGE_TEXT.heading} description={PICKER_TEXT.goal} />
      {armed.running && source !== null && currentKey !== null ? (
        <PaintStart key={currentKey} source={source} seed={checked.seed} />
      ) : source?.kind === "drill" ? (
        <DrillStartCard title={PAINT_PAGE_TEXT.drillTitle} body={PAINT_PAGE_TEXT.drillBody} startLabel={PICKER_TEXT.start} onStart={armed.startHere} />
      ) : (
        <SpotPicker key={JSON.stringify(checked)} initial={partialPaintChoice(checked)} onStart={start} />
      )}
    </section>
  );
}
