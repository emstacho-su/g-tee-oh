/**
 * The saved spots as one-click links, and the star (S45, R3.27, O-460, design rule 5: returning is
 * half of studying). Used in the study settings panel, on the library's filters and coverage
 * heading, and on Home, all over the one per-browser store (store/study-spots.ts).
 *
 * Mechanism: SpotLinks lists spots as links into /study with the spot's validated search, so a pick
 * is an ordinary navigation (browser back returns) and the study page records it like any other
 * confirmed spot. Each list says in one line when it is empty, never hides behind a dialog. Labels
 * are the spot summary (settings.ts); where the stakes are not loaded the stake part is left out.
 * StarButton toggles the spot with aria-pressed and a visible filled or hollow star with words.
 */
import { Link } from "@tanstack/react-router";
import { useStore } from "zustand";

import { Button, cn } from "../../components/ui/index.js";
import { isStarred } from "../../study/saved-spots.js";
import type { StudySearch } from "../../study/search.js";
import { settingsSummary } from "../../study/settings.js";
import type { Stake } from "../../study/queries.js";
import { useStudySpotsStore } from "../../store/study-spots.js";

export const SPOT_TEXT = {
  yourSpots: "Your spots",
  recentSpots: "Recent spots",
  noStarred: "No starred spots yet: star a spot from its summary line.",
  noRecent: "No recent spots yet.",
  star: "Star this spot",
  startOver: "Start over",
  cardTitle: "Your spots",
} as const;

export interface SpotLinksProps {
  label: string;
  spots: readonly StudySearch[];
  stakes: readonly Stake[];
  empty: string;
}

export function SpotLinks({ label, spots, stakes, empty }: SpotLinksProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p aria-hidden="true" className="text-sm font-medium">
        {label}
      </p>
      {spots.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul aria-label={label} className="flex flex-wrap gap-2">
          {spots.map((spot) => {
            const text = settingsSummary(stakes, spot);
            return (
              <li key={`${text}|${spot.line ?? ""}`} className="min-w-0">
                <Link
                  to="/study"
                  search={spot}
                  className="block rounded-lg border border-border bg-surface-raised px-2 py-1 text-xs font-medium hover:bg-surface-sunken"
                >
                  {text}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export interface SpotShortcutsProps {
  stakes: readonly Stake[];
  /** Whether to list the recent spots too; the library offers the starred only. */
  recent?: boolean;
}

/** "Your spots" and, by default, "Recent spots" from the store. */
export function SpotShortcuts({ stakes, recent = true }: SpotShortcutsProps) {
  const starred = useStore(useStudySpotsStore, (state) => state.starred);
  const recentSpots = useStore(useStudySpotsStore, (state) => state.recent);
  return (
    <div className="flex flex-col gap-3">
      <SpotLinks label={SPOT_TEXT.yourSpots} spots={starred} stakes={stakes} empty={SPOT_TEXT.noStarred} />
      {recent ? <SpotLinks label={SPOT_TEXT.recentSpots} spots={recentSpots} stakes={stakes} empty={SPOT_TEXT.noRecent} /> : null}
    </div>
  );
}

export interface StarButtonProps {
  spot: StudySearch;
}

/** Toggles the spot in the starred list; aria-pressed and the filled star say whether it is starred. */
export function StarButton({ spot }: StarButtonProps) {
  const starred = useStore(useStudySpotsStore, (state) => isStarred(state.starred, spot));
  const toggle = useStore(useStudySpotsStore, (state) => state.toggleStar);
  return (
    <Button size="sm" aria-pressed={starred} aria-label={SPOT_TEXT.star} onClick={() => toggle(spot)}>
      <span aria-hidden="true" className={cn(starred ? "text-accent" : "text-muted")}>
        {starred ? "★" : "☆"}
      </span>
      <span aria-hidden="true">{starred ? "Starred" : "Star"}</span>
    </Button>
  );
}
