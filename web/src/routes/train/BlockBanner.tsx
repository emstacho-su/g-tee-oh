/**
 * The banner above the table in /train (S32, R4.10, O-272, O-325, O-328). In an automated session
 * it names the shown hand's class by its action family and rating track (the track's name from the
 * tracks read, its key while that loads), the hand's place in its block ("Hand 2 of 3 in this
 * block") and whether the block counts: a worked example says "Worked example: panels visible, not
 * rated"; a block of a rated session says it counts toward the rating. In a holdout retest it says
 * "Holdout retest: not rated" with the round's answered of total. Every fact is in words, so the
 * accent border is never the only signal. The values come from block-progress.ts.
 */
import { cn } from "../../components/ui/index.js";
import { trackName } from "../../progress/format.js";
import type { TrackKey } from "../../progress/types.js";
import type { BlockView, HoldoutView } from "./block-progress.js";
import { TRAIN_TEXT } from "./train-text.js";

const BANNER_CLASSES = "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-surface-raised px-3 py-2 text-sm";

export interface BlockBannerProps {
  block: BlockView | null;
  holdout: HoldoutView | null;
  /** True when the session may be rated (PracticeSession.rated_eligible). */
  ratedEligible: boolean;
  trackNames?: Readonly<Partial<Record<TrackKey, string>>>;
}

function classText(block: BlockView, trackNames: BlockBannerProps["trackNames"]): string {
  const track = block.trackKey === null ? TRAIN_TEXT.noTrack : trackName(block.trackKey, trackNames);
  return block.family === null ? track : `${block.family}, ${track}`;
}

function ratingText(block: BlockView, ratedEligible: boolean): string {
  if (block.workedExample) return TRAIN_TEXT.workedExample;
  return ratedEligible ? TRAIN_TEXT.ratedBlock : TRAIN_TEXT.unratedSession;
}

export function BlockBanner({ block, holdout, ratedEligible, trackNames }: BlockBannerProps) {
  if (holdout !== null) {
    return (
      <section aria-label={TRAIN_TEXT.holdoutHeading} data-testid="block-banner" className={cn(BANNER_CLASSES, "border-border")}>
        <p className="font-semibold">{TRAIN_TEXT.holdoutBanner}</p>
        <p data-testid="holdout-answered" className="tabular-nums">{`${holdout.answered} of ${holdout.total} answered`}</p>
      </section>
    );
  }
  if (block === null) return null;
  return (
    <section aria-label="Review block" data-testid="block-banner" className={cn(BANNER_CLASSES, block.workedExample ? "border-accent" : "border-border")}>
      <p className="font-semibold" data-testid="block-class">
        {classText(block, trackNames)}
      </p>
      <p data-testid="block-hand" className="tabular-nums">{`Hand ${block.hand} of ${block.size} in this block`}</p>
      <p data-testid="block-rating">{ratingText(block, ratedEligible)}</p>
    </section>
  );
}
