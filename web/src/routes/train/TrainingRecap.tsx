/**
 * The recap of an automated session or a holdout retest (S32, R4.10, R4.12, O-325, O-8, O-252,
 * O-279), from POST /sessions/{id}/end (SessionRecap).
 *
 * It shows the decisions and rated decisions, the mean score as a percent, the EV loss in bb, a
 * table of each rated track's rating before and after the session with its deviation ("new" when
 * the track had no rating before), the overall tier after the session with the tracks that hold it
 * below its band named in text, and the cosmetics the session unlocked by name (lane C's catalog;
 * a key the catalog does not know shows as is). When nothing was rated a plain note says why that
 * happens. "Train again" goes back to the start panel; "See progress" opens /progress.
 */
import { Link } from "@tanstack/react-router";
import { useId } from "react";

import { describeCosmetic } from "../../cosmetics/catalog.js";
import { Button } from "../../components/ui/index.js";
import { formatDeviation, formatPercent, formatRating, tierLabel, trackName } from "../../progress/format.js";
import type { TrackKey } from "../../progress/types.js";
import { formatBb } from "../../poker/format.js";
import type { RatingChange, SessionRecap } from "../../trainer/session-types.js";
import { PROGRESS_PATH, TRAIN_TEXT } from "./train-text.js";

type TrackNames = Readonly<Partial<Record<TrackKey, string>>>;

export interface TrainingRecapProps {
  recap: SessionRecap;
  trackNames?: TrackNames;
  onTrainAgain: () => void;
}

type Figure = NonNullable<RatingChange["before"]>;

function figureText(figure: Figure): string {
  return `${formatRating(figure.mu)} ${formatDeviation(figure.rd)}`;
}

/** "+18", "-4", "0", or "new" for a track rated for the first time. */
export function changeText(change: RatingChange): string {
  if (change.before === null) return TRAIN_TEXT.newRating;
  const delta = Math.round(change.after.mu - change.before.mu);
  return delta > 0 ? `+${delta}` : String(delta);
}

function Summary({ recap }: { recap: SessionRecap }) {
  const rows: readonly (readonly [string, string])[] = [
    [TRAIN_TEXT.decisions, String(recap.decisions)],
    [TRAIN_TEXT.ratedDecisions, String(recap.rated_decisions)],
    [TRAIN_TEXT.meanScore, recap.mean_score === null ? TRAIN_TEXT.noneRated : formatPercent(recap.mean_score)],
    [TRAIN_TEXT.evLoss, formatBb(recap.ev_loss_bb_total)],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 tabular-nums" data-testid="recap-summary">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted">{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RatingTable({ changes, trackNames }: { changes: readonly RatingChange[]; trackNames: TrackNames | undefined }) {
  if (changes.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm tabular-nums" data-testid="rating-changes">
        <caption className="text-left font-semibold">{TRAIN_TEXT.ratingTable}</caption>
        <thead className="text-muted">
          <tr>
            <th scope="col" className="py-1 pr-3 font-medium">{TRAIN_TEXT.track}</th>
            <th scope="col" className="py-1 pr-3 font-medium">{TRAIN_TEXT.before}</th>
            <th scope="col" className="py-1 pr-3 font-medium">{TRAIN_TEXT.after}</th>
            <th scope="col" className="py-1 font-medium">{TRAIN_TEXT.change}</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change) => (
            <tr key={change.track_key} className="border-t border-border">
              <th scope="row" className="py-1 pr-3 font-medium">{trackName(change.track_key, trackNames)}</th>
              <td className="py-1 pr-3">{change.before === null ? TRAIN_TEXT.newRating : figureText(change.before)}</td>
              <td className="py-1 pr-3">{figureText(change.after)}</td>
              <td className="py-1">{changeText(change)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
        <span className="rounded-md border border-border bg-surface-sunken px-2 py-0.5 text-sm font-semibold">{tierLabel(tier.tier)}</span>
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
      <h3 id={headingId} className="font-semibold">{TRAIN_TEXT.unlocksHeading}</h3>
      <ul aria-labelledby={headingId} className="list-disc pl-5">
        {keys.map((key) => (
          <li key={key}>{describeCosmetic(key)}</li>
        ))}
      </ul>
    </div>
  );
}

export function TrainingRecap({ recap, trackNames, onTrainAgain }: TrainingRecapProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-testid="training-recap" className="flex max-w-2xl flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4">
      <h2 id={headingId} className="text-xl font-semibold">
        {TRAIN_TEXT.recapHeading}
      </h2>
      <Summary recap={recap} />
      {recap.rated_decisions === 0 ? (
        <p role="note" data-testid="nothing-rated" className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm">
          {TRAIN_TEXT.nothingRated}
        </p>
      ) : null}
      <RatingTable changes={recap.rating_changes} trackNames={trackNames} />
      <TierNote tier={recap.tier} trackNames={trackNames} />
      <Unlocks keys={recap.unlocks} />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={onTrainAgain}>
          {TRAIN_TEXT.trainAgain}
        </Button>
        <Link to={PROGRESS_PATH} className="font-medium underline">
          {TRAIN_TEXT.seeProgress}
        </Link>
      </div>
    </section>
  );
}
