/**
 * The coverage badge of a drill row (S47, R3.4, O-482, ADR 0018): "Covered", "Partly covered: M not
 * built", "Not built yet" or "Not in the catalog", from the drill's reach over the two catalog reads
 * (use-drill-reach.ts), so a drill that cannot run never looks like one that can. The words carry
 * the meaning; the edge colour only repeats it.
 */
import { cn } from "../../components/ui/index.js";
import { badgeOf, type CoverageBadge as Badge, type CoverageBadgeKind, type ReachFilter } from "../../drills/reach-model.js";
import { useDrillReach } from "../../drills/use-drill-reach.js";

export const BADGE_LOADING = "Checking the library";

const BADGE_CLASSES: Readonly<Record<CoverageBadgeKind, string>> = {
  covered: "border-success text-text",
  partly: "border-warning text-text",
  none: "border-dashed border-warning text-muted",
  "no-config": "border-dashed border-border-strong text-muted",
};

export interface CoverageBadgeProps {
  filter: ReachFilter;
  /** Receives the badge once known, so the row can demote Start (DrillRowStart). */
  onBadge?: (badge: Badge | null) => void;
}

export function useCoverageBadge(filter: ReachFilter): Badge | null | undefined {
  const state = useDrillReach(filter);
  if (state === undefined) return undefined;
  return state.failed === true ? null : badgeOf(state.reach);
}

export function CoverageBadgeView({ badge }: { badge: Badge | null | undefined }) {
  if (badge === null) return null;
  if (badge === undefined) {
    return (
      <span data-testid="coverage-badge" data-kind="loading" className="text-xs text-muted">
        {BADGE_LOADING}
      </span>
    );
  }
  return (
    <span data-testid="coverage-badge" data-kind={badge.kind} className={cn("inline-block rounded-full border px-2 text-xs font-medium", BADGE_CLASSES[badge.kind])}>
      {badge.text}
    </span>
  );
}
