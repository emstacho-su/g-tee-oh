/**
 * The study screen's right column as tabs (S45 follow-up, R3.26, item 10, design rule 12: a node
 * change redraws the canvas and the tables only, secondary panels mount lazily).
 *
 * Mechanism: the tabs come from study/study-views.ts: Overview (the range by action with its
 * filters and combos, the hovered or selected hand's row, and the range and nut advantage), Hands
 * (the selected hand's threshold card, blockers and role) and Compare (each action's served loss
 * for the hand). A tab exists only when it has data at the node, and a street-specific one carries
 * its street as a badge. The open tab is the address's view, else this browser's last tab, else
 * Overview (shownView); choosing a tab writes the view with replace and remembers it. Radix mounts
 * only the open tab, so a closed tab's reads never start. Each body is memoised and gets stable
 * callbacks, so a re-render of the screen (a hover, a mode change) re-renders a body only when its
 * own inputs change; the reads inside are TanStack queries keyed on the node, so returning to a
 * node or a tab is a cache hit.
 */
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { AppApi } from "../../api/index.js";
import { Tabs, type TabItem } from "../../components/ui/Tabs.js";
import type { StudyNode } from "../../contracts.js";
import { readStudyView, writeStudyView } from "../../store/study-view.js";
import { VIEW_LABELS, availableViews, shownView, viewBadge, type StudyView } from "../../study/study-views.js";
import { CompareTab } from "./CompareTab.js";
import { AdvantageInsights, HandDetails } from "./HandInsights.js";
import { NodeActionsPanel } from "./NodeActionsPanel.js";

export const STUDY_TABS_LABEL = "Study panels";

export interface StudyTabsProps {
  api: AppApi;
  node: StudyNode;
  /** The hovered hand, else the selected one: the hand row and Compare follow it (R3.25). */
  rowHand: string | undefined;
  /** The selected hand: the Hands tab's reads stay on it, never on a hover. */
  selectedHand: string | undefined;
  /** The filters that name an action here (knownFilters). */
  filters: readonly number[];
  onToggleFilter: (index: number) => void;
  /** The address's view, if any. */
  view: StudyView | undefined;
  onViewChange: (view: StudyView) => void;
  onCompare: (index: number) => void;
}

/** A callback whose identity never changes but which always calls the latest function. */
function useStableCallback<A extends unknown[]>(callback: (...args: A) => void): (...args: A) => void {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}

interface OverviewProps {
  api: AppApi;
  node: StudyNode;
  hand: string | undefined;
  filters: readonly number[];
  onToggleFilter: (index: number) => void;
}

const OverviewTab = memo(function OverviewTab({ api, node, hand, filters, onToggleFilter }: OverviewProps) {
  return (
    <>
      <NodeActionsPanel node={node} hand={hand} filters={filters} onToggleFilter={onToggleFilter} />
      <AdvantageInsights api={api} node={node} />
    </>
  );
});

const HandsTab = memo(HandDetails);

export function StudyTabs(props: StudyTabsProps) {
  const { api, node, rowHand, selectedHand, filters, view } = props;
  const [stored] = useState(readStudyView);
  const [chosen, setChosen] = useState<StudyView | null>(null);
  const onToggleFilter = useStableCallback(props.onToggleFilter);
  const onCompare = useStableCallback(props.onCompare);
  const open = shownView(node, view ?? chosen ?? undefined, stored);

  const choose = (next: StudyView) => {
    setChosen(next);
    writeStudyView(next);
    props.onViewChange(next);
  };

  const tabs = useMemo<TabItem<StudyView>[]>(() => {
    const content: Record<StudyView, TabItem<StudyView>["content"]> = {
      overview: <OverviewTab api={api} node={node} hand={rowHand} filters={filters} onToggleFilter={onToggleFilter} />,
      hands: <HandsTab api={api} node={node} hand={selectedHand} />,
      compare: <CompareTab node={node} hand={rowHand} onCompare={onCompare} />,
    };
    return availableViews(node).map((entry) => {
      const badge = viewBadge(entry, node.street);
      return { value: entry, label: VIEW_LABELS[entry], content: content[entry], ...(badge === undefined ? {} : { badge }) };
    });
  }, [api, node, rowHand, selectedHand, filters, onToggleFilter, onCompare]);

  return <Tabs label={STUDY_TABS_LABEL} value={open} tabs={tabs} onValueChange={choose} />;
}
