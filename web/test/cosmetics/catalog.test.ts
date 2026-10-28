/**
 * The web cosmetic catalog (S32, R4.14, O-279): labels and unlock rules, and a drift test that
 * reads the api's catalog (services/api/src/streaks/cosmetics.ts) as text, so a milestone, a day
 * count, a tier badge or a felt tier changed on one side fails here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  COSMETIC_CATALOG,
  cosmeticsOfKind,
  describeCosmetic,
  findCosmetic,
  isCosmeticOfKind,
} from "../../src/cosmetics/catalog.js";

/** Vitest runs from web/, so the repo root is its parent (as test/library/library-units.test.ts reads it). */
const API_CATALOG_PATH = join(process.cwd(), "..", "services", "api", "src", "streaks", "cosmetics.ts");
const apiSource = readFileSync(API_CATALOG_PATH, "utf8");

function apiMilestones(): { days: number; key: string }[] {
  const pattern = /\{\s*days:\s*(\d+),\s*cosmeticKey:\s*"([^"]+)"\s*\}/g;
  return [...apiSource.matchAll(pattern)].map((match) => ({ days: Number(match[1]), key: match[2] as string }));
}

function apiTierList(name: string): string[] {
  const match = new RegExp(`${name}[^=]*=\\s*\\[([^\\]]*)\\]`).exec(apiSource);
  if (match === null) throw new Error(`${name} not found in the api catalog`);
  return [...(match[1] as string).matchAll(/"([IVX]+)"/g)].map((each) => each[1] as string);
}

function apiFirstBadgeTier(): string {
  const match = /FIRST_BADGE_TIER[^=]*=\s*"([IVX]+)"/.exec(apiSource);
  if (match === null) throw new Error("FIRST_BADGE_TIER not found in the api catalog");
  return match[1] as string;
}

describe("R4.14 cosmetic catalog drift against the api", () => {
  it("R4.14 every streak milestone key and day count matches the api's STREAK_MILESTONES", () => {
    const milestones = apiMilestones();
    expect(milestones.length).toBeGreaterThan(0);
    const webStreak = COSMETIC_CATALOG.filter((entry) => entry.unlock.kind === "streak").map((entry) => ({
      days: entry.unlock.kind === "streak" ? entry.unlock.days : -1,
      key: entry.key,
    }));
    expect(webStreak).toEqual(milestones);
  });

  it("R4.14 every tier badge and felt tier matches the api's tier lists", () => {
    const order = apiTierList("TIER_ORDER");
    const badgeTiers = order.slice(order.indexOf(apiFirstBadgeTier()));
    const feltTiers = apiTierList("FELT_TIERS");
    expect(cosmeticsOfKind("felt").map((entry) => entry.key)).toEqual(feltTiers.map((tier) => `felt-tier-${tier}`));
    const tierBadges = COSMETIC_CATALOG.filter((entry) => entry.kind === "badge" && entry.unlock.kind === "tier").map((entry) => entry.key);
    expect(tierBadges).toEqual(badgeTiers.map((tier) => `badge-tier-${tier}`));
  });
});

describe("R4.14 cosmetic catalog labels", () => {
  it("R4.14 names each item in plain words with its unlock rule", () => {
    expect(findCosmetic("badge-streak-7")).toMatchObject({ kind: "badge", label: "Seven-day streak badge", unlockText: "Reach a 7-day streak" });
    expect(findCosmetic("card-back-streak-14")).toMatchObject({ kind: "card-back", label: "Fourteen-day streak card back", unlockText: "Reach a 14-day streak" });
    expect(findCosmetic("felt-tier-III")).toMatchObject({ kind: "felt", label: "Tier III felt", unlockText: "Reach Tier III" });
    expect(findCosmetic("badge-tier-V")).toMatchObject({ kind: "badge", label: "Tier V badge", unlockText: "Reach Tier V" });
    expect(findCosmetic("nope")).toBeUndefined();
  });

  it("R4.14 groups items by kind and checks a key against a kind", () => {
    expect(cosmeticsOfKind("card-back").map((entry) => entry.key)).toEqual(["card-back-streak-14", "card-back-streak-60"]);
    expect(cosmeticsOfKind("badge")).toHaveLength(11);
    expect(isCosmeticOfKind("felt-tier-V", "felt")).toBe(true);
    expect(isCosmeticOfKind("felt-tier-V", "badge")).toBe(false);
    expect(isCosmeticOfKind(42, "felt")).toBe(false);
    expect(new Set(COSMETIC_CATALOG.map((entry) => entry.key)).size).toBe(COSMETIC_CATALOG.length);
  });

  it("R4.14 describeCosmetic gives the label, or the key when the catalog does not know it", () => {
    expect(describeCosmetic("badge-streak-30")).toBe("Thirty-day streak badge");
    expect(describeCosmetic("badge-streak-1000")).toBe("badge-streak-1000");
  });
});
