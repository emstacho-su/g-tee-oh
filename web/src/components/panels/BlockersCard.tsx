/**
 * The blockers card and the hand role chip (S45, R3.12, ADR 0004): what the selected hand removes
 * from the opponent's range, and the role solver-query gives it at this node.
 *
 * Mechanism: StudyInsights.blockers as served: the opponent's combos the hand removes, the share of
 * the opponent's reach those combos carry, and the most blocked opponent classes with the share of
 * each class removed, as chips. The role (value, marginal, bluff, fold, trap) is
 * StudyInsights.hand_role, named in words; a null role prints nothing. The card has a row list, so
 * the combo and EV-split rows the contract does not carry yet join by appending an entry, with
 * nothing empty rendered now. Every number is the api's, only formatted with one decimal.
 */
import { useId } from "react";

import type { StudyInsights } from "../../contracts.js";
import { formatShare } from "../../poker/format.js";
import { RAISED_CLASS, cn } from "../ui/index.js";

export type HandRole = NonNullable<StudyInsights["hand_role"]>;

export const ROLE_NAMES: Readonly<Record<HandRole, string>> = {
  value: "Value",
  marginal: "Marginal",
  bluff: "Bluff",
  fold: "Fold",
  trap: "Trap",
};

export const BLOCKERS_TEXT = {
  title: "Blockers",
  topBlocked: "Most blocked hands",
  role: (role: HandRole) => `Role: ${ROLE_NAMES[role].toLowerCase()}`,
  removes: (combos: number, share: string) => `Removes ${combos} ${combos === 1 ? "combo" : "combos"}, ${share} of the opponent's range`,
  removesNone: "Removes no combos of the opponent's range",
} as const;

export interface BlockersCardProps {
  blockers: StudyInsights["blockers"];
  role: StudyInsights["hand_role"];
}

/** The card's text rows in order; a later contract field joins as one more entry. */
function blockerRows(blockers: StudyInsights["blockers"], role: StudyInsights["hand_role"]): string[] {
  const removed =
    blockers.villain_combos_removed > 0
      ? BLOCKERS_TEXT.removes(blockers.villain_combos_removed, formatShare(blockers.villain_reach_removed_share))
      : BLOCKERS_TEXT.removesNone;
  return [...(role === null ? [] : [BLOCKERS_TEXT.role(role)]), removed];
}

export function BlockersCard({ blockers, role }: BlockersCardProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn("flex min-w-0 flex-col gap-2 rounded-2xl border border-border/50 bg-surface-raised p-4 text-sm", RAISED_CLASS)}
    >
      <h3 id={titleId} className="font-semibold">
        {BLOCKERS_TEXT.title}
      </h3>
      {blockerRows(blockers, role).map((row) => (
        <p key={row}>{row}</p>
      ))}
      {blockers.top_blocked.length === 0 ? null : (
        <ul aria-label={BLOCKERS_TEXT.topBlocked} className="flex flex-wrap gap-1.5">
          {blockers.top_blocked.map((entry) => (
            <li key={entry.hand} className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium tabular-nums">
              {`${entry.hand} ${formatShare(entry.reach_removed)}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export interface HandRoleChipProps {
  role: StudyInsights["hand_role"];
}

/** The hand's role at this node as a chip in words; nothing for a null role. */
export function HandRoleChip({ role }: HandRoleChipProps) {
  if (role === null) return null;
  return (
    <span data-testid="hand-role" className="rounded-full border border-border px-2 text-xs font-semibold">
      {ROLE_NAMES[role]}
    </span>
  );
}
