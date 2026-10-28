/**
 * The recap of an automated session or a holdout retest (S32, S38, R4.10, R4.12, R3.13, O-325, O-8,
 * O-252, O-279, O-346), from POST /sessions/{id}/end (SessionRecap).
 *
 * It leads with stat tiles (SessionLook.tsx): the decisions and rated decisions, the mean score as a
 * percent and the EV loss in bb. Then one card per rated track, named by the track (a list item
 * labelled by its heading), with its rating before and after the session with its deviation ("new"
 * when the track had no rating before) and the change; the overall tier after the session as a
 * badge, with the tracks that hold it below its band named in text; and the cosmetics the session
 * unlocked as chips, by name (lane C's catalog; a key the catalog does not know shows as is). When
 * nothing was rated a plain note says why that happens. "Train again" goes back to the start panel;
 * "See progress" opens /progress. S38 replaced the visible rating table with the cards (screen review
 * rows 33 and 92); every figure is the one the table showed.
 */
import { Link } from "@tanstack/react-router";
import { useId } from "react";

import { describeCosmetic } from "../../cosmetics/catalog.js";
import { Button, Card, cn } from "../../components/ui/index.js";
import { formatDeviation, formatPercent, formatRating, tierLabel, trackName } from "../../progress/format.js";
import type { TrackKey } from "../../progress/types.js";
import { formatBb } from "../../poker/format.js";
import type { RatingChange, SessionRecap } from "../../trainer/session-types.js";
import { StatTiles, type StatTile } from "../drill-run/SessionLook.js";
import { PROGRESS_PATH, TRAIN_TEXT } from "./train-text.js";

type TrackNames = Readonly<Partial<Record<TrackKey, string>>>;

export interface TrainingRecapProps {
  recap: SessionRecap;
  trackNames?: TrackNames;
  onTrainAgain: () => void;
}

type Figure = NonNullable<RatingChange["before"]>;

const SUNKEN_BLOCK = "rounded-xl bg-surface-sunken px-3 py-2";

function figureText(figure: Figure): string {
  return `${formatRating(figure.mu)} ${formatDeviation(figure.rd)}`;
}

/** "+18", "-4", "0", or "new" for a track rated for the first time. */
export function changeText(change: RatingChange): string {
  if (change.before === null) return TRAIN_TEXT.newRating;
  const delta = Math.round(change.after.mu - change.before.mu);
  return delta > 0 ? `+${delta}` : String(delta);
}

function summaryTiles(recap: SessionRecap): StatTile[] {
  return [
    { term: TRAIN_TEXT.decisions, value: String(recap.decisions) },
    { term: TRAIN_TEXT.ratedDecisions, value: String(recap.rated_decisions) },
    { term: TRAIN_TEXT.meanScore, value: recap.mean_score === null ? TRAIN_TEXT.noneRated : formatPercent(recap.mean_score) },
    { term: TRAIN_TEXT.evLoss, value: formatBb(recap.ev_loss_bb_total) },
  ];
}

interface RatingCardProps {
  change: RatingChange;
  trackNames: TrackNames | undefined;
}

function RatingCard({ change, trackNames }: RatingCardProps) {
  const nameId = useId();
  const rows: readonly (readonly [string, string])[] = [
    [TRAIN_TEXT.before, change.before === null ? TRAIN_TEXT.newRating : figureText(change.before)],
    [TRAIN_TEXT.after, figureText(change.after)],
    [TRAIN_TEXT.change, changeText(change)],
  ];
  return (
    <li aria-labelledby={nameId} className={cn("flex min-w-0 flex-col gap-1", SUNKEN_BLOCK)}>
      <p id={nameId} className="font-semibold">
        {trackName(change.track_key, trackNames)}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm tabular-nums">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted">{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

function RatingCards({ changes, trackNames }: { changes: readonly RatingChange[]; trackNames: TrackNames | undefined }) {
  const headingId = useId();
  if (changes.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 id={headingId} className="font-semibold">
        {TRAIN_TEXT.ratingTable}
      </h3>
      <ul aria-labelledby={headingId} data-testid="rating-changes" className="grid gap-2 sm:grid-cols-2">
        {changes.map((change) => (
          <RatingCard key={change.track_key} change={change} trackNames={trackNames} />
        ))}
      </ul>
    </div>
  );
}

function TierNote({ tier, trackNames }: { tier: SessionRecap["tier"]; trackNames: TrackNames | undefined }) {
  if (tier === null) return null;
  const held = tier.band_tier !== tier.tier && tier.blocked_by.length > 0;
  return (
    <div className="flex flex-col gap-1" data-testid="recap-tier">
      <h3 className="font-semibold">{TRAIN_TEXT.tierHeading}</h3>
      <p>
        <span className="inline-block rounded-full bg-accent px-3 py-0.5 text-sm font-bold text-accent-text">{tierLabel(tier.tier)}</span>
      </p>
      {held ? (
        <p className="text-sm text-muted">
          {`The conservative rating reaches ${tierLabel(tier.band_tier)}; it waits until these tracks settle: ${tier.blocked_by.map((key) => trackName(key, trackNames)).join(", ")}.`}
        </p>
      ) : null}
    </div>
  );
}

function Unlocks({ keys }: { keys: readonly string[] }) {
  const headingId = useId();
  if (keys.length === 0) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="recap-unlocks">
      <h3 id={headingId} className="font-semibold">
        {TRAIN_TEXT.unlocksHeading}
      </h3>
      <ul aria-labelledby={headingId} className="flex flex-wrap gap-2">
        {keys.map((key) => (
          <li key={key} className="rounded-full bg-surface-sunken px-3 py-1 text-sm font-semibold">
            {describeCosmetic(key)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TrainingRecap({ recap, trackNames, onTrainAgain }: TrainingRecapProps) {
  return (
    <Card title={TRAIN_TEXT.recapHeading} testId="training-recap" className="max-w-2xl">
      <StatTiles tiles={summaryTiles(recap)} testId="recap-summary" />
      {recap.rated_decisions === 0 ? (
        <p role="note" data-testid="nothing-rated" className={cn("text-sm", SUNKEN_BLOCK)}>
          {TRAIN_TEXT.nothingRated}
        </p>
      ) : null}
      <RatingCards changes={recap.rating_changes} trackNames={trackNames} />
      <TierNote tier={recap.tier} trackNames={trackNames} />
      <Unlocks keys={recap.unlocks} />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={onTrainAgain}>
          {TRAIN_TEXT.trainAgain}
        </Button>
        <Button asChild>
          <Link to={PROGRESS_PATH}>{TRAIN_TEXT.seeProgress}</Link>
        </Button>
      </div>
    </Card>
  );
}
