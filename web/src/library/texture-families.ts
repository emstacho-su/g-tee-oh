/**
 * Texture families for the coverage grid (S28, R3.4, O-291, ADR 0004).
 *
 * Mechanism: the web never classifies a flop. solver-query names each covered flop's family
 * (gto_model TextureFamily::of) and the api passes it through; this module only groups the flops
 * it was given. The six family names are naming data copied from TextureFamily::as_str in
 * crates/gto-model/src/iso.rs, in its precedence order, so the grid shows every family, empty
 * ones included; test/library/texture-families.test.ts reads that file and fails when the names
 * drift (the O-234 precedent for seat lists). A family the list does not know (solver-query's
 * "unknown" for a stored flop that does not parse) is shown after the named ones.
 */
import type { ApiComponents } from "@g-tee-oh/contracts";

export type Coverage = ApiComponents["schemas"]["Coverage"];
export type CoveredFlop = Coverage["flops"][number];

export const TEXTURE_FAMILIES = ["paired", "monotone", "two-tone-broadway", "dry-ace-high", "low-connected", "other"] as const;

const FAMILY_LABELS: Readonly<Record<string, string>> = {
  paired: "Paired",
  monotone: "Monotone",
  "two-tone-broadway": "Two-tone broadway",
  "dry-ace-high": "Dry ace high",
  "low-connected": "Low and connected",
  other: "Other",
};

export interface FamilyRow {
  readonly family: string;
  readonly label: string;
  /** Distinct covered flops in the family. */
  readonly flops: number;
  readonly scenarios: number;
}

export function familyLabel(family: string): string {
  return FAMILY_LABELS[family] ?? family;
}

/** One row per named family, then any other family the flops carry, each with its totals. */
export function familyRows(flops: readonly CoveredFlop[]): FamilyRow[] {
  const extra = [...new Set(flops.map((flop) => flop.texture_family))].filter(
    (family) => !(TEXTURE_FAMILIES as readonly string[]).includes(family),
  );
  return [...TEXTURE_FAMILIES, ...extra.sort()].map((family) => {
    const members = flops.filter((flop) => flop.texture_family === family);
    return {
      family,
      label: familyLabel(family),
      flops: new Set(members.map((flop) => flop.flop)).size,
      scenarios: members.reduce((sum, flop) => sum + flop.scenarios, 0),
    };
  });
}
