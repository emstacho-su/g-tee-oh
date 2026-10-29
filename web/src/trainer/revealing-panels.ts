/**
 * The panel keys that show the answer before the decision (S46, R3.13, R3.33, O-471). A hand copy
 * of the api's services/api/src/grading/policy.ts ANSWER_REVEALING_PANELS, which makes a decision
 * unrated when one of them is on; keep the two lists equal. Sharing one list through
 * packages/contracts is a contract change, recorded by the PM as an O-ID (PR #45 review round 1,
 * finding 9a). The web only names the fact, it never grades (ADR 0004).
 */
import type { PanelKey } from "../contracts.js";

export const REVEALING_PANELS: readonly PanelKey[] = ["hero_strategy_matrix", "action_frequency_table", "threshold_card"];

/** Whether a prompt's visible panels name one that reveals the answer. */
export function revealsAnswer(visiblePanels: readonly string[]): boolean {
  return REVEALING_PANELS.some((panel) => visiblePanels.includes(panel));
}
