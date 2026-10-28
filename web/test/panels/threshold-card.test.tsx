/**
 * Tests for ThresholdCard (S24, S38, R3.12, O-198, ADR 0004, screen review row 14): the contract's
 * threshold card in plain words, with the actions named from the node (or from their token when no
 * actions are given), never an internal field name such as index or token, explained by three
 * info tips, and the hero's hand marked wherever it appears.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ThresholdCard } from "../../src/components/panels/index.js";
import type { NodeAction, StudyInsights } from "../../src/contracts.js";
import { fixtureActions, fixtureInsights } from "../../src/fixtures/index.js";

type Card = NonNullable<StudyInsights["threshold_card"]>;

const CARD: Card = fixtureInsights.threshold_card as Card;
/** Numbered 10 to 13, so a NodeAction.index never equals its position (O-198). */
const OFFSET_ACTIONS: readonly NodeAction[] = fixtureActions.map((action) => ({ ...action, index: action.index + 10 }));
const INTERNAL_WORDS = /\b(index|token|share_taking|weakest_hand_taking_half|strongest_folding_hand|rank_in_range|equity_vs_villain|hand_position)\b/i;

describe("R3.12 ThresholdCard", () => {
  it("R3.12 keeps its heading, test id and the hero's hand line", () => {
    render(<ThresholdCard card={CARD} heroHand="AJo" />);
    const card = screen.getByTestId("threshold-card");
    expect(within(card).getByRole("heading", { name: "Threshold card" })).toBeInTheDocument();
    expect(card).toHaveTextContent("Your hand: AJo");
  });

  it("R3.12 says where the hand sits in words that match rank_in_range, which counts the hand and its ties (review round 1, 4)", () => {
    render(<ThresholdCard card={CARD} heroHand="AJo" />);
    const position = screen.getByRole("group", { name: "Hand position" });
    expect(position).toHaveTextContent("At or above 18% of this range by strength");
    expect(position).not.toHaveTextContent("Stronger than");
    expect(position).toHaveTextContent("Equity against the opponent's range: 61%");
  });

  it("R3.12 the strongest hand reads as at or above every hand, not as stronger than all of them (review round 1, 4)", () => {
    const top: Card = { ...CARD, hand_position: { ...CARD.hand_position, rank_in_range: 1 } };
    render(<ThresholdCard card={top} heroHand="AJo" />);
    expect(screen.getByRole("group", { name: "Hand position" })).toHaveTextContent("At or above every hand in this range by strength");
  });

  it.each([
    [0.996, "At or above every hand in this range by strength"],
    [0.994, "At or above 99% of this range by strength"],
    [0.5, "At or above 50% of this range by strength"],
    [0.006, "At or above 1% of this range by strength"],
    [0.004, "At or above less than 1% of this range by strength"],
    [0.001, "At or above less than 1% of this range by strength"],
  ])("R3.12 a rank of %s is rounded to a whole percent before the wording is chosen (S40 item d, O-408)", (rank, text) => {
    const card: Card = { ...CARD, hand_position: { ...CARD.hand_position, rank_in_range: rank } };
    render(<ThresholdCard card={card} heroHand="AJo" />);
    const position = screen.getByRole("group", { name: "Hand position" });
    expect(position).toHaveTextContent(text);
    expect(position).not.toHaveTextContent("At or above 100%");
    expect(position).not.toHaveTextContent("At or above 0%");
  });

  it("R3.12 a hand with no strength rank (outside the range here) gets its own text and no placeholder equity (review round 1, 4)", () => {
    const outside: Card = { ...CARD, hand_position: { ...CARD.hand_position, rank_in_range: 0, equity_vs_villain: 0.5 } };
    render(<ThresholdCard card={outside} heroHand="AJo" />);
    const position = screen.getByRole("group", { name: "Hand position" });
    expect(position).toHaveTextContent("No strength rank here: the hand is outside this range at this node");
    expect(position).not.toHaveTextContent("At or above");
    expect(position).not.toHaveTextContent("Equity against");
  });

  it("R3.12 the hand position tile does not repeat the hand already named in Your hand (review round 1, 4)", () => {
    render(<ThresholdCard card={CARD} heroHand="AJo" />);
    expect(within(screen.getByRole("group", { name: "Hand position" })).queryByText("AJo")).not.toBeInTheDocument();
  });

  it("R3.12 names each action from the node's actions by NodeAction.index, with its share and line (O-198)", () => {
    render(<ThresholdCard card={CARD} heroHand="AJo" actions={fixtureActions} />);
    const list = screen.getByRole("list", { name: "Actions" });
    const raise = within(list).getByRole("listitem", { name: "Raise 2.5bb" });
    expect(raise).toHaveTextContent("Played by 52% of the range");
    expect(raise).toHaveTextContent("Weakest hand that plays it at least half the time: K9o");
    expect(raise).toHaveTextContent("Your hand is above this line");
    expect(within(list).getByRole("listitem", { name: "Fold" })).toHaveTextContent("No hand plays it at least half the time");
  });

  it("R3.12 names actions from their token when no actions are given, or when the index names none", () => {
    const { rerender } = render(<ThresholdCard card={CARD} />);
    expect(screen.getByRole("listitem", { name: "Raise 2.5bb" })).toBeInTheDocument();
    rerender(<ThresholdCard card={CARD} actions={OFFSET_ACTIONS} />);
    expect(screen.getByRole("listitem", { name: "Raise 2.5bb" })).toBeInTheDocument();
    const odd: Card = { ...CARD, actions: [{ index: 7, token: "zz", share_taking: 0.1, weakest_hand_taking_half: null }] };
    rerender(<ThresholdCard card={odd} />);
    expect(screen.getByRole("listitem", { name: "Unnamed action" })).toBeInTheDocument();
  });

  it("R3.12 names the strongest folding hand, or says none folds", () => {
    const { rerender } = render(<ThresholdCard card={CARD} />);
    expect(screen.getByRole("group", { name: "Strongest folding hand" })).toHaveTextContent("Q8o");
    rerender(<ThresholdCard card={{ ...CARD, strongest_folding_hand: null }} />);
    expect(screen.getByRole("group", { name: "Strongest folding hand" })).toHaveTextContent("No hand folds at least half the time");
  });

  it("R3.12 never shows an internal field name, index or token", () => {
    render(<ThresholdCard card={CARD} heroHand="AJo" actions={fixtureActions} />);
    const card = screen.getByTestId("threshold-card");
    const visible = card.cloneNode(true) as HTMLElement;
    for (const hidden of visible.querySelectorAll("[data-info-tip-text]")) hidden.remove();
    expect(visible.textContent ?? "").not.toMatch(INTERNAL_WORDS);
    expect(visible.textContent ?? "").not.toContain("r250");
  });

  it("R3.12 explains actions, hand position and the strongest folding hand through info tips", () => {
    render(<ThresholdCard card={CARD} />);
    for (const subject of ["actions", "hand position", "the strongest folding hand"]) {
      const tip = screen.getByRole("button", { name: `About ${subject}` });
      expect(tip.getAttribute("aria-describedby")).not.toBeNull();
    }
  });

  it("R3.12 marks the hero's hand wherever it appears", () => {
    render(<ThresholdCard card={{ ...CARD, strongest_folding_hand: "AJo" }} heroHand="AJo" />);
    // Once in Your hand and once as the strongest folding hand; the hand position tile no longer repeats it.
    const card = screen.getByTestId("threshold-card");
    const yourHand = within(card).getByText("Your hand:", { exact: false });
    const folding = screen.getByRole("group", { name: "Strongest folding hand" });
    for (const place of [yourHand, folding]) {
      const mark = within(place).getByText("AJo", { selector: "mark" });
      expect(mark).toHaveAttribute("data-hero", "true");
    }
    expect(within(card).getAllByText("AJo", { selector: "mark" })).toHaveLength(2);
  });

  it("R3.12 a node without a threshold card says so, under a custom title", () => {
    render(<ThresholdCard card={null} title="Raise threshold" />);
    const card = screen.getByTestId("threshold-card");
    expect(within(card).getByRole("heading", { name: "Raise threshold" })).toBeInTheDocument();
    expect(card).toHaveTextContent("No threshold data for this node");
  });

  it("R3.12 renders api strings as text, never HTML", () => {
    render(<ThresholdCard card={{ ...CARD, strongest_folding_hand: "<img src=x onerror=alert(1)>" }} />);
    const card = screen.getByTestId("threshold-card");
    expect(card.querySelector("img")).toBeNull();
    expect(card).toHaveTextContent("<img src=x onerror=alert(1)>");
  });
});
