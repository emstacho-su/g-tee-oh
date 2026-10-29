/**
 * The trainer's start and recap building blocks on the S36 system (S38 lane E, S46, R3.13, O-346,
 * O-348; screen review rows 33, 34, 87 to 94), shared by the drill run (/drills/$id/run) and
 * /train so both screens read the same way.
 *
 * StatTiles: a recap's figures as a row of tiles, one term and one large value each, in a <dl> so
 * a screen reader still hears "Decisions, 3"; a tile may carry a one-line definition as an InfoTip
 * in its corner (S46, critic round 3 G8: a statistic never shows with a bare label), placed after
 * the value so the term and the value read unbroken. RECAP_TIPS holds the definitions both recaps
 * and the in-session tally use. SettingChips: a session's settings as rounded chips in a labelled
 * list, the setting's name muted and its value bold, so the choice is carried by the words and
 * never by colour. Both sit on the sunken ground inside a raised Card, which gives the depth;
 * neither draws a border of its own. Nothing here computes a number: values arrive as text.
 */
import type { ReactNode } from "react";

import { InfoTip } from "../../components/ui/index.js";

export interface StatTip {
  /** Read as "About <subject>". */
  readonly subject: string;
  readonly text: string;
}

export interface StatTile {
  readonly term: string;
  readonly value: string;
  readonly tip?: StatTip;
  /** A ready-made tip for the corner instead of tip, for example the grade definitions (GradeTip). */
  readonly info?: ReactNode;
}

/** One definition per recap statistic, the words of 05 section 6.3 and 06 section 3.6. */
export const RECAP_TIPS = {
  ratedDecisions: {
    subject: "rated decisions",
    text: "Decisions that count toward your rating: first attempts in automated training, with no answer-revealing panel on and no noise flag.",
  },
  meanScore: {
    subject: "mean score",
    text: "The average score of the rated decisions. A decision at or below the solver's floor scores 100%; the score falls as the EV lost grows.",
  },
  evLoss: {
    subject: "EV loss",
    text: "The EV lost over the session's decisions, in big blinds, as the solver measures it against the best action.",
  },
} as const satisfies Record<string, StatTip>;

export interface StatTilesProps {
  tiles: readonly StatTile[];
  testId?: string;
  /** Smaller tiles in more columns, for the in-session tally above the table (S46, R3.32). */
  compact?: boolean;
  /** Names the list for a screen reader, for example "This session so far". */
  label?: string;
}

const TILE_CLASSES = "relative flex min-w-0 flex-col gap-0.5 rounded-xl bg-surface-sunken px-3 py-2";
const COMPACT_TILE_CLASSES = "relative flex min-w-0 flex-col rounded-lg bg-surface-sunken px-2 py-1";

function TileTip({ tip, info }: { tip: StatTip | undefined; info: ReactNode }) {
  if (info !== undefined) return <span className="absolute top-1.5 right-1.5">{info}</span>;
  if (tip === undefined) return null;
  return (
    <InfoTip subject={tip.subject} className="absolute top-2 right-2">
      {tip.text}
    </InfoTip>
  );
}

export function StatTiles({ tiles, testId, compact = false, label }: StatTilesProps) {
  const grid = compact ? "grid grid-cols-3 gap-1.5 tabular-nums sm:grid-cols-5" : "grid grid-cols-2 gap-2 tabular-nums sm:grid-cols-4";
  return (
    <dl data-testid={testId} aria-label={label} className={grid}>
      {tiles.map(({ term, value, tip, info }) => (
        <div key={term} data-testid="stat-tile" className={compact ? COMPACT_TILE_CLASSES : TILE_CLASSES}>
          <dt className="pr-6 text-xs font-medium text-muted">{term}</dt>
          <dd className={compact ? "text-base font-semibold" : "text-xl font-semibold tracking-tight"}>{value}</dd>
          <TileTip tip={tip} info={info} />
        </div>
      ))}
    </dl>
  );
}

export interface SettingChip {
  readonly name: string;
  readonly value: ReactNode;
  /** A test id on the value, for screens whose tests read one setting. */
  readonly valueTestId?: string;
}

export interface SettingChipsProps {
  label: string;
  chips: readonly SettingChip[];
}

const CHIP_CLASSES = "inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 rounded-full bg-surface-sunken px-3 py-1 text-sm";

export function SettingChips({ label, chips }: SettingChipsProps) {
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {chips.map(({ name, value, valueTestId }) => (
        <li key={name} className={CHIP_CLASSES}>
          <span className="text-muted">{name}</span>
          <span data-testid={valueTestId} className="font-semibold">
            {value}
          </span>
        </li>
      ))}
    </ul>
  );
}
