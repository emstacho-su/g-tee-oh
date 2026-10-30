/**
 * Tests for the S45 insight cards (R3.12, O-461, ADR 0004): RangeAdvantageCard names both seats,
 * prints both mean equities and both nut shares at the served threshold as two-sided bars with
 * their numbers, and one sentence for the seat to act; a null advantage prints the postflop
 * sentence in words. BlockersCard prints the role, the combos removed with the share of the
 * opponent's range, and the top blocked hands as chips. HandRoleChip names the role in words.
 * Every number is the api's, only formatted with one decimal.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BlockersCard, HandRoleChip, RangeAdvantageCard, ADVANTAGE_TEXT } from "../../src/components/panels/index.js";
import { fixtureInsights } from "../../src/fixtures/index.js";

const SEATS = { oop: "BB", ip: "BTN" } as const;

describe("R3.12 RangeAdvantageCard", () => {
  it("R3.12 names both seats with their mean equity and nut share, and says who is ahead for the seat to act", () => {
    render(
      <RangeAdvantageCard
        rangeAdvantage={fixtureInsights.range_advantage}
        nutAdvantage={fixtureInsights.nut_advantage}
        seats={SEATS}
        toAct="BTN"
      />,
    );
    const card = screen.getByRole("region", { name: "Range and nut advantage" });
    const equity = within(card).getByRole("group", { name: "Mean equity" });
    expect(equity).toHaveTextContent("BB 48.0%");
    expect(equity).toHaveTextContent("BTN 52.0%");
    const nuts = within(card).getByRole("group", { name: /Nut hands/ });
    expect(nuts).toHaveTextContent("80.0% equity or more");
    expect(nuts).toHaveTextContent("BB 8.0%");
    expect(nuts).toHaveTextContent("BTN 12.0%");
    // to_act_advantage_pct_points is the acting seat's mean equity minus an even split (solver-query ranges.rs), never a gap.
    expect(card).toHaveTextContent("BTN, to act, holds 52.0% range equity, 2.0 points above an even split.");
    expect(card).toHaveTextContent("BTN holds 4.0 points more of its range in nut hands than BB.");
  });

  it("R3.12 a seat to act that is behind reads as behind", () => {
    render(
      <RangeAdvantageCard
        rangeAdvantage={{ oop_mean_equity: 0.55, ip_mean_equity: 0.45, to_act_advantage_pct_points: -5 }}
        nutAdvantage={{ threshold_equity: 0.8, oop_share: 0.1, ip_share: 0.05, to_act_advantage: -0.05 }}
        seats={SEATS}
        toAct="BTN"
      />,
    );
    const card = screen.getByRole("region", { name: "Range and nut advantage" });
    expect(card).toHaveTextContent("BTN, to act, holds 45.0% range equity, 5.0 points below an even split.");
    expect(card).toHaveTextContent("BTN holds 5.0 points less of its range in nut hands than BB.");
  });

  it("R3.12 an even split and equal nut shares say neither range is ahead (code review)", () => {
    render(
      <RangeAdvantageCard
        rangeAdvantage={{ oop_mean_equity: 0.5, ip_mean_equity: 0.5, to_act_advantage_pct_points: 0 }}
        nutAdvantage={{ threshold_equity: 0.8, oop_share: 0.1, ip_share: 0.1, to_act_advantage: 0 }}
        seats={SEATS}
        toAct="BB"
      />,
    );
    const card = screen.getByRole("region", { name: "Range and nut advantage" });
    expect(card).toHaveTextContent("Neither range is ahead.");
    expect(card).toHaveTextContent("Both ranges hold the same share of nut hands.");
    expect(card).not.toHaveTextContent("points");
  });

  it("R3.12 null advantages print the postflop sentence in words", () => {
    render(<RangeAdvantageCard rangeAdvantage={null} nutAdvantage={null} seats={SEATS} toAct="BB" />);
    const card = screen.getByRole("region", { name: "Range and nut advantage" });
    expect(card).toHaveTextContent(ADVANTAGE_TEXT.notComputed);
    expect(within(card).queryByRole("group")).not.toBeInTheDocument();
  });

  it("R3.12 each bar's width is the seat's served share, so colour is never the only signal", () => {
    render(
      <RangeAdvantageCard rangeAdvantage={fixtureInsights.range_advantage} nutAdvantage={fixtureInsights.nut_advantage} seats={SEATS} toAct="BTN" />,
    );
    const bars = screen.getAllByTestId("advantage-bar");
    expect(bars.map((bar) => bar.style.width)).toEqual(["48%", "52%", "8%", "12%"]);
  });
});

describe("R3.12 BlockersCard and HandRoleChip", () => {
  it("R3.12 prints the role, the combos removed with the opponent's share, and the top blocked hands as chips", () => {
    render(<BlockersCard blockers={fixtureInsights.blockers} role="bluff" />);
    const card = screen.getByRole("region", { name: "Blockers" });
    expect(card).toHaveTextContent("Role: bluff");
    expect(card).toHaveTextContent("Removes 6 combos, 3.0% of the opponent's range");
    const chips = within(card).getByRole("list", { name: "Most blocked hands" });
    expect(within(chips).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["AA 50.0%"]);
  });

  it("R3.12 a hand that blocks nothing says so, and an unknown role is left out", () => {
    render(<BlockersCard blockers={{ hand: "72o", villain_combos_removed: 0, villain_reach_removed_share: 0, top_blocked: [] }} role={null} />);
    const card = screen.getByRole("region", { name: "Blockers" });
    expect(card).toHaveTextContent("Removes no combos of the opponent's range");
    expect(card).not.toHaveTextContent("Role:");
    expect(within(card).queryByRole("list")).not.toBeInTheDocument();
  });

  it("R3.12 the role chip names the role in words and renders nothing for a null role", () => {
    const { rerender, container } = render(<HandRoleChip role="trap" />);
    expect(screen.getByTestId("hand-role")).toHaveTextContent("Trap");
    rerender(<HandRoleChip role={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
