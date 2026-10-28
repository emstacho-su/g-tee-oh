/**
 * The threshold card (S24, S38, A7, R3.12, R3.13, O-198, ADR 0004, screen review row 14): which
 * hands take each aggressive action at the node and where one hand sits, in plain words.
 *
 * Mechanism: the card is StudyInsights.threshold_card as the contract pins it (S23). Three tiles:
 * Hand position ("At or above 18% of this range by strength" from rank_in_range, which counts the
 * hand and its ties, its own text when the hand has no rank, the hand itself only when Your hand
 * does not already name it, and its equity against the opponent's range), Actions (one row per entry: the
 * action's name, the share of the range that plays it, the weakest hand that plays it at least half
 * the time, and whether the hand is above, at or below that line) and Strongest folding hand. Each
 * tile's heading carries an InfoTip that explains it. Actions are named from the node's actions by
 * NodeAction.index (O-198) when the caller passes them, otherwise from the token
 * (tokenActionLabel), and "Unnamed action" when neither names it; no index, token or field name is
 * ever shown. The hero's hand is marked wherever it appears. Every api string is a React text
 * node, never HTML. Numbers are the api's, only formatted (ADR 0004).
 */
import { useId, type ReactNode } from "react";

import { ActionSwatch } from "../trainer/ActionSwatch.js";
import { InfoTip, RAISED_CLASS, cn } from "../ui/index.js";
import type { NodeAction, ThresholdCardData } from "../../contracts.js";
import { actionOfIndex } from "../../poker/action-index.js";
import { exactActionLabel, formatShare } from "../../poker/format.js";
import { tokenActionLabel } from "../../poker/token-label.js";

export interface ThresholdCardProps {
  /** Null when solver-query has no threshold card at the node (S23 pinned shape). */
  card: ThresholdCardData | null;
  heroHand?: string;
  title?: string;
  /** The node's actions, to name each threshold action by its NodeAction.index (O-198). */
  actions?: readonly NodeAction[];
}

type ThresholdAction = ThresholdCardData["actions"][number];
type Relative = ThresholdCardData["hand_position"]["relative"][number]["position"];

const DEFAULT_TITLE = "Threshold card";
const UNNAMED_ACTION = "Unnamed action";
const WHOLE_PERCENT = 0;

export const THRESHOLD_TIPS = {
  actions:
    "Each bet or raise here, with the share of the range that plays it and the weakest hand that still plays it at least half the time. Hands stronger than that line mostly take the action.",
  handPosition:
    "How strong this hand is among the hands that reach this spot, ranked by equity, and its equity: the share of the pot it wins on average against the opponent's range.",
  strongestFolding:
    "The strongest hand that folds here at least half the time. Most hands weaker than it fold too, so it marks the bottom of the range that continues.",
} as const;

const RELATIVE_TEXT: Readonly<Record<Relative, { readonly mark: string; readonly text: string }>> = {
  above: { mark: "▲", text: "Your hand is above this line" },
  at: { mark: "●", text: "Your hand is at this line" },
  below: { mark: "▼", text: "Your hand is below this line" },
};

const TILE_CLASSES = "flex min-w-0 flex-col gap-2 rounded-xl bg-surface-sunken/60 p-3";

function HandText({ hand, heroHand }: { hand: string; heroHand: string | undefined }) {
  return hand === heroHand ? (
    <mark data-hero="true" className="rounded bg-accent px-1 font-semibold text-accent-text">
      {hand}
    </mark>
  ) : (
    <span className="font-semibold">{hand}</span>
  );
}

interface TileProps {
  title: string;
  tipSubject: string;
  tip: string;
  /** The heading's id, which names the tile (and may name a list inside it). */
  headingId: string;
  className?: string;
  children: ReactNode;
}

/** A tile: a group named by its heading, with the heading's InfoTip beside it. */
function Tile({ title, tipSubject, tip, headingId, className, children }: TileProps) {
  return (
    <div role="group" aria-labelledby={headingId} className={cn(TILE_CLASSES, className)}>
      <div className="flex items-center gap-1.5">
        <h4 id={headingId} className="text-xs font-semibold tracking-wide text-muted uppercase">
          {title}
        </h4>
        <InfoTip subject={tipSubject}>{tip}</InfoTip>
      </div>
      {children}
    </div>
  );
}

/**
 * rank_in_range in words (review round 1, 4). It is the reach-weighted share of the range at or
 * below the hand's strength, the hand and its ties included, so the strongest hand reads 100% and
 * the weakest still counts itself; 0 means the api had no strength for the hand (it is outside the
 * range at this node), and its equity is then only a placeholder.
 *
 * S40 (item d, O-408): the rank is rounded to a whole percent before the wording is chosen, so a
 * rank of 0.996 reads "every hand" (never "At or above 100%") and a ranked hand under half a
 * percent reads "less than 1%" (never "0%").
 */
export const RANK_TEXT = {
  top: "At or above every hand in this range by strength",
  share: (percent: string) => `At or above ${percent} of this range by strength`,
  underOne: "less than 1%",
  none: "No strength rank here: the hand is outside this range at this node",
} as const;

const WHOLE = 100;

/** The words for a positive rank_in_range, chosen after rounding to a whole percent. */
export function rankText(rank: number): string {
  const percent = Math.round(rank * WHOLE);
  if (percent >= WHOLE) return RANK_TEXT.top;
  return RANK_TEXT.share(percent < 1 ? RANK_TEXT.underOne : `${percent}%`);
}

function HandPosition({ card, heroHand }: { card: ThresholdCardData; heroHand: string | undefined }) {
  const position = card.hand_position;
  const headingId = useId();
  const rank = position.rank_in_range;
  const ranked = rank > 0;
  return (
    <Tile title="Hand position" tipSubject="hand position" tip={THRESHOLD_TIPS.handPosition} headingId={headingId}>
      {/* The hand is named once: here only when it is not the hand Your hand already names. */}
      {position.hand === heroHand ? null : (
        <p className="text-base">
          <HandText hand={position.hand} heroHand={heroHand} />
        </p>
      )}
      <p>{ranked ? rankText(rank) : RANK_TEXT.none}</p>
      {ranked ? (
        <p className="text-muted">{`Equity against the opponent's range: ${formatShare(position.equity_vs_villain, WHOLE_PERCENT)}`}</p>
      ) : null}
    </Tile>
  );
}

interface ActionRowProps {
  entry: ThresholdAction;
  card: ThresholdCardData;
  actions: readonly NodeAction[] | undefined;
  heroHand: string | undefined;
}

function ActionRow({ entry, card, actions, heroHand }: ActionRowProps) {
  const nameId = useId();
  const action = actions === undefined ? undefined : actionOfIndex(actions, entry.index);
  const name = action === undefined ? (tokenActionLabel(entry.token) ?? UNNAMED_ACTION) : exactActionLabel(action);
  const relative = card.hand_position.relative.find((item) => item.index === entry.index);
  const weakest = entry.weakest_hand_taking_half;
  return (
    <li aria-labelledby={nameId} className="flex flex-col gap-1 rounded-lg bg-surface-raised px-3 py-2">
      <span className="flex flex-wrap items-center gap-2">
        {action === undefined || actions === undefined ? null : <ActionSwatch action={action} actions={actions} />}
        <span id={nameId} className="font-semibold">
          {name}
        </span>
        <span className="text-muted">{`Played by ${formatShare(entry.share_taking, WHOLE_PERCENT)} of the range`}</span>
      </span>
      {weakest === null ? (
        <span className="text-muted">No hand plays it at least half the time</span>
      ) : (
        <span>
          {"Weakest hand that plays it at least half the time: "}
          <HandText hand={weakest} heroHand={heroHand} />
        </span>
      )}
      {relative === undefined ? null : (
        <span data-relative={relative.position} className="flex items-center gap-1 text-xs font-medium">
          <span aria-hidden="true">{RELATIVE_TEXT[relative.position].mark}</span>
          {RELATIVE_TEXT[relative.position].text}
        </span>
      )}
    </li>
  );
}

function Actions({ card, actions, heroHand }: { card: ThresholdCardData; actions: readonly NodeAction[] | undefined; heroHand: string | undefined }) {
  const headingId = useId();
  return (
    <Tile title="Actions" tipSubject="actions" tip={THRESHOLD_TIPS.actions} headingId={headingId} className="sm:col-span-2">
      {card.actions.length === 0 ? (
        <p className="text-muted">No bet or raise at this node</p>
      ) : (
        <ul aria-labelledby={headingId} className="flex flex-col gap-2">
          {card.actions.map((entry) => (
            <ActionRow key={`${entry.index}-${entry.token}`} entry={entry} card={card} actions={actions} heroHand={heroHand} />
          ))}
        </ul>
      )}
    </Tile>
  );
}

function StrongestFolding({ card, heroHand }: { card: ThresholdCardData; heroHand: string | undefined }) {
  const hand = card.strongest_folding_hand;
  const headingId = useId();
  return (
    <Tile title="Strongest folding hand" tipSubject="the strongest folding hand" tip={THRESHOLD_TIPS.strongestFolding} headingId={headingId}>
      {hand === null ? (
        <p className="text-muted">No hand folds at least half the time</p>
      ) : (
        <p className="text-base">
          <HandText hand={hand} heroHand={heroHand} />
        </p>
      )}
    </Tile>
  );
}

export function ThresholdCard({ card, heroHand, title = DEFAULT_TITLE, actions }: ThresholdCardProps) {
  const titleId = useId();
  return (
    <section
      data-testid="threshold-card"
      aria-labelledby={titleId}
      className={cn("flex min-w-0 flex-col gap-3 rounded-2xl border border-border/50 bg-surface-raised p-4 text-sm", RAISED_CLASS)}
    >
      <h3 id={titleId} className="font-semibold">
        {title}
      </h3>
      {heroHand === undefined ? null : (
        <p>
          {"Your hand: "}
          <HandText hand={heroHand} heroHand={heroHand} />
        </p>
      )}
      {card === null ? (
        <p className="text-muted">No threshold data for this node</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <HandPosition card={card} heroHand={heroHand} />
          <StrongestFolding card={card} heroHand={heroHand} />
          <Actions card={card} actions={actions} heroHand={heroHand} />
        </div>
      )}
    </section>
  );
}
