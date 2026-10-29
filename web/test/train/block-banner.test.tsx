/**
 * The /train block banner on its own (S32, R4.10, O-272, O-325, O-328): the holdout banner wins
 * over a block, no banner without a block, the class line with and without a family or a track,
 * and the three rating lines (worked example, rated block, not rated).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BlockBanner } from "../../src/routes/train/BlockBanner.js";
import type { BlockView } from "../../src/routes/train/block-progress.js";
import { TRAIN_TEXT } from "../../src/routes/train/train-text.js";

const BLOCK: BlockView = { classKey: "class-a", trackKey: "opens", family: "rfi", hand: 2, size: 3, workedExample: false };

describe("R4.10 BlockBanner (O-325)", () => {
  it("R4.10 shows the holdout retest banner with answered of total, even beside a block (O-328)", () => {
    render(<BlockBanner block={BLOCK} holdout={{ answered: 4, total: 12 }} ratedEligible />);
    expect(screen.getByText(TRAIN_TEXT.holdoutBanner)).toBeInTheDocument();
    expect(screen.getByTestId("holdout-answered")).toHaveTextContent("4 of 12 answered");
    expect(screen.queryByTestId("block-class")).toBeNull();
  });

  it("R4.10 renders nothing without a block or a holdout", () => {
    const { container } = render(<BlockBanner block={null} holdout={null} ratedEligible />);
    expect(container).toBeEmptyDOMElement();
  });

  it("R4.10 names the family and the track by its loaded name in a rated block", () => {
    render(<BlockBanner block={BLOCK} holdout={null} ratedEligible trackNames={{ opens: "Opens" }} />);
    expect(screen.getByTestId("block-class")).toHaveTextContent("Open or fold, Opens");
    expect(screen.getByTestId("block-hand")).toHaveTextContent("Hand 2 of 3 in this block");
    expect(screen.getByTestId("block-rating")).toHaveTextContent(TRAIN_TEXT.ratedBlock);
  });

  it("R4.10 falls back to the track key, and to the track alone without a family", () => {
    render(<BlockBanner block={{ ...BLOCK, family: null }} holdout={null} ratedEligible />);
    expect(screen.getByTestId("block-class")).toHaveTextContent(/^opens$/);
  });

  it("R4.10 says no rating track when the class has none", () => {
    render(<BlockBanner block={{ ...BLOCK, trackKey: null }} holdout={null} ratedEligible={false} />);
    expect(screen.getByTestId("block-class")).toHaveTextContent(`Open or fold, ${TRAIN_TEXT.noTrack}`);
    expect(screen.getByTestId("block-rating")).toHaveTextContent(TRAIN_TEXT.unratedSession);
  });

  it("R4.10 marks a worked example as not rated with the accent border (O-272)", () => {
    render(<BlockBanner block={{ ...BLOCK, workedExample: true }} holdout={null} ratedEligible />);
    expect(screen.getByTestId("block-rating")).toHaveTextContent(TRAIN_TEXT.workedExample);
    expect(screen.getByTestId("block-banner").className).toContain("border-accent");
  });
});
