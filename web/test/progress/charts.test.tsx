// The /progress charts (S32, R4.12, O-320, O-321, O-277): TrackBreakdown, LeakTrendChart with its
// sparklines, MasteryHeatMap and HoldoutCard over the synthetic fixtures. Counts are worked out by
// hand from the formulas in src/fixtures/progress.ts.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  GOODHART_TEXT,
  HoldoutCard,
  latestClosedByTrack,
  LeakTrendChart,
  MasteryHeatMap,
  NO_CLASSES_TEXT,
  NO_COVERAGE_TEXT,
  NO_HOLDOUT_TEXT,
  NO_LEAKS_TEXT,
  ratingAxis,
  TrackBreakdown,
} from "../../src/components/progress/index.js";
import {
  fixtureFreshHoldout,
  fixtureFreshLeaks,
  fixtureHeatmap,
  fixtureHoldout,
  fixtureLeaks,
  fixtureTracks,
} from "../../src/fixtures/progress.js";
import { NOT_ON_HEATMAP_REASON } from "../../src/progress/leak-model.js";
import type { LeakItem, LeakWeeks } from "../../src/progress/types.js";

const CELL_COUNT = 40;
const NEW_CELLS = 8;
const MASTERED_CELLS = 7;
const DUE_CELLS = 22;

describe("R4.12 TrackBreakdown", () => {
  it("R4.12 one shared axis over mu plus and minus RD, snapped to 100", () => {
    // Lowest: the idle live track, 1500 - 350; highest: the same track, 1500 + 350.
    expect(ratingAxis(fixtureTracks)).toEqual({ min: 1100, max: 1900 });
    expect(ratingAxis([{ ...(fixtureTracks[0] as (typeof fixtureTracks)[number]), mu: 1500, rd: 0 }])).toEqual({ min: 1500, max: 1600 });
  });

  it("R4.12 a row per track with its figures in words; weight 0 says no coverage", () => {
    render(<TrackBreakdown tracks={fixtureTracks} />);
    const rows = screen.getAllByTestId("track-row");
    expect(rows).toHaveLength(7);
    expect(rows[0]).toHaveTextContent("Opens");
    expect(rows[0]).toHaveTextContent("1684 ± 61, conservative 1562, weight 31%, 412 rated decisions");
    expect(rows[6]).toHaveTextContent(NO_COVERAGE_TEXT);
    expect(rows[6]?.className).toContain("opacity-60");
    expect(rows[0]?.className).not.toContain("opacity-60");
  });

  it("R4.12 the track table is for screen readers only, beside the chart, with no toggle (O-347)", () => {
    render(<TrackBreakdown tracks={fixtureTracks} />);
    expect(screen.queryByRole("button", { name: /Show (table|chart)/ })).toBeNull();
    const table = screen.getByRole("table", { name: "Rating by track" });
    expect(table.closest(".sr-only")).not.toBeNull();
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    expect(within(table).getByRole("rowheader", { name: "Blind defense" }).closest("tr")).toHaveTextContent("1551± 821387");
    expect(screen.getAllByTestId("track-row")).toHaveLength(7);
  });

  it("R4.12 the visual rows are hidden from screen readers, so the table is the one representation (S36 review)", () => {
    render(<TrackBreakdown tracks={fixtureTracks} />);
    expect(screen.getByTestId("track-visual")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByTestId("track-row")[0]).toBeVisible();
  });

  it("R4.12 no tracks says so", () => {
    render(<TrackBreakdown tracks={[]} />);
    expect(screen.getByText("No rating tracks yet.")).toBeInTheDocument();
  });
});

function renderTrend(overrides: Partial<Parameters<typeof LeakTrendChart>[0]> = {}) {
  const onDrill = vi.fn();
  const onWeeksChange = vi.fn<(weeks: LeakWeeks) => void>();
  render(<LeakTrendChart leaks={fixtureLeaks} heatmap={fixtureHeatmap} weeks={8} onWeeksChange={onWeeksChange} onDrill={onDrill} {...overrides} />);
  return { onDrill, onWeeksChange };
}

describe("R4.12 LeakTrendChart", () => {
  it("R4.12 ten ranked rows with label, current cost, sparkline and partial week", () => {
    renderTrend();
    const rows = screen.getAllByTestId("leak-row");
    expect(rows).toHaveLength(10);
    expect(rows[0]).toHaveTextContent("1rfi BB-UTG, live 100 bb42.0 bb per 1,000 hours".replace("hours", "hands"));
    expect(screen.getAllByTestId("leak-sparkline")).toHaveLength(10);
    expect(screen.getAllByTestId("leak-partial-marker")).toHaveLength(10);
    // S36 review: the name lists every week, so the partial week is named there, not in a second note.
    expect(screen.queryByText(/still counting/)).toBeNull();
    expect(screen.getByRole("img", { name: /^rfi BB-UTG, live 100 bb, bb per 1,000 hands by week: Week of Sep 7: 58\.8; .*Oct 26, this week \(partial\): 42\.0$/ })).toBeInTheDocument();
  });

  it("R4.12 a drill button opens that row's class; the pending one is disabled", () => {
    const { onDrill } = renderTrend({ pendingKey: fixtureLeaks.items[1]?.spot_class_key ?? null, message: "No covered configuration matches this spot" });
    fireEvent.click(screen.getByRole("button", { name: "Drill this spot: rfi BB-UTG, live 100 bb" }));
    expect(onDrill).toHaveBeenCalledWith({
      spotClassKey: fixtureLeaks.items[0]?.spot_class_key,
      spot: { family: "rfi", pair: "BB-UTG", format: "live", depthBand: "100" },
    });
    expect(screen.getByRole("button", { name: "Drill this spot: rfi BB-CO, live 100 bb" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("No covered configuration matches this spot");
  });

  it("R4.12 a row without a heat map cell says why it has no drill", () => {
    const stranger: LeakItem = { ...(fixtureLeaks.items[0] as LeakItem), spot_class_key: "absent" };
    renderTrend({ leaks: { ...fixtureLeaks, items: [stranger] } });
    expect(screen.getByText(NOT_ON_HEATMAP_REASON)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Drill this spot/ })).toBeNull();
  });

  it("R4.12 the weeks selector offers 4, 8 and 26 weeks", () => {
    const { onWeeksChange } = renderTrend();
    const group = screen.getByRole("radiogroup", { name: "Weeks shown" });
    expect(within(group).getAllByRole("radio").map((item) => item.textContent)).toEqual(["4 weeks", "8 weeks", "26 weeks"]);
    fireEvent.click(within(group).getByRole("radio", { name: "26 weeks" }));
    expect(onWeeksChange).toHaveBeenCalledWith(26);
  });

  it("R4.12 each row's sparkline names every week, the partial one marked and gaps as no data; no second table (O-347, S36 review)", () => {
    renderTrend();
    expect(screen.queryByRole("button", { name: /Show (table|chart)/ })).toBeNull();
    expect(screen.queryByTestId("leak-table")).toBeNull();
    expect(screen.getAllByTestId("leak-row")).toHaveLength(10);
    const line = screen.getByRole("img", { name: /^rfi BB-UTG, live 100 bb, / });
    const name = line.getAttribute("aria-label") ?? "";
    // The unit is said once, before the weeks (S36 follow-up), not after every value.
    expect(name).toMatch(/^rfi BB-UTG, live 100 bb, bb per 1,000 hands by week: Week of Sep 7: 58\.8; /);
    expect(name).toContain("Week of Sep 21: no data");
    expect(name).toMatch(/; Oct 26, this week \(partial\): 42\.0$/);
    expect(name.match(/bb per 1,000 hands/g)).toHaveLength(1);
    expect(name.split("; ")).toHaveLength(8);
  });

  it("R4.12 no leaks shows the empty state and no table", () => {
    renderTrend({ leaks: fixtureFreshLeaks });
    expect(screen.getByText(NO_LEAKS_TEXT)).toBeInTheDocument();
    expect(screen.queryByTestId("leak-table")).toBeNull();
  });

  it("R4.12 the sparkline tooltip follows focus, arrow keys and hover", () => {
    renderTrend();
    const line = screen.getByRole("img", { name: /^rfi BB-UTG, live 100 bb, / });
    fireEvent.focus(line);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Oct 26, this week (partial): 42.0 bb per 1,000 hands");
    // The name already lists every week, so the tooltip is a sighted echo, not a description (S36 follow-up).
    expect(line).not.toHaveAttribute("aria-describedby");
    fireEvent.keyDown(line, { key: "ArrowLeft" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Week of Oct 19: 44.4 bb per 1,000 hands");
    for (let step = 0; step < 4; step += 1) fireEvent.keyDown(line, { key: "ArrowLeft" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Week of Sep 21: no data");
    fireEvent.keyDown(line, { key: "Enter" });
    fireEvent.keyDown(line, { key: "ArrowRight" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Week of Sep 28");
    fireEvent.blur(line);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseMove(line, { clientX: 0 });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Week of Sep 7: 58.8 bb per 1,000 hands");
    fireEvent.mouseLeave(line);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("R4.12 MasteryHeatMap", () => {
  it("R4.12 a cell per class with percents, new, mastered, due and recall marks", () => {
    render(<MasteryHeatMap heatmap={fixtureHeatmap} onDrill={vi.fn()} />);
    const cells = screen.getAllByTestId("heat-cell");
    expect(cells).toHaveLength(CELL_COUNT);
    expect(cells.filter((cell) => cell.getAttribute("data-state") === "new")).toHaveLength(NEW_CELLS);
    expect(cells.filter((cell) => cell.textContent?.includes("✓"))).toHaveLength(MASTERED_CELLS);
    expect(screen.getAllByTestId("heat-due")).toHaveLength(DUE_CELLS);
    expect(cells[0]).toHaveTextContent("12%");
    expect(cells[0]?.className).toContain("bg-heat-1");
    expect(cells[0]?.className).toContain("text-heat-ink-low");
    expect(cells[2]).toHaveTextContent("new");
    expect(screen.getByRole("list", { name: "Heat map legend" })).toHaveTextContent("95% and up");
  });

  it("R4.12 rows are grouped under their family with sticky pair headers", () => {
    render(<MasteryHeatMap heatmap={fixtureHeatmap} onDrill={vi.fn()} />);
    // Scoped to the grid: the screen-reader table beside it has headers of its own (O-347).
    const grid = screen.getByTestId("heat-grid");
    expect(within(grid).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Pair", "live 100 bb", "online 100 bb", "online 150 bb", "online 200 bb", "rfi", "facing-open", "facing-3bet", "blind-vs-blind"]);
    expect(within(grid).getAllByRole("rowheader")).toHaveLength(10);
  });

  it("R4.12 the tooltip shows on focus and hover; a click opens the cell's drill", () => {
    const onDrill = vi.fn();
    render(<MasteryHeatMap heatmap={fixtureHeatmap} onDrill={onDrill} />);
    const cell = screen.getByRole("button", { name: /^rfi BB-UTG, live 100 bb:/ });
    fireEvent.focus(cell);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("rfi BB-UTG, live 100 bbKnown: 12%Recall: 98%Attempts: 6Mastered: noDue for review: no");
    // The name already holds every value; linking the tooltip would read them twice (S36 follow-up).
    expect(cell).not.toHaveAttribute("aria-describedby");
    fireEvent.blur(cell);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(cell);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseLeave(cell);
    fireEvent.click(cell);
    expect(onDrill).toHaveBeenCalledWith({
      spotClassKey: fixtureHeatmap.cells[0]?.spot_class_key,
      spot: { family: "rfi", pair: "BB-UTG", format: "live", depthBand: "100" },
    });
  });

  it("R4.12 the pending cell is disabled and the card's message shows", () => {
    render(<MasteryHeatMap heatmap={fixtureHeatmap} onDrill={vi.fn()} pendingKey={fixtureHeatmap.cells[0]?.spot_class_key ?? null} message="Could not open a drill: Not found." />);
    expect(screen.getAllByTestId("heat-cell")[0]).toBeDisabled();
    expect(screen.getAllByTestId("heat-cell")[1]).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not open a drill: Not found.");
  });

  it("R4.12 the labelled cell buttons are the one representation: every value in each name, no second table (O-347, S36 review)", () => {
    render(<MasteryHeatMap heatmap={fixtureHeatmap} onDrill={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Show (table|chart)/ })).toBeNull();
    expect(screen.queryByTestId("heat-table")).toBeNull();
    // The grid of cell buttons is the card's only table.
    const tables = screen.getAllByRole("table");
    expect(tables).toHaveLength(1);
    expect(screen.getByTestId("heat-grid").contains(tables[0] ?? null) || tables[0] === screen.getByTestId("heat-grid")).toBe(true);
    const cells = screen.getAllByTestId("heat-cell");
    expect(cells).toHaveLength(CELL_COUNT);
    expect(cells[0]).toHaveAccessibleName(/^rfi BB-UTG, live 100 bb: .*12%.*98%.*6.*Mastered: no.*Due for review: no$/);
  });

  it("R4.12 an empty heat map says so", () => {
    render(<MasteryHeatMap heatmap={{ rows: [], columns: [], cells: [] }} onDrill={vi.fn()} />);
    expect(screen.getByText(NO_CLASSES_TEXT)).toBeInTheDocument();
  });
});

describe("R4.12 HoldoutCard", () => {
  it("R4.12 the open round and the newest closed round per track, with the Goodhart flag in words", () => {
    render(<HoldoutCard holdout={fixtureHoldout} trackNames={{ opens: "Opens" }} action={<button type="button">Retest</button>} />);
    expect(screen.getByTestId("holdout-open")).toHaveTextContent("October 2026 round, open12 of 30 answered (40%)");
    const tracks = screen.getAllByTestId("holdout-track");
    expect(tracks).toHaveLength(3);
    expect(tracks[0]).toHaveTextContent("Opens (September 2026)30 of 30 answered, mean score 81%, rating at close 1671");
    expect(tracks[1]).toHaveTextContent("facing-open-ip (September 2026)");
    expect(screen.getAllByTestId("goodhart-flag")).toHaveLength(1);
    expect(tracks[0]).toHaveTextContent(GOODHART_TEXT);
    expect(screen.getByRole("button", { name: "Retest" })).toBeInTheDocument();
  });

  it("R4.12 the newest closed round wins per track; an open round's tracks and null figures are handled", () => {
    const [september, august] = fixtureHoldout.items;
    if (september === undefined || august === undefined) throw new Error("fixture rounds");
    const unscored = { ...august, tracks: [{ ...august.tracks[0], track_key: "blind-defense" as const, answered: 0, total: 0, mean_score: null, mu: null, goodhart_flag: false }] };
    const rounds = [{ ...september, closed_at: null }, august, unscored];
    expect(latestClosedByTrack(rounds).map((result) => [result.track.track_key, result.round.round_month])).toEqual([
      ["opens", "2026-08-01"],
      ["facing-open-ip", "2026-08-01"],
      ["blind-defense", "2026-08-01"],
    ]);
    render(<HoldoutCard holdout={{ open: { round_month: "2026-10-01", answered: 0, total: 0 }, next_cursor: null, items: [unscored] }} />);
    expect(screen.getByTestId("holdout-open")).toHaveTextContent("0 of 0 answered (0%)");
    expect(screen.getByTestId("holdout-track")).toHaveTextContent("mean score none, rating at close none");
  });

  it("R4.12 no round yet shows the empty state", () => {
    render(<HoldoutCard holdout={fixtureFreshHoldout} />);
    expect(screen.getByText(NO_HOLDOUT_TEXT)).toBeInTheDocument();
    expect(screen.queryByTestId("holdout-open")).toBeNull();
  });
});
