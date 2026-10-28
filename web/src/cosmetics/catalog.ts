/**
 * The cosmetic catalog, web copy (S32, R4.14, O-279, O-323, ADR 0012). The api owns the catalog
 * and every unlock (services/api/src/streaks/cosmetics.ts); the web needs the same keys with plain
 * labels and the rule that unlocks each, so /settings can list locked items by name and the
 * streak tile can name the next milestone.
 *
 * Mechanism: one ordered list of entries, built from the same three facts the api's file holds
 * (the streak milestones, the tiers that carry a badge, the tiers that carry a felt). A drift test
 * (web/test/cosmetics/catalog.test.ts) reads the api file as text and fails when a milestone, a
 * day count, a tier badge or a felt tier differs. Cosmetics change how the app looks and nothing
 * else (ADR 0012): no screen reads this list to gate training.
 */
import type { Tier } from "../progress/types.js";

export type CosmeticKind = "badge" | "card-back" | "felt";

export type CosmeticUnlock = { readonly kind: "streak"; readonly days: number } | { readonly kind: "tier"; readonly tier: Tier };

export interface CosmeticEntry {
  readonly key: string;
  readonly kind: CosmeticKind;
  /** Plain words, for example "Seven-day streak badge" or "Tier III felt". */
  readonly label: string;
  readonly unlock: CosmeticUnlock;
  /** How the item unlocks, for example "Reach a 14-day streak" or "Reach Tier V". */
  readonly unlockText: string;
}

interface StreakMilestoneSpec {
  readonly days: number;
  readonly kind: Exclude<CosmeticKind, "felt">;
  readonly words: string;
}

/** The api's STREAK_MILESTONES, in its order (O-279). */
export const STREAK_MILESTONE_SPECS: readonly StreakMilestoneSpec[] = [
  { days: 3, kind: "badge", words: "Three-day" },
  { days: 7, kind: "badge", words: "Seven-day" },
  { days: 14, kind: "card-back", words: "Fourteen-day" },
  { days: 30, kind: "badge", words: "Thirty-day" },
  { days: 60, kind: "card-back", words: "Sixty-day" },
  { days: 100, kind: "badge", words: "Hundred-day" },
];

/** Tiers that unlock a badge on first reach: II to VIII (O-279). */
export const TIER_BADGE_TIERS: readonly Tier[] = ["II", "III", "IV", "V", "VI", "VII", "VIII"];
/** Tiers that also unlock a table felt (O-279). */
export const FELT_TIERS: readonly Tier[] = ["III", "V", "VII"];

const KEY_PREFIX: Readonly<Record<Exclude<CosmeticKind, "felt">, string>> = { badge: "badge-streak-", "card-back": "card-back-streak-" };
const KIND_WORDS: Readonly<Record<CosmeticKind, string>> = { badge: "badge", "card-back": "card back", felt: "felt" };

function streakEntry(spec: StreakMilestoneSpec): CosmeticEntry {
  return {
    key: `${KEY_PREFIX[spec.kind]}${spec.days}`,
    kind: spec.kind,
    label: `${spec.words} streak ${KIND_WORDS[spec.kind]}`,
    unlock: { kind: "streak", days: spec.days },
    unlockText: `Reach a ${spec.days}-day streak`,
  };
}

function tierEntry(tier: Tier, kind: "badge" | "felt"): CosmeticEntry {
  return {
    key: kind === "badge" ? `badge-tier-${tier}` : `felt-tier-${tier}`,
    kind,
    label: `Tier ${tier} ${KIND_WORDS[kind]}`,
    unlock: { kind: "tier", tier },
    unlockText: `Reach Tier ${tier}`,
  };
}

export const COSMETIC_CATALOG: readonly CosmeticEntry[] = [
  ...STREAK_MILESTONE_SPECS.map(streakEntry),
  ...TIER_BADGE_TIERS.map((tier) => tierEntry(tier, "badge")),
  ...FELT_TIERS.map((tier) => tierEntry(tier, "felt")),
];

const BY_KEY: ReadonlyMap<string, CosmeticEntry> = new Map(COSMETIC_CATALOG.map((entry) => [entry.key, entry]));

export function findCosmetic(key: string): CosmeticEntry | undefined {
  return BY_KEY.get(key);
}

/** The catalog entries of one kind, in catalog order. */
export function cosmeticsOfKind(kind: CosmeticKind): CosmeticEntry[] {
  return COSMETIC_CATALOG.filter((entry) => entry.kind === kind);
}

/** True when the key names a catalog item of this kind. */
export function isCosmeticOfKind(key: unknown, kind: CosmeticKind): key is string {
  return typeof key === "string" && findCosmetic(key)?.kind === kind;
}

/** The item's plain label for the streak tile; a key the catalog does not know is shown as is. */
export function describeCosmetic(key: string): string {
  return findCosmetic(key)?.label ?? key;
}
