/**
 * "Add the starter drills" (S47, R3.35, O-481): one button that imports the bundled starter pack
 * through the existing import write, one Idempotency-Key per code minted once per click
 * (drills/use-drill-writes.ts useImportStarterPack), so a double click imports once and Try again
 * after a failure replays the codes that landed. The library page announces the result in its
 * live region; the failure shows here beside the button.
 */
import type { AppApi } from "../../api/index.js";
import { Button } from "../../components/ui/index.js";
import { drillFailureText } from "../../drills/failure-text.js";
import { STARTER_PACK } from "../../drills/starter-pack.js";
import type { Drill } from "../../drills/types.js";
import { useImportStarterPack } from "../../drills/use-drill-writes.js";

export const STARTER_TEXT = {
  add: "Add the starter drills",
  adding: "Adding the starter drills",
  retry: "Try again",
  hint: `${STARTER_PACK.length} drills: opens, blind defence, 3-bets and a squeeze, ready to run or to edit.`,
  added: (count: number) => `Added ${count} starter drills.`,
} as const;

export interface StarterPackButtonProps {
  api: AppApi;
  onAdded: (drills: readonly Drill[]) => void;
  /** Show the one-line hint under the button (the empty state does). */
  withHint?: boolean;
}

export function StarterPackButton({ api, onAdded, withHint = false }: StarterPackButtonProps) {
  const pack = useImportStarterPack(api, onAdded);
  const failed = pack.error !== null && pack.error !== undefined && !pack.busy;
  return (
    <div className="flex flex-col gap-2">
      <Button variant={withHint ? "primary" : "secondary"} disabled={pack.busy} onClick={() => pack.send(STARTER_PACK)}>
        {pack.busy ? STARTER_TEXT.adding : STARTER_TEXT.add}
      </Button>
      {withHint ? <p className="text-sm text-muted">{STARTER_TEXT.hint}</p> : null}
      {failed ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          <p className="font-medium text-danger">{`Error: ${drillFailureText(pack.error)}`}</p>
          <Button size="sm" onClick={() => pack.send(STARTER_PACK)}>
            {STARTER_TEXT.retry}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
