/**
 * Synthetic progress fixtures typed against the S31 contract (S32, R4.12, R4.14, O-26). Unit
 * tests, the component gallery, the mocked api and the screenshots read these, so all four agree
 * on a shape. Every value comes from a fixed formula over the row, column or week index: nothing
 * here is a real rating, attempt or solution, and nothing comes from any reference tool.
 *
 * Two learners: fixtureProgress is a player with eight weeks of history (a rating, leak series,
 * a practiced heat map, two holdout rounds with one Goodhart flag, a nine-day streak);
 * fixtureFreshProgress is a new account before any rated session (no rating, no leaks, every
 * heat map cell never practiced, no holdout round, no streak). The heat map grid is shared.
 */
import type {
  HeatmapCell,
  HeatmapColumn,
  HeatmapRow,
  LeakItem,
  ProgressHeatmap,
  ProgressHoldout,
  ProgressLeaks,
  ProgressRating,
  ProgressStreak,
  TrackKey,
  TrackProgress,
} from "../progress/types.js";

const CLASS_KEY_SEPARATOR = "/";

/** Mondays of the eight-week span, oldest first; the last is the current, partial week. */
export const FIXTURE_LEAK_WEEKS: readonly string[] = [
  "2026-09-07",
  "2026-09-14",
  "2026-09-21",
  "2026-09-28",
  "2026-10-05",
  "2026-10-12",
  "2026-10-19",
  "2026-10-26",
];

export const FIXTURE_HEATMAP_ROWS: readonly HeatmapRow[] = [
  { family: "rfi", pair: "BB-UTG" },
  { family: "rfi", pair: "BB-CO" },
  { family: "rfi", pair: "BB-BTN" },
  { family: "rfi", pair: "SB-BB" },
  { family: "facing-open", pair: "BB-CO" },
  { family: "facing-open", pair: "BB-BTN" },
  { family: "facing-open", pair: "SB-BTN" },
  { family: "facing-3bet", pair: "BB-BTN" },
  { family: "facing-3bet", pair: "SB-BTN" },
  { family: "blind-vs-blind", pair: "SB-BB" },
];

export const FIXTURE_HEATMAP_COLUMNS: readonly HeatmapColumn[] = [
  { format: "live", depth_band: "100" },
  { format: "online", depth_band: "100" },
  { format: "online", depth_band: "150" },
  { format: "online", depth_band: "200" },
];

/** A synthetic class key in the solver-query shape (street, format, depth band, family, pair). */
export function fixtureClassKey(row: HeatmapRow, column: HeatmapColumn): string {
  return ["preflop", column.format, column.depth_band, row.family, row.pair].join(CLASS_KEY_SEPARATOR);
}

const TRACK_OF_FAMILY: Readonly<Record<string, TrackKey>> = {
  rfi: "opens",
  "facing-open": "facing-open-ip",
  "facing-3bet": "facing-3bet",
  "blind-vs-blind": "blind-vs-blind",
};

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Practiced cells: mastery climbs with the row and falls with depth; every fifth cell is new. */
function practicedCell(rowIndex: number, columnIndex: number): HeatmapCell {
  const row = FIXTURE_HEATMAP_ROWS[rowIndex] as HeatmapRow;
  const column = FIXTURE_HEATMAP_COLUMNS[columnIndex] as HeatmapColumn;
  const base = { spot_class_key: fixtureClassKey(row, column), row: rowIndex, column: columnIndex };
  if ((rowIndex + 2 * columnIndex) % 5 === 4) {
    return { ...base, p_known: null, mastered: false, retrievability: null, n: 0 };
  }
  const pKnown = round(Math.min(0.99, 0.12 + 0.09 * rowIndex + 0.11 * ((columnIndex + rowIndex) % 4)), 3);
  const retrievability = round(Math.max(0.55, 0.98 - 0.05 * ((rowIndex * 3 + columnIndex) % 9)), 3);
  return { ...base, p_known: pKnown, mastered: pKnown >= 0.95, retrievability, n: 6 + 7 * ((rowIndex + columnIndex) % 6) };
}

function heatmapOf(cell: (rowIndex: number, columnIndex: number) => HeatmapCell): ProgressHeatmap {
  return {
    rows: [...FIXTURE_HEATMAP_ROWS],
    columns: [...FIXTURE_HEATMAP_COLUMNS],
    cells: FIXTURE_HEATMAP_ROWS.flatMap((_, rowIndex) => FIXTURE_HEATMAP_COLUMNS.map((__, columnIndex) => cell(rowIndex, columnIndex))),
  };
}

export const fixtureHeatmap: ProgressHeatmap = heatmapOf(practicedCell);

export const fixtureFreshHeatmap: ProgressHeatmap = heatmapOf((rowIndex, columnIndex) => {
  const row = FIXTURE_HEATMAP_ROWS[rowIndex] as HeatmapRow;
  const column = FIXTURE_HEATMAP_COLUMNS[columnIndex] as HeatmapColumn;
  return { spot_class_key: fixtureClassKey(row, column), row: rowIndex, column: columnIndex, p_known: null, mastered: false, retrievability: null, n: 0 };
});

/** The ten leak classes: practiced cells, costs falling with rank. */
function leakItem(rank: number): LeakItem {
  const practiced = fixtureHeatmap.cells.filter((cell) => cell.p_known !== null);
  const cell = practiced[(rank * 3) % practiced.length] as HeatmapCell;
  const row = FIXTURE_HEATMAP_ROWS[cell.row] as HeatmapRow;
  const current = round(42 - rank * 3.6, 1);
  const lastWeek = FIXTURE_LEAK_WEEKS.length - 1;
  const series = FIXTURE_LEAK_WEEKS.map((week, index) => {
    const missing = index === 2 && rank % 3 === 0;
    const drift = (lastWeek - index) * (rank % 2 === 0 ? 2.4 : -0.9);
    return { week, leak_cost_bb_per_1k: missing ? null : round(Math.max(0, current + drift), 1), partial: index === lastWeek };
  });
  return { spot_class_key: cell.spot_class_key, family: row.family, track_key: TRACK_OF_FAMILY[row.family] ?? null, leak_cost_bb_per_1k: current, series };
}

export const fixtureLeaks: ProgressLeaks = {
  weeks: [...FIXTURE_LEAK_WEEKS],
  items: Array.from({ length: 10 }, (_, rank) => leakItem(rank)),
};

export const fixtureFreshLeaks: ProgressLeaks = { weeks: [...FIXTURE_LEAK_WEEKS], items: [] };

export const fixtureRating: ProgressRating = {
  overall: { mu: 1612.4, rd: 74.2, conservative: 1464, tier: "III", band_tier: "IV", blocked_by: ["live-limped-straddled"] },
  updated_at: "2026-10-27T19:40:00Z",
};

export const fixtureFreshRating: ProgressRating = { overall: null, updated_at: null };

interface TrackSeed {
  key: TrackKey;
  name: string;
  weight: number;
  mu: number;
  rd: number;
  rated: number;
}

const TRACK_SEEDS: readonly TrackSeed[] = [
  { key: "opens", name: "Opens", weight: 0.31, mu: 1684, rd: 61, rated: 412 },
  { key: "facing-open-ip", name: "Facing an open in position", weight: 0.2, mu: 1597, rd: 70, rated: 233 },
  { key: "blind-defense", name: "Blind defense", weight: 0.18, mu: 1551, rd: 82, rated: 190 },
  { key: "facing-3bet", name: "Facing a 3-bet", weight: 0.14, mu: 1622, rd: 95, rated: 121 },
  { key: "four-bet-plus", name: "4-bet pots and beyond", weight: 0.07, mu: 1530, rd: 112, rated: 44 },
  { key: "blind-vs-blind", name: "Blind versus blind", weight: 0.1, mu: 1588, rd: 104, rated: 67 },
  { key: "live-limped-straddled", name: "Live limped and straddled pots", weight: 0, mu: 1500, rd: 350, rated: 0 },
];

/** Glicko-2's starting deviation, the cap an idle track returns to (O-259). */
const STARTING_RD = 350;
const STARTING_MU = 1500;

function track(seed: TrackSeed, fresh: boolean): TrackProgress {
  const mu = fresh ? STARTING_MU : seed.mu;
  const rd = fresh ? STARTING_RD : seed.rd;
  return {
    track_key: seed.key,
    name: seed.name,
    family: "equilibrium",
    format: "cash",
    weight: seed.weight,
    mu,
    rd,
    conservative: round(mu - 2 * rd, 1),
    rated_decisions: fresh ? 0 : seed.rated,
    last_rated_at: fresh || seed.rated === 0 ? null : "2026-10-27T19:40:00Z",
  };
}

export const fixtureTracks: readonly TrackProgress[] = TRACK_SEEDS.map((seed) => track(seed, false));
export const fixtureFreshTracks: readonly TrackProgress[] = TRACK_SEEDS.map((seed) => track(seed, true));

export const fixtureHoldout: ProgressHoldout = {
  open: { round_month: "2026-10-01", answered: 12, total: 30 },
  next_cursor: null,
  items: [
    {
      round_month: "2026-09-01",
      opened_at: "2026-09-01T08:00:00Z",
      closed_at: "2026-09-30T21:00:00Z",
      tracks: [
        { track_key: "opens", answered: 30, total: 30, mean_score: 0.81, mu: 1671, goodhart_flag: true },
        { track_key: "facing-open-ip", answered: 28, total: 30, mean_score: 0.77, mu: 1590, goodhart_flag: false },
        { track_key: "facing-3bet", answered: 22, total: 30, mean_score: 0.7, mu: 1610, goodhart_flag: false },
      ],
    },
    {
      round_month: "2026-08-01",
      opened_at: "2026-08-03T08:00:00Z",
      closed_at: "2026-08-31T21:00:00Z",
      tracks: [
        { track_key: "opens", answered: 30, total: 30, mean_score: 0.8, mu: 1605, goodhart_flag: false },
        { track_key: "facing-open-ip", answered: 25, total: 30, mean_score: 0.71, mu: 1555, goodhart_flag: false },
      ],
    },
  ],
};

export const fixtureFreshHoldout: ProgressHoldout = { open: null, next_cursor: null, items: [] };

export const fixtureStreak: ProgressStreak = {
  current_days: 9,
  longest_days: 15,
  today_rated: 3,
  day_minimum: 5,
  freezes_left_this_week: 1,
  repairable: null,
  unlocks: [
    { cosmetic_key: "badge-streak-3", unlocked_at: "2026-09-12T20:00:00Z" },
    { cosmetic_key: "badge-tier-II", unlocked_at: "2026-09-15T20:00:00Z" },
    { cosmetic_key: "badge-streak-7", unlocked_at: "2026-09-16T20:00:00Z" },
    { cosmetic_key: "badge-tier-III", unlocked_at: "2026-09-29T20:00:00Z" },
    { cosmetic_key: "felt-tier-III", unlocked_at: "2026-09-29T20:00:00Z" },
    { cosmetic_key: "card-back-streak-14", unlocked_at: "2026-09-23T20:00:00Z" },
  ],
  next_milestone: { days: 30, cosmetic_key: "badge-streak-30" },
};

/** A streak with a missed day still inside its 48-hour repair window (O-278). */
export const fixtureRepairableStreak: ProgressStreak = {
  ...fixtureStreak,
  current_days: 0,
  today_rated: 4,
  freezes_left_this_week: 0,
  repairable: { day: "2026-10-26", deadline: "2026-10-28T23:00:00Z", progress: 4, needed: 10 },
};

export const fixtureFreshStreak: ProgressStreak = {
  current_days: 0,
  longest_days: 0,
  today_rated: 0,
  day_minimum: 5,
  freezes_left_this_week: 2,
  repairable: null,
  unlocks: [],
  next_milestone: { days: 3, cosmetic_key: "badge-streak-3" },
};
