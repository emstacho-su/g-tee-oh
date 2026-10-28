/**
 * Tests for the painter's smaller parts (S27 lane B, R3.17, ADR 0020): brushes past the ninth have
 * no number key and the failure texts never echo a problem (S41: the drill picker went with drills
 * on /paint; the spot picker is tested through the page, test/paint/paint-page.test.tsx).
 */
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiProblem } from "../../src/api/index.js";
import { BrushPicker } from "../../src/components/painter/BrushPicker.js";
import type { NodeAction } from "../../src/contracts.js";
import { HotkeyRoot, createHotkeyStore } from "../../src/hotkeys/index.js";
import { PAINT_FAILURES, isStalePaint, paintFailureText } from "../../src/routes/paint/paint-api.js";
import { PAINTER_SUITE } from "./painter-timeout.js";

const TEN_RAISES: NodeAction[] = Array.from({ length: 10 }, (_, index) => ({
  index,
  token: `r${(index + 3) * 100}`,
  kind: "raise",
  size_cbb: (index + 3) * 100,
  bucket: null,
  label: `Raise to ${index + 3}bb`,
  next_node_key: null,
}));

function problem(status: number, slug: string): ApiProblem {
  return new ApiProblem({ status, slug, title: "t", detail: "server detail text" });
}

describe("R3.17 BrushPicker", PAINTER_SUITE, () => {
  it("R3.17 gives number keys to the first nine brushes only and reports a picked brush", async () => {
    const onBrushChange = vi.fn();
    const user = userEvent.setup();
    render(
      <HotkeyRoot store={createHotkeyStore()}>
        <BrushPicker actions={TEN_RAISES} brush={0} enabled onBrushChange={onBrushChange} />
      </HotkeyRoot>,
    );
    const brushes = within(screen.getByRole("radiogroup", { name: "Brush" })).getAllByRole("radio");
    expect(brushes[8]).toHaveAttribute("aria-keyshortcuts", "9");
    expect(brushes[9]).not.toHaveAttribute("aria-keyshortcuts");
    await user.click(brushes[9] as HTMLElement);
    expect(onBrushChange).toHaveBeenLastCalledWith(9);
    await user.click(brushes[0] as HTMLElement);
    expect(onBrushChange).toHaveBeenCalledTimes(1);
  });
});


describe("R3.17 paintFailureText", () => {
  it.each([
    [problem(409, "stale-state"), PAINT_FAILURES.stale],
    [problem(422, "no-coverage"), PAINT_FAILURES.noCoverage],
    [problem(404, "not-found"), PAINT_FAILURES.notFound],
    [problem(502, "upstream"), PAINT_FAILURES.upstream],
    [problem(503, "unavailable"), PAINT_FAILURES.upstream],
    [problem(400, "validation"), PAINT_FAILURES.generic],
    [new TypeError("Failed to fetch"), PAINT_FAILURES.generic],
  ])("R3.17 names %s with a fixed sentence", (error, text) => {
    expect(paintFailureText(error)).toBe(text);
  });

  it("R3.17 only a 409 stale-state is stale", () => {
    expect(isStalePaint(problem(409, "stale-state"))).toBe(true);
    expect(isStalePaint(problem(409, "session-ended"))).toBe(false);
    expect(isStalePaint(new Error("x"))).toBe(false);
  });
});
