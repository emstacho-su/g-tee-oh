/**
 * The drill's preflop action vocabulary over solver-query's action families (R3.6, 05 section 4,
 * ADR 0004, O-249, PR #25 re-review BLOCKER 1). The api never reads a line to classify it: a
 * node's family is NodeResponse.action_family, gto-model's ActionFamily::classify over the key's
 * pair and preflop line, and this module only looks the drill's family up in one table. The table
 * is pinned to classify's committed output (validation/fixtures/action-family-vectors.json) by
 * test/sessions-action-family.test.ts.
 *
 * The table, by the hero decision each drill family trains:
 * - rfi: rfi (no raise before the hero);
 * - vs_open, three_bet: facing-open (the decision facing one raise, where a 3-bet is one option);
 * - srp: facing-open and squeeze, every decision facing exactly one raise, the decisions that
 *   make or keep a single-raised pot (squeeze is one raise with a caller behind it);
 * - vs_three_bet: facing-3bet;
 * - four_bet: facing-3bet and facing-4bet: the decision to 4-bet is made facing a 3-bet, and no
 *   other drill family names a 4-bet pot, so leaving facing-4bet out would make it untrainable;
 * - squeeze: squeeze; limp_iso: limped-isolation; straddle: straddled-pot.
 * Blind versus blind: classify names every SB-BB line blind-vs-blind, so at an SB-BB pair that
 * family satisfies any drill family, and the hero seat and the line decide the spot. A postflop
 * node (no family) or a family this table does not know matches nothing.
 */
import { PREFLOP_ACTIONS } from "../schemas/drills.js";

export type PreflopAction = (typeof PREFLOP_ACTIONS)[number];

/** Every family ActionFamily::as_str writes (crates/gto-model/src/spot_class.rs). */
export const RUST_ACTION_FAMILIES = [
  "rfi",
  "facing-open",
  "facing-3bet",
  "facing-4bet",
  "squeeze",
  "blind-vs-blind",
  "limped-isolation",
  "straddled-pot",
] as const;

export type RustActionFamily = (typeof RUST_ACTION_FAMILIES)[number];

const BLIND_VS_BLIND: RustActionFamily = "blind-vs-blind";

/** The Rust families each drill family accepts; blind-vs-blind is accepted by all (see the module doc). */
export const DRILL_FAMILY_TABLE: Readonly<Record<PreflopAction, readonly RustActionFamily[]>> = {
  rfi: ["rfi"],
  vs_open: ["facing-open"],
  srp: ["facing-open", "squeeze"],
  three_bet: ["facing-open"],
  vs_three_bet: ["facing-3bet"],
  four_bet: ["facing-3bet", "facing-4bet"],
  squeeze: ["squeeze"],
  limp_iso: ["limped-isolation"],
  straddle: ["straddled-pot"],
};

function isRustFamily(family: string): family is RustActionFamily {
  return (RUST_ACTION_FAMILIES as readonly string[]).includes(family);
}

/** The drill families a node of `family` satisfies, in the PREFLOP_ACTIONS order. */
export function drillFamiliesFor(family: string | null | undefined): PreflopAction[] {
  if (family === null || family === undefined || !isRustFamily(family)) {
    return [];
  }
  if (family === BLIND_VS_BLIND) {
    return [...PREFLOP_ACTIONS];
  }
  return PREFLOP_ACTIONS.filter((drill) => DRILL_FAMILY_TABLE[drill].includes(family));
}

/** True when a node of `family` is in any of the drill's families. */
export function familyMatches(wanted: readonly PreflopAction[], family: string | null | undefined): boolean {
  const satisfied = drillFamiliesFor(family);
  return wanted.some((drill) => satisfied.includes(drill));
}
