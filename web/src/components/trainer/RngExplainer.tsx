/**
 * The Mixed-frequency mode explainer (S25, S37, R3.10, 05 section 7, ADR 0024, O-283, O-344).
 *
 * Mechanism: a ui/Dialog titled "How Mixed-frequency mode works" holding three parts in plain
 * words, rewritten for ADR 0024 (screen review row 20):
 * - What earns Best: always the action with the highest EV (expected value); other actions within
 *   the noise floor are graded Correct; the roll never changes the grade.
 * - How the roll works: before acting the hero sees only the roll on a 1 to 100 scale and weighs
 *   every option's frequency in their head; after the decision the same scale shows the bands
 *   (actions from passive to aggressive, each as wide as its frequency, the 40 percent call and 60
 *   percent raise example) and a separate mark says whether the hero followed the roll.
 * - Why practise mixing: a hand that mixes is close to indifferent between its actions, and the mix
 *   protects the range; the mode trains taking each action as often as the strategy does.
 * The example draws the real RngRoller twice over a static two-action node, hidden then revealed,
 * so the picture comes from the same code and the same packages/learning bands the trainer uses
 * (O-213); neither gets onExplain, so the dialog holds no button that would only reopen itself.
 * All text is static and goes through React text nodes. RngExplainerContent is exported on its own
 * so the gallery can show the text inline and the snapshot test can pin it without the dialog's
 * generated ids. Opening on first use and from the I key is use-rng-explainer.ts's job; this
 * component only renders what it is told.
 */
import type { ReactNode } from "react";

import { Dialog } from "../ui/index.js";
import type { NodeAction } from "../../contracts.js";
import { RngRoller } from "./RngRoller.js";
import { RNG_EXPLAINER_TITLE } from "./use-rng-explainer.js";

export interface RngExplainerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The 05 section 7 example: call 40 percent, raise 60 percent, at a preflop node. */
const EXAMPLE_ACTIONS: readonly NodeAction[] = [
  { index: 0, token: "c", kind: "call", size_cbb: null, bucket: null, label: "Call", next_node_key: null },
  { index: 1, token: "r250", kind: "raise", size_cbb: 250, bucket: "pot", label: "Raise to 2.5bb", next_node_key: null },
];
const EXAMPLE_FREQUENCIES: readonly number[] = [0.4, 0.6];
/** Lands in the call band (1 to 40), so the revealed example reads "Roll 37 fell on Call". */
const EXAMPLE_ROLL = 37;

interface ExplainerPartProps {
  title: string;
  children: ReactNode;
}

function ExplainerPart({ title, children }: ExplainerPartProps) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function RngExplainerContent() {
  return (
    <div data-testid="rng-explainer-content" className="flex flex-col gap-4 text-sm">
      <ExplainerPart title="What earns Best">
        <p>
          Best is always the action with the highest EV (expected value). Any other action whose EV loss is within
          the noise floor is graded Correct. The roll never changes your grade.
        </p>
      </ExplainerPart>
      <ExplainerPart title="How the roll works">
        <p>
          Before you act, the app rolls a number from 1 to 100 and shows it on a scale, with nothing else. Weigh how
          often the strategy takes each of your options, then choose the one the roll points to.
        </p>
        <RngRoller hidden roll={EXAMPLE_ROLL} />
        <p>
          After your decision the same scale shows the bands. Your hand&apos;s actions are lined up from passive to
          aggressive: fold, then check or call, then bets and raises from small to large, each as wide as its
          frequency. Example: 40 percent call and 60 percent raise means rolls 1 to 40 call and 41 to 100 raise, so
          roll 37 lands in the call band.
        </p>
        <RngRoller actions={EXAMPLE_ACTIONS} freqByAction={EXAMPLE_FREQUENCIES} roll={EXAMPLE_ROLL} />
        <p className="text-muted">
          A separate mark then says whether you followed the roll. It shows how well you mix; it is not part of the
          grade.
        </p>
      </ExplainerPart>
      <ExplainerPart title="Why practise mixing">
        <p>
          Some hands play more than one action, calling some of the time and raising the rest. Such a hand is close to
          indifferent between those actions, and the mix protects your range: if you always played it the same way, an
          observant opponent could learn which hands take which line. Mixed-frequency mode trains you to take each
          action about as often as the strategy does.
        </p>
      </ExplainerPart>
    </div>
  );
}

export function RngExplainer({ open, onOpenChange }: RngExplainerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={RNG_EXPLAINER_TITLE}>
      <RngExplainerContent />
    </Dialog>
  );
}
