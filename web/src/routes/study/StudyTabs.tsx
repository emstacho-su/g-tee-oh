/**
 * The study screen's right column as tabs (S45 follow-up, R3.26, item 10, design rule 12: a node
 * change redraws the canvas and the tables only, secondary panels mount lazily).
 *
 * Mechanism: the tabs come from study/study-views.ts: Overview (the range by action with its
 * filters and combos, the hovered or selected hand's row, and the range and nut advantage), Hands
 * (the selected hand's threshold card, blockers and role) and Compare (each action's served loss
 * for the hand). A tab exists only when it has data at the node, and a street-specific one carries
 * its street as a badge. The open tab is the address's view, else this browser's last tab, else
 * Overview (shownView); choosing a tab writes the view to the address with replace and remembers
 * it, so the address alone says which tab is open (PR 52 review 1). Compare follows the hovered
 * hand; between hovers it shows the selected hand, so a click on a cell is what keeps its buttons
 * (PR 52 review round 2: no hover pin). Radix mounts
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
import { useHoveredHand, type HoverStore } from "../../study/hover-store.js";
import { CompareTab } from "./CompareTab.js";
import { AdvantageInsights, HandDetails } from "./HandInsights.js";
import { NodeActionsPanel } from "./NodeActionsPanel.js";

export const STUDY_TABS_LABEL = "Study panels";

export interface StudyTabsProps {
  api: AppApi;
  node: StudyNode;
  /** The hovered hand (R3.25): the hand row and Compare follow it, each subscribing alone (code review 3). */
  hover: HoverStore;
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
  hover: HoverStore;
  /** The selected hand: the advantage read and, between hovers, the hand row. */
  selectedHand: string | undefined;
  filters: readonly number[];
  onToggleFilter: (index: number) => void;
}

const OverviewTab = memo(function OverviewTab({ api, node, hover, selectedHand, filters, onToggleFilter }: OverviewProps) {
  return (
    <>
      <NodeActionsPanel node={node} hand={selectedHand} hover={hover} filters={filters} onToggleFilter={onToggleFilter} />
      <AdvantageInsights api={api} node={node} hand={selectedHand} />
    </>
  );
});

const HandsTab = memo(HandDetails);

interface FollowingCompareProps {
  node: StudyNode;
  hover: HoverStore;
  selectedHand: string | undefined;
  onCompare: (index: number) => void;
}

/**
 * Compare for the hovered hand, else the selected one: a click on a cell selects it, which is how a
 * hand is kept for the buttons (design rule 2: hover reads, click pins). An earlier hover pin kept
 * the last hovered hand, so crossing edge cells on the way to the buttons re-pinned the wrong hand
 * (PR 52 review round 2). A hover re-renders only this.
 */
const FollowingCompare = memo(function FollowingCompare({ node, hover, selectedHand, onCompare }: FollowingCompareProps) {
  const hovered = useHoveredHand(hover);
  return <CompareTab node={node} hand={hovered ?? selectedHand} onCompare={onCompare} />;
});

export function StudyTabs(props: StudyTabsProps) {
  const { api, node, hover, selectedHand, filters, view } = props;
  // The remembered tab, read once and kept current by choose(), so an address without a view shows
  // the tab chosen last, not the one remembered at mount (PR 52 review round 2).
  const [stored, setStored] = useState(readStudyView);
  const onToggleFilter = useStableCallback(props.onToggleFilter);
  const onCompare = useStableCallback(props.onCompare);
  const open = shownView(node, view, stored);

  const choose = (next: StudyView) => {
    writeStudyView(next);
    setStored(next);
    props.onViewChange(next);
  };

  const tabs = useMemo<TabItem<StudyView>[]>(() => {
    const content: Record<StudyView, TabItem<StudyView>["content"]> = {
      overview: <OverviewTab api={api} node={node} hover={hover} selectedHand={selectedHand} filters={filters} onToggleFilter={onToggleFilter} />,
      hands: <HandsTab api={api} node={node} hand={selectedHand} />,
      compare: <FollowingCompare node={node} hover={hover} selectedHand={selectedHand} onCompare={onCompare} />,
    };
    return availableViews(node).map((entry) => {
      const badge = viewBadge(entry, node.street);
      return { value: entry, label: VIEW_LABELS[entry], content: content[entry], ...(badge === undefined ? {} : { badge }) };
    });
  }, [api, node, hover, selectedHand, filters, onToggleFilter, onCompare]);

  return <Tabs label={STUDY_TABS_LABEL} value={open} tabs={tabs} onValueChange={choose} />;
}
