/**
 * The compare legend's caption per theme (S48 round 5 verifier on the compare lens, R3.12): the
 * loss ramp is the EV palette's negative steps, whose lightness runs away from the neutral middle
 * (matrix-theme.ts), so the ramp reads deeper in light and lighter in dark; the caption says which,
 * as the weight caption already does, instead of "deeper" in both.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MatrixLegend } from "../../src/components/range-matrix/MatrixLegend.js";
import { fixtureStudyNode } from "../../src/fixtures/index.js";

const LENS = { position: 2, scalePctPot: 2 };

describe("R3.12 the compare legend caption", () => {
  it("R3.12 says deeper brick red in light and lighter brick red in dark, the way the ramp runs", () => {
    const { unmount } = render(<MatrixLegend mode="compare" actions={fixtureStudyNode.actions} theme="light" evScaleBb={1} lens={LENS} />);
    expect(screen.getByText(/deeper brick red the more of the pot it gives up/)).toBeInTheDocument();
    unmount();
    render(<MatrixLegend mode="compare" actions={fixtureStudyNode.actions} theme="dark" evScaleBb={1} lens={LENS} />);
    expect(screen.getByText(/lighter brick red the more of the pot it gives up/)).toBeInTheDocument();
    expect(screen.queryByText(/deeper brick red/)).not.toBeInTheDocument();
  });
});
