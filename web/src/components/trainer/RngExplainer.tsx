/**
 * The RNG (random number generator) mode explainer (S25, R3.10, 05 section 7, ADR 0009, O-283).
 *
 * Mechanism: a ui/Dialog titled "How RNG mode works" holding the three parts 05 section 7 asks
 * for, in plain words: why randomize at all (a hand that mixes is indifferent between those
 * actions; the mix protects the range), how the roll works (1 to 100, actions ordered passive to
 * aggressive, cumulative bands, the 40 percent call and 60 percent raise example), and why it is
 * optional (category over exact mix against opponents who do not track frequencies, and any
 * in-mix action within the floor is graded correct either way, ADR 0009). The example strip is
 * the real RngRoller over a static two-action node, so the picture is drawn by the same code and
 * the same packages/learning bands the trainer uses (O-213); it gets no onExplain, so the dialog
 * holds no button that would only reopen itself. All text is static and goes through React text
 * nodes. RngExplainerContent is exported on its own so the gallery can show the text inline and
 * the snapshot test can pin it without the dialog's generated ids. Opening on first use and from
 * the I key is use-rng-explainer.ts's job; this component only renders what it is told.
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
/** Lands in the call band (1 to 40), so the example reads "Roll 37 selects Call". */
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
      <ExplainerPart title="Why randomize at all">
        <p>
          Some hands play more than one action, for example calling some of the time and raising the rest. A hand
          that mixes is indifferent between those actions: each one earns the same EV (expected value) by itself.
        </p>
        <p>
          The mix matters for your range as a whole. If you always played this hand the same way, an observant
          opponent could learn which hands take which line and play against that.
        </p>
      </ExplainerPart>
      <ExplainerPart title="How the roll works">
        <p>
          Before you act, the app rolls a number from 1 to 100. Your hand&apos;s actions are lined up from passive to
          aggressive: fold, then check or call, then bets and raises from small to large. Each action gets a band as
          wide as its frequency, and the roll picks the action whose band contains it. That action is labeled Best.
        </p>
        <p>
          Example: 40 percent call and 60 percent raise means rolls 1 to 40 call and 41 to 100 raise. Here the roll is
          37, so it lands in the call band.
        </p>
        <RngRoller actions={EXAMPLE_ACTIONS} freqByAction={EXAMPLE_FREQUENCIES} roll={EXAMPLE_ROLL} />
        <p className="text-muted">
          You see only the roll before you act. The bands appear after your decision, because they are the
          hand&apos;s strategy.
        </p>
      </ExplainerPart>
      <ExplainerPart title="Why it is optional">
        <p>
          Against opponents who do not track your frequencies, getting the action category right (fold, call or
          raise) matters more than hitting the exact mix.
        </p>
        <p>
          Grading stays fair either way: any action in your hand&apos;s mix whose EV loss is within the noise floor is
          graded correct, with or without RNG mode.
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
