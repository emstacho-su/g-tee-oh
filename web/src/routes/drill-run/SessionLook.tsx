/**
 * The trainer's start and recap building blocks on the S36 system (S38 lane E, R3.13, O-346,
 * O-348; screen review rows 33, 34, 87 to 94), shared by the drill run (/drills/$id/run) and
 * /train so both screens read the same way.
 *
 * StatTiles: a recap's figures as a row of tiles, one term and one large value each, in a <dl> so
 * a screen reader still hears "Decisions, 3". SettingChips: a session's settings as rounded chips
 * in a labelled list, the setting's name muted and its value bold, so the choice is carried by the
 * words and never by colour. Both sit on the sunken ground inside a raised Card, which gives the
 * depth; neither draws a border of its own. Nothing here computes a number: values arrive as text.
 */
import type { ReactNode } from "react";

export interface StatTile {
  readonly term: string;
  readonly value: string;
}

export interface StatTilesProps {
  tiles: readonly StatTile[];
  testId?: string;
}

const TILE_CLASSES = "flex min-w-0 flex-col gap-0.5 rounded-xl bg-surface-sunken px-3 py-2";

export function StatTiles({ tiles, testId }: StatTilesProps) {
  return (
    <dl data-testid={testId} className="grid grid-cols-2 gap-2 tabular-nums sm:grid-cols-4">
      {tiles.map(({ term, value }) => (
        <div key={term} data-testid="stat-tile" className={TILE_CLASSES}>
          <dt className="text-xs font-medium text-muted">{term}</dt>
          <dd className="text-xl font-semibold tracking-tight">{value}</dd>
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
