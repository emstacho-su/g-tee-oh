/**
 * Render cost test for the RangeMatrix component (S24, R3.12, O-260): a focus move or a
 * selection change must not re-render the 169-cell table fallback or the action legend.
 *
 * Mechanism: cell-text.ts is wrapped with spies (the real functions still run). The table calls
 * cellText once per cell on every render and the legend calls actionShortLabel once per action,
 * so after the first render a focus move may call cellText exactly once (the live region
 * announcement) and actionShortLabel never. Any more calls mean the table or the legend
 * re-rendered.
 */
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as cellTextModule from "../../src/components/range-matrix/cell-text.js";
import { RangeMatrix } from "../../src/components/range-matrix/RangeMatrix.js";
import { fixtureStudyNode } from "../../src/fixtures/index.js";

vi.mock("../../src/components/range-matrix/cell-text.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/components/range-matrix/cell-text.js")>();
  return { ...original, cellText: vi.fn(original.cellText), actionShortLabel: vi.fn(original.actionShortLabel) };
});

const cellText = vi.mocked(cellTextModule.cellText);
const actionShortLabel = vi.mocked(cellTextModule.actionShortLabel);

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("R3.12 RangeMatrix render cost", () => {
  it("R3.12 a focus move and a selection change do not re-render the table or the legend", async () => {
    const onSelectHand = vi.fn();
    const { rerender } = render(
      <RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={onSelectHand} />,
    );
    expect(cellText).toHaveBeenCalledTimes(169);
    cellText.mockClear();
    actionShortLabel.mockClear();

    screen.getByRole("group", { name: /range matrix cells/i }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("status")).toHaveTextContent(/^AKs: /);
    expect(cellText).toHaveBeenCalledTimes(1);

    rerender(
      <RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" selectedHand="AKs" onSelectHand={onSelectHand} />,
    );
    expect(cellText).toHaveBeenCalledTimes(1);
    expect(actionShortLabel).not.toHaveBeenCalled();
  });

  it("R3.12 a mode change does re-render the table", () => {
    const { rerender } = render(<RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={vi.fn()} />);
    cellText.mockClear();
    rerender(<RangeMatrix node={fixtureStudyNode} mode="ev" theme="light" onSelectHand={vi.fn()} />);
    expect(cellText).toHaveBeenCalledTimes(169);
  });
});
