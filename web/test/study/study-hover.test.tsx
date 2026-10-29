/**
 * Tests for hover on the study screen (S45, R3.25): the hand row beside the matrix follows the
 * hovered cell with no address write, falls back to the selected hand when the pointer leaves,
 * and the insights (the threshold card) stay on the selected hand, so a sweep over the matrix
 * reads no insights.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_ONLINE_STAKE_ID, FIXTURE_STUDY_PAIR } from "../../src/fixtures/study.js";
import { renderStudy } from "./render-study.js";

const BASE = `/study?format=online&table_size=6&stake=${FIXTURE_ONLINE_STAKE_ID}&depth=10000&pair=${FIXTURE_STUDY_PAIR}`;
const CELL_PX = 40;

let spies: { mockRestore: () => void }[] = [];

beforeEach(() => {
  spies = [
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null),
    vi.spyOn(console, "info").mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  spies.forEach((spy) => spy.mockRestore());
});

async function placedCanvas(): Promise<HTMLElement> {
  const canvas = await screen.findByRole("img", { name: /^Range matrix/ });
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 520, height: 520 }));
  return canvas;
}

describe("R3.25 hover on the study screen", () => {
  it("R3.25 the hand row follows the hovered cell and returns to the selected hand; the address does not change", async () => {
    const { router, requests } = renderStudy(`${BASE}&hand=AKs`);
    const canvas = await placedCanvas();
    expect(await screen.findByRole("table", { name: "AKs at this node: strategy and EV" })).toBeInTheDocument();
    fireEvent.pointerMove(canvas, { clientX: CELL_PX * 2 + 5, clientY: CELL_PX * 1 + 5 });
    expect(await screen.findByRole("table", { name: "KQs at this node: strategy and EV" })).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({ hand: "AKs" });
    fireEvent.pointerLeave(canvas);
    expect(await screen.findByRole("table", { name: "AKs at this node: strategy and EV" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("threshold-card")).toHaveTextContent("Your hand: AKs"));
    const insightHands = requests.filter((request) => request.path === "/api/v1/study/insights").map((request) => request.query["hand"]);
    expect(insightHands).not.toContain("KQs");
  });

  it("R3.25 with no selected hand, hovering shows the hovered hand's row and leaving shows none", async () => {
    renderStudy(BASE);
    const canvas = await placedCanvas();
    expect(screen.queryByRole("table", { name: /at this node: strategy and EV/ })).not.toBeInTheDocument();
    fireEvent.pointerMove(canvas, { clientX: 5, clientY: 5 });
    expect(await screen.findByRole("table", { name: "AA at this node: strategy and EV" })).toBeInTheDocument();
    fireEvent.pointerLeave(canvas);
    await waitFor(() => expect(screen.queryByRole("table", { name: /at this node: strategy and EV/ })).not.toBeInTheDocument());
  });
});
