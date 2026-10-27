/**
 * Gallery sections for the trainer components (S24, R3.13, O-267). Each section renders one
 * component with the synthetic fixtures (src/fixtures, O-26) inside a <section> carrying
 * data-testid "gallery-<name>", which the Playwright shots project screenshots one by one. The
 * handlers do nothing: this page shows how the components look, the component tests prove how
 * they behave.
 */
import type { ReactNode } from "react";

import { ActionFrequencyTable, ThresholdCard } from "../components/panels/index.js";
import { BoardReveal, CardView, PokerTable } from "../components/table/index.js";
import type { TableSeat } from "../components/table/index.js";
import { ActionBar, ConfidenceTap, FeedbackPanel, RngRoller } from "../components/trainer/index.js";
import type { NodeAction } from "../contracts.js";
import { fixtureActions, fixtureFeedback, fixtureInsights, fixturePrompt } from "../fixtures/index.js";

const noop = (): void => undefined;

export interface GallerySectionProps {
  name: string;
  title: string;
  note: string;
  children: ReactNode;
}

export function GallerySection({ name, title, note, children }: GallerySectionProps) {
  return (
    <section data-testid={`gallery-${name}`} className="rounded-lg border border-border bg-surface-raised p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mb-3 text-sm text-muted">{note}</p>
      {children}
    </section>
  );
}

const SIX_MAX: readonly TableSeat[] = [
  { position: "UTG", stackCbb: 10000, isHero: false, hasFolded: true, isButton: false, isStraddle: false },
  { position: "HJ", stackCbb: 10000, isHero: false, hasFolded: true, isButton: false, isStraddle: false },
  { position: "CO", stackCbb: 10000, isHero: false, hasFolded: true, isButton: false, isStraddle: false },
  { position: "BTN", stackCbb: 10000, isHero: true, hasFolded: false, isButton: true, isStraddle: false, cards: ["Ah", "Jd"] },
  { position: "SB", stackCbb: 9950, betCbb: 50, isHero: false, hasFolded: false, isButton: false, isStraddle: false },
  { position: "BB", stackCbb: 9900, betCbb: 100, isHero: false, hasFolded: false, isButton: false, isStraddle: false },
];

const NINE_LIVE: readonly TableSeat[] = [
  { position: "UTG", stackCbb: 14800, betCbb: 200, isHero: false, hasFolded: false, isButton: false, isStraddle: true },
  { position: "UTG1", stackCbb: 15000, isHero: false, hasFolded: true, isButton: false, isStraddle: false },
  { position: "UTG2", stackCbb: 15000, isHero: false, hasFolded: true, isButton: false, isStraddle: false },
  { position: "LJ", stackCbb: 15000, isHero: false, hasFolded: true, isButton: false, isStraddle: false },
  { position: "HJ", stackCbb: 14200, betCbb: 800, isHero: false, hasFolded: false, isButton: false, isStraddle: false },
  { position: "CO", stackCbb: 15000, isHero: true, hasFolded: false, isButton: false, isStraddle: false, cards: ["Ks", "Qs"] },
  { position: "BTN", stackCbb: 15000, isHero: false, hasFolded: false, isButton: true, isStraddle: false },
  { position: "SB", stackCbb: 14950, betCbb: 50, isHero: false, hasFolded: false, isButton: false, isStraddle: false },
  { position: "BB", stackCbb: 14900, betCbb: 100, isHero: false, hasFolded: false, isButton: false, isStraddle: false },
];

/** A synthetic postflop node with three bet buckets, for the Grouped label layout. */
const POSTFLOP_ACTIONS: readonly NodeAction[] = [
  { index: 0, token: "x", kind: "check", size_cbb: null, bucket: null, label: "Check" },
  { index: 1, token: "b200", kind: "bet", size_cbb: 200, bucket: "small", label: "Small" },
  { index: 2, token: "b450", kind: "bet", size_cbb: 450, bucket: "pot", label: "Pot" },
  { index: 3, token: "b2000", kind: "all_in", size_cbb: 2000, bucket: "all-in", label: "All-in" },
];

export function TableSections() {
  return (
    <>
      <GallerySection name="poker-table-6" title="PokerTable, 6 seats" note="Preflop, hero on the button, blinds posted.">
        <PokerTable seats={SIX_MAX} potCbb={fixturePrompt.pot_cbb} center={<BoardReveal cards={[]} />} />
      </GallerySection>
      <GallerySection
        name="poker-table-9"
        title="PokerTable, 9 seats with a straddle"
        note="Live table, UTG straddle marker, a flop on the board."
      >
        <PokerTable seats={NINE_LIVE} potCbb={1150} center={<BoardReveal cards={["Kh", "7d", "2c"]} />} />
      </GallerySection>
      <GallerySection name="cards" title="CardView" note="Rank and suit symbol with an accessible name; face down; four-color.">
        <div className="flex flex-wrap items-end gap-2">
          <CardView card="Ah" size="lg" />
          <CardView card="Ks" size="lg" />
          <CardView card="Td" size="md" />
          <CardView card="2c" size="sm" />
          <CardView faceDown size="lg" />
          <CardView card="Qd" size="lg" fourColor />
          <CardView card="9c" size="lg" fourColor />
        </div>
      </GallerySection>
      <GallerySection name="board-reveal" title="BoardReveal" note="Flop, turn and river slots.">
        <div className="flex flex-col gap-3">
          <BoardReveal cards={["Kh", "7d", "2c"]} />
          <BoardReveal cards={["Kh", "7d", "2c", "Js"]} />
          <BoardReveal cards={["Kh", "7d", "2c", "Js", "3h"]} />
        </div>
      </GallerySection>
    </>
  );
}

export function TrainerSections() {
  return (
    <>
      <GallerySection
        name="action-bar"
        title="ActionBar"
        note="Buttons only from the node's tree actions (ADR 0020). Preflop shows exact sizes (O-22); postflop Grouped shows the bucket with the size underneath."
      >
        <div className="flex flex-col gap-3">
          <ActionBar actions={fixtureActions} grouping="standard" street="preflop" onAction={noop} />
          <ActionBar actions={POSTFLOP_ACTIONS} grouping="grouped" street="flop" onAction={noop} />
        </div>
      </GallerySection>
      <GallerySection name="confidence-tap" title="ConfidenceTap" note="Sure or unsure, before any reveal; keys S and U.">
        <ConfidenceTap onChoose={noop} />
      </GallerySection>
      <GallerySection name="rng-roller" title="RngRoller" note="Bands and the selection come from packages/learning (O-213).">
        <RngRoller
          actions={fixtureActions}
          freqByAction={fixtureFeedback.freq_by_action}
          roll={fixtureFeedback.rng_roll}
          onExplain={noop}
        />
      </GallerySection>
      <GallerySection name="feedback-panel" title="FeedbackPanel" note="Label, EV loss in bb and percent pot, the hand's frequencies.">
        <FeedbackPanel
          feedback={fixtureFeedback}
          actions={fixtureActions}
          chosenIndex={1}
          thresholdCard={<ThresholdCard card={fixtureInsights.threshold_card} heroHand="AJo" />}
        />
      </GallerySection>
      <GallerySection name="action-frequency-table" title="ActionFrequencyTable" note="Frequencies and EV as given by the api.">
        <ActionFrequencyTable
          actions={fixtureActions}
          frequencies={fixtureFeedback.freq_by_action}
          evBb={fixtureFeedback.ev_by_action}
          highlightIndexes={fixtureFeedback.best_action_indexes}
          caption="AJo at the button open"
        />
      </GallerySection>
      <GallerySection name="threshold-card" title="ThresholdCard" note="Rendered generically until S23 pins the shape.">
        <ThresholdCard card={fixtureInsights.threshold_card} heroHand="AJo" />
      </GallerySection>
    </>
  );
}
