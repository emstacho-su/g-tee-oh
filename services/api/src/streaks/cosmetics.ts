/**
 * The cosmetic catalog (R4.14, O-279, ADR 0012, 06 section 8): streak badges at 3, 7, 30 and 100
 * days, card backs at 14 and 60 days, tier badges on first reaching tiers II to VIII, and table
 * felts at III, V and VII. Pure data and pure lookups. Unlocks are permanent and cosmetic only:
 * nothing reads them to gate content (ADR 0012).
 */
import type { Tier } from "@g-tee-oh/learning";

/** One streak milestone: the streak length that unlocks a cosmetic. */
export interface StreakMilestone {
  days: number;
  cosmeticKey: string;
}

/** Streak milestones in ascending order (O-279). */
export const STREAK_MILESTONES: readonly StreakMilestone[] = [
  { days: 3, cosmeticKey: "badge-streak-3" },
  { days: 7, cosmeticKey: "badge-streak-7" },
  { days: 14, cosmeticKey: "card-back-streak-14" },
  { days: 30, cosmeticKey: "badge-streak-30" },
  { days: 60, cosmeticKey: "card-back-streak-60" },
  { days: 100, cosmeticKey: "badge-streak-100" },
];

/** Tiers in ascending order, as learning's TIER_FLOORS lists them. */
export const TIER_ORDER: readonly Tier[] = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

/** Tier badges unlock from this tier up (O-279). */
const FIRST_BADGE_TIER: Tier = "II";
/** Tiers whose first reach also unlocks a table felt (O-279). */
const FELT_TIERS: readonly Tier[] = ["III", "V", "VII"];

export function tierBadgeKey(tier: Tier): string {
  return `badge-tier-${tier}`;
}

export function feltKey(tier: Tier): string {
  return `felt-tier-${tier}`;
}

/** The streak cosmetics a streak of `days` has reached. */
export function streakCosmetics(days: number): string[] {
  return STREAK_MILESTONES.filter((milestone) => milestone.days <= days).map((milestone) => milestone.cosmeticKey);
}

/** The tier cosmetics reaching `tier` unlocks: every badge and felt at or below it (O-279). */
export function tierCosmetics(tier: Tier): string[] {
  const reached = TIER_ORDER.indexOf(tier);
  const firstBadge = TIER_ORDER.indexOf(FIRST_BADGE_TIER);
  return TIER_ORDER.slice(firstBadge, reached + 1).flatMap((each) =>
    FELT_TIERS.includes(each) ? [tierBadgeKey(each), feltKey(each)] : [tierBadgeKey(each)],
  );
}

/** The next streak milestone not yet unlocked beyond the current streak; null when none is left. */
export function nextStreakMilestone(currentDays: number, unlocked: ReadonlySet<string>): StreakMilestone | null {
  return STREAK_MILESTONES.find((milestone) => milestone.days > currentDays && !unlocked.has(milestone.cosmeticKey)) ?? null;
}
