/**
 * The study screen's right-column tabs (S45 follow-up, R3.26, item 10). Pure.
 *
 * Mechanism: three views, Overview (the range by action, the hand row and the range and nut
 * advantage), Hands (the selected hand's threshold card, blockers and role) and Compare (each
 * action's served loss against the best for the hand). A tab exists only when it has data at the
 * node: Hands needs hand rows; Compare needs hand rows and at least two actions to compare. A
 * street-specific tab, Hands (the threshold card and role come from equity, which solver-query
 * computes preflop only in v1, O-32), carries the node's street as a badge instead of an empty
 * body. The tab that shows is the address's view, else the browser's last tab, else Overview,
 * falling back to Overview when the chosen tab has no data at this node; the address is never
 * rewritten for it.
 */
import type { StudyNode } from "../contracts.js";

export const STUDY_VIEWS = ["overview", "hands", "compare"] as const;
export type StudyView = (typeof STUDY_VIEWS)[number];

export const VIEW_LABELS: Readonly<Record<StudyView, string>> = {
  overview: "Overview",
  hands: "Hands",
  compare: "Compare",
};

const DEFAULT_VIEW: StudyView = "overview";
const STREET_SPECIFIC: ReadonlySet<StudyView> = new Set<StudyView>(["hands"]);
/** Compare sets each action against the best, so it needs a second action (PR 52 review 1). */
const MIN_COMPARE_ACTIONS = 2;

type ViewNode = Pick<StudyNode, "actions" | "hands">;

function hasData(view: StudyView, node: ViewNode): boolean {
  if (view === "overview") return true;
  if (node.hands.length === 0) return false;
  return view === "hands" || node.actions.length >= MIN_COMPARE_ACTIONS;
}

/** The views this node has data for, in tab order. */
export function availableViews(node: ViewNode): StudyView[] {
  return STUDY_VIEWS.filter((view) => hasData(view, node));
}

/** "Preflop" on a street-specific tab; undefined on the others. */
export function viewBadge(view: StudyView, street: StudyNode["street"]): string | undefined {
  if (!STREET_SPECIFIC.has(view)) return undefined;
  return `${street.charAt(0).toUpperCase()}${street.slice(1)}`;
}

/** The view that shows: the address's, else the stored one, else Overview; Overview when the chosen one has no data. */
export function shownView(node: ViewNode, addressed: StudyView | undefined, stored: StudyView | null): StudyView {
  const wanted = addressed ?? stored ?? DEFAULT_VIEW;
  return hasData(wanted, node) ? wanted : DEFAULT_VIEW;
}

export function isStudyView(value: unknown): value is StudyView {
  return typeof value === "string" && (STUDY_VIEWS as readonly string[]).includes(value);
}
