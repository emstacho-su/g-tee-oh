/**
 * The Compare tab (S45 follow-up, R3.12, O-462; PR 52 review round 2 leftover for S48): each
 * action's served loss against the best, "the best action" by the scale's own neutral rule, and
 * "unavailable" when the row carries no loss for an action (a short list, or a NaN), never a
 * made-up zero that would read as the best action.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { fixtureStudyNode } from "../../src/fixtures/index.js";
import { COMPARE_TEXT, CompareTab } from "../../src/routes/study/CompareTab.js";

const [first, second, third] = fixtureStudyNode.actions;
if (first === undefined || second === undefined || third === undefined) throw new Error("the fixture node has fewer than three actions");

describe("R3.12 CompareTab", () => {
  it("R3.12 a missing or NaN loss reads unavailable, not the best action", () => {
    const row = { ...(fixtureStudyNode.hands[0] as (typeof fixtureStudyNode.hands)[number]), hand: "AA", loss_pct_pot: [0, Number.NaN] };
    render(<CompareTab node={{ actions: fixtureStudyNode.actions, hands: [row] }} hand="AA" onCompare={vi.fn()} />);
    const items = within(screen.getByRole("list", { name: COMPARE_TEXT.list("AA") })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(COMPARE_TEXT.best);
    expect(items[1]).toHaveTextContent(COMPARE_TEXT.unavailable);
    expect(items[1]).not.toHaveTextContent(COMPARE_TEXT.best);
    expect(items[2]).toHaveTextContent(COMPARE_TEXT.unavailable);
  });

  it("R3.12 a loss within the neutral band is the best action; beyond it the loss in percent of the pot", () => {
    const row = { ...(fixtureStudyNode.hands[0] as (typeof fixtureStudyNode.hands)[number]), hand: "AA", loss_pct_pot: [0.05, 1.2, 0, 0] };
    render(<CompareTab node={{ actions: fixtureStudyNode.actions, hands: [row] }} hand="AA" onCompare={vi.fn()} />);
    const items = within(screen.getByRole("list", { name: COMPARE_TEXT.list("AA") })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(COMPARE_TEXT.best);
    expect(items[1]).toHaveTextContent("1.20% of the pot behind the best");
  });
});
