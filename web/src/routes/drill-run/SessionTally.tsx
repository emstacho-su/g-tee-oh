/**
 * The in-session tally (S46, R3.32, design rule 10, O-477): a compact row of stat tiles above the
 * table in every mode, from the first prompt and updated on each reveal: decisions, the five label
 * counts (each with the grade definitions tip, design rule 11), the rated count, and the total and
 * mean EV loss in big blinds, plus the run of Best or Correct when the session's panels turn it
 * on. Every number is a count, sum or mean over the per-decision values the api served
 * (trainer/session-log.ts); the web formats them only (ADR 0004). The run is called a run, never
 * a streak (O-278 is the daily streak).
 */
import { GRADE_NAMES, GRADE_ORDER, GradeTip } from "../../components/trainer/index.js";
import { formatBb } from "../../poker/format.js";
import type { SessionTally as Tally } from "../../trainer/session-log.js";
import { RECAP_TIPS, StatTiles, type StatTile } from "./SessionLook.js";

export const TALLY_TEXT = {
  label: "This session so far",
  decisions: "Decisions",
  rated: "Rated",
  evLoss: "EV loss",
  meanLoss: "Mean loss",
  noneYet: "None yet",
  run: "Run",
} as const;

const RUN_TIP = {
  subject: "the run",
  text: "Best or Correct decisions in a row in this session, since the last other grade. Your days of practice are counted apart, on Home.",
} as const;

const MEAN_LOSS_TIP = {
  subject: "mean loss",
  text: "The EV lost per decision in this session, in big blinds: the session's EV loss over its decisions.",
} as const;

/** The five label counts as tiles with the grade tip; the recap uses them too. */
export function labelCountTiles(tally: Tally): StatTile[] {
  return GRADE_ORDER.map((label) => ({ term: GRADE_NAMES[label], value: String(tally.counts[label]), info: <GradeTip /> }));
}

function tallyTiles(tally: Tally, showRun: boolean): StatTile[] {
  const tiles: StatTile[] = [
    { term: TALLY_TEXT.decisions, value: String(tally.decisions) },
    ...labelCountTiles(tally),
    { term: TALLY_TEXT.rated, value: String(tally.rated), tip: RECAP_TIPS.ratedDecisions },
    { term: TALLY_TEXT.evLoss, value: formatBb(tally.evLossTotalBb), tip: RECAP_TIPS.evLoss },
    { term: TALLY_TEXT.meanLoss, value: tally.evLossMeanBb === null ? TALLY_TEXT.noneYet : formatBb(tally.evLossMeanBb), tip: MEAN_LOSS_TIP },
  ];
  return showRun ? [...tiles, { term: TALLY_TEXT.run, value: String(tally.run), tip: RUN_TIP }] : tiles;
}

export interface SessionTallyProps {
  tally: Tally;
  /** The session's prompt names the run's panel key (session-log.ts showsRun). */
  showRun: boolean;
}

export function SessionTally({ tally, showRun }: SessionTallyProps) {
  return (
    <section aria-label={TALLY_TEXT.label} data-testid="session-tally">
      <StatTiles tiles={tallyTiles(tally, showRun)} compact label={TALLY_TEXT.label} />
    </section>
  );
}
