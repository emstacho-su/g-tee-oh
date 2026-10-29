/**
 * The panel keys that show the answer before the decision (S46, R3.13, R3.33, O-471). They mirror
 * the api's grading/policy.ts ANSWER_REVEALING_PANELS, which makes a decision unrated when one of
 * them is on; the web only names the fact, it never grades (ADR 0004).
 */
import type { PanelKey } from "../contracts.js";

export const REVEALING_PANELS: readonly PanelKey[] = ["hero_strategy_matrix", "action_frequency_table", "threshold_card"];

/** Whether a prompt's visible panels name one that reveals the answer. */
export function revealsAnswer(visiblePanels: readonly string[]): boolean {
  return REVEALING_PANELS.some((panel) => visiblePanels.includes(panel));
}
