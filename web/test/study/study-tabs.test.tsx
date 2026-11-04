/**
 * The study screen's right-column tabs (S45 follow-up, R3.12, R3.26; PR 52 review round 2
 * leftovers for S48): Compare follows the hovered hand and, between hovers, the selected one,
 * with no hover pin, so crossing cells on the way to its buttons never re-pins the wrong hand;
 * choosing a tab updates the remembered view at once, so an address without a view shows the tab
 * just chosen; and the same-node placeholder of the insights read recognises a key the query
 * factory built.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createAppApi } from "../../src/api/index.js";
import { fixtureInsights, fixtureStudyNode } from "../../src/fixtures/index.js";
import { COMPARE_TEXT } from "../../src/routes/study/CompareTab.js";
import { sameNodePlaceholder } from "../../src/routes/study/HandInsights.js";
import { StudyTabs } from "../../src/routes/study/StudyTabs.js";
import { readStudyView } from "../../src/store/study-view.js";
import { createHoverStore } from "../../src/study/hover-store.js";
import { studyInsightsQuery } from "../../src/study/queries.js";
import type { StudyView } from "../../src/study/study-views.js";
import { createFakeFetch, jsonResponse } from "../api/fake-fetch.js";
import { TEST_ORIGIN } from "../app/render-app.js";

function renderTabs(view: StudyView | undefined, selectedHand: string | undefined) {
  const hover = createHoverStore();
  const onViewChange = vi.fn();
  const api = createAppApi({ baseUrl: TEST_ORIGIN, fetch: createFakeFetch({ "GET /api/v1/study/insights": [jsonResponse(200, fixtureInsights)] }).fetch });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view_ = render(
    <QueryClientProvider client={client}>
      <StudyTabs api={api} node={fixtureStudyNode} hover={hover} selectedHand={selectedHand} filters={[]} onToggleFilter={vi.fn()} view={view} onViewChange={onViewChange} onCompare={vi.fn()} />
    </QueryClientProvider>,
  );
  return { ...view_, hover, onViewChange };
}

describe("R3.12 Compare follows the hovered hand, else the selected one", () => {
  it("R3.12 with nothing selected, Compare shows the hovered hand and asks for a cell once the hover ends: no hover pin", () => {
    const { hover } = renderTabs("compare", undefined);
    expect(screen.getByText(COMPARE_TEXT.pick)).toBeInTheDocument();
    act(() => hover.set("AA"));
    expect(screen.getByRole("list", { name: COMPARE_TEXT.list("AA") })).toBeInTheDocument();
    act(() => hover.set("KK"));
    expect(screen.getByRole("list", { name: COMPARE_TEXT.list("KK") })).toBeInTheDocument();
    act(() => hover.set(null));
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText(COMPARE_TEXT.pick)).toBeInTheDocument();
  });

  it("R3.12 with a hand selected, Compare returns to it once the hover ends", () => {
    const { hover } = renderTabs("compare", "QQ");
    expect(screen.getByRole("list", { name: COMPARE_TEXT.list("QQ") })).toBeInTheDocument();
    act(() => hover.set("AA"));
    expect(screen.getByRole("list", { name: COMPARE_TEXT.list("AA") })).toBeInTheDocument();
    act(() => hover.set(null));
    expect(screen.getByRole("list", { name: COMPARE_TEXT.list("QQ") })).toBeInTheDocument();
  });
});

describe("R3.12 the chosen tab is remembered at once", () => {
  it("R3.12 choosing Compare with no view in the address shows Compare and stores it, so a later render without a view keeps it", async () => {
    const { onViewChange, rerender, hover } = renderTabs(undefined, undefined);
    const tabs = screen.getByRole("tablist");
    expect(within(tabs).getByRole("tab", { name: /Overview/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(within(tabs).getByRole("tab", { name: /Compare/ }));
    expect(onViewChange).toHaveBeenCalledWith("compare");
    expect(readStudyView()).toBe("compare");
    // The address still names no view (the parent has not re-rendered with one): the chosen tab stays open.
    expect(within(tabs).getByRole("tab", { name: /Compare/ })).toHaveAttribute("aria-selected", "true");
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <StudyTabs api={createAppApi({ baseUrl: TEST_ORIGIN, fetch: createFakeFetch({}).fetch })} node={fixtureStudyNode} hover={hover} selectedHand={undefined} filters={[]} onToggleFilter={vi.fn()} view={undefined} onViewChange={onViewChange} onCompare={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(within(screen.getByRole("tablist")).getByRole("tab", { name: /Compare/ })).toHaveAttribute("aria-selected", "true");
  });
});

describe("R3.12 the insights placeholder", () => {
  it("R3.12 keeps the previous read for a key the query factory built for the same node, and drops it for another node", () => {
    const api = createAppApi({ baseUrl: TEST_ORIGIN, fetch: createFakeFetch({}).fetch });
    const node = { solution_id: fixtureStudyNode.solution_id, node_key: fixtureStudyNode.node_key };
    const sameNode = studyInsightsQuery(api, { solutionId: node.solution_id, nodeKey: node.node_key, hand: "AA" }).queryKey;
    const otherNode = studyInsightsQuery(api, { solutionId: node.solution_id, nodeKey: `${node.node_key}r250`, hand: "AA" }).queryKey;
    const keep = sameNodePlaceholder(node);
    expect(keep(fixtureInsights, { queryKey: sameNode })).toBe(fixtureInsights);
    expect(keep(fixtureInsights, { queryKey: otherNode })).toBeUndefined();
    expect(keep(fixtureInsights, undefined)).toBeUndefined();
  });
});
