/**
 * The action filters of the study screen (S45, R3.12, O-468, design rule 3: the action table is
 * both legend and filter). Pure.
 *
 * Mechanism: the `filters` address parameter is a comma list of NodeAction.index values
 * (search.ts validates its shape); parseFilters reads it, withFilters writes the sorted set back
 * and drops the parameter when the set is empty, so the address stays short. nextFilterState is
 * the click rule: a row toggles its own index; a second row clicked while exactly one is selected
 * opens Compare to Best on that row and keeps both, so "how does calling compare to raising here"
 * is two clicks; with two or more selected a click only adds or removes. The set travels with
 * replace and stays through mode and hand changes, but it belongs to one node: a line, depth or
 * stake change drops it with the lens (filters.ts withoutNodeChoices), because a NodeAction.index
 * names another action at another node (code review; carrying a filter by action kind needs the
 * next node's actions and is deferred, O-468). Indexes that name no action at a node are ignored
 * where they are read (knownFilters), never rewritten, so a stale link still opens.
 */
import { validateStudySearch, type StudySearch } from "./search.js";

const FILTER_SEPARATOR = ",";

export interface FilterClick {
  /** The filter set after the click, sorted. */
  readonly filters: readonly number[];
  /** The NodeAction.index to compare to the best, or null when the click only toggled. */
  readonly compare: number | null;
}

/** The filtered NodeAction.index values in address order; none when the parameter is absent. */
export function parseFilters(search: Pick<StudySearch, "filters">): number[] {
  if (search.filters === undefined || search.filters === "") return [];
  return search.filters.split(FILTER_SEPARATOR).map(Number);
}

/** The search with the filter set written sorted, or without the parameter when the set is empty. */
export function withFilters(search: StudySearch, filters: readonly number[]): StudySearch {
  const rest = Object.fromEntries(Object.entries(search).filter(([key]) => key !== "filters"));
  if (filters.length === 0) return validateStudySearch(rest);
  const sorted = [...new Set(filters)].sort((left, right) => left - right);
  return validateStudySearch({ ...rest, filters: sorted.join(FILTER_SEPARATOR) });
}

/** The click rule (O-468); see the module doc. */
export function nextFilterState(current: readonly number[], clicked: number): FilterClick {
  const sorted = (values: readonly number[]) => [...values].sort((left, right) => left - right);
  if (current.includes(clicked)) return { filters: sorted(current.filter((index) => index !== clicked)), compare: null };
  const filters = sorted([...current, clicked]);
  return { filters, compare: current.length === 1 ? clicked : null };
}

/** The filters that name an action at this node, in address order. */
export function knownFilters(filters: readonly number[], actions: readonly { index: number }[]): number[] {
  return filters.filter((index) => actions.some((action) => action.index === index));
}
