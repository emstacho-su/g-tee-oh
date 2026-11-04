/**
 * "Add the starter drills" (S47, R3.35, O-481): a button over the page's one starter-pack intent
 * (drills/use-drill-writes.ts useImportStarterPack), one Idempotency-Key per code minted once per
 * click, so a double click imports once and Try again after a failure replays the codes that
 * landed. The page owns the intent (PR #48 review HIGH 2): with the library empty, the empty state
 * and the header both show a button over that same intent, so one click on each still sends one
 * key set. The library page announces the result in its live region; the failure shows beside the
 * button that owns it (showFailure), never twice. The button imports only the starter drills still
 * missing (PR #48 review round 2 MEDIUM 3), and names how many when some have already landed.
 */
import { Button } from "../../components/ui/index.js";
import { drillFailureText } from "../../drills/failure-text.js";
import { STARTER_PACK, type StarterDrill } from "../../drills/starter-pack.js";
import type { Drill } from "../../drills/types.js";
import type { IntentMutation } from "../../library/use-intent-mutation.js";

export const STARTER_TEXT = {
  add: "Add the starter drills",
  addMissing: (count: number) => `Add the ${count} missing starter ${count === 1 ? "drill" : "drills"}`,
  adding: "Adding the starter drills",
  retry: "Try again",
  hint: `${STARTER_PACK.length} drills: opens, blind defence, 3-bets and a squeeze, ready to run or to edit.`,
  added: (count: number) => `Added ${count} starter ${count === 1 ? "drill" : "drills"}.`,
} as const;

export type StarterPackIntent = IntentMutation<readonly StarterDrill[], Drill[]>;

export interface StarterPackButtonProps {
  pack: StarterPackIntent;
  /** The starter drills still missing; the button imports only these (round 2 MEDIUM 3). */
  missing: readonly StarterDrill[];
  /** Show the one-line hint under the button (the empty state does). */
  withHint?: boolean;
  /** Show the pack's failure and Try again here (one button on the page does). */
  showFailure?: boolean;
}

export function StarterPackButton({ pack, missing, withHint = false, showFailure = true }: StarterPackButtonProps) {
  const failed = showFailure && pack.error !== null && pack.error !== undefined && !pack.busy;
  const label = missing.length === STARTER_PACK.length ? STARTER_TEXT.add : STARTER_TEXT.addMissing(missing.length);
  return (
    <div className="flex flex-col gap-2">
      <Button variant={withHint ? "primary" : "secondary"} disabled={pack.busy || missing.length === 0} onClick={() => pack.send(missing)}>
        {pack.busy ? STARTER_TEXT.adding : label}
      </Button>
      {withHint ? <p className="text-sm text-muted">{STARTER_TEXT.hint}</p> : null}
      {failed ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          <p className="font-medium text-danger">{`Error: ${drillFailureText(pack.error)}`}</p>
          <Button size="sm" disabled={missing.length === 0} onClick={() => pack.send(missing)}>
            {STARTER_TEXT.retry}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
