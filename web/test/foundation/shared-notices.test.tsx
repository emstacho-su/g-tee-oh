// The shared notices (S25, R3.12, R3.13, O-57): one synthetic banner wording and one loading note
// for the study screen and the trainer.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LoadingNote, SYNTHETIC_TEXT, SyntheticBanner } from "../../src/components/ui/index.js";

describe("R3.12 R3.13 shared notices", () => {
  it("R3.12 the synthetic banner is a note with the one wording", () => {
    render(<SyntheticBanner />);
    const banner = screen.getByRole("note");
    expect(banner).toHaveAttribute("data-testid", "synthetic-banner");
    expect(banner).toHaveTextContent(SYNTHETIC_TEXT);
  });

  it("R3.13 the loading note is a status line with its text", () => {
    render(<LoadingNote text="Loading the node." />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the node.");
  });
});
