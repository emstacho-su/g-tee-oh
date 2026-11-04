// The S32 progress gallery sections (R4.12, O-267): every chart renders from the fixtures with no
// api, and a drill click only names the class it would open.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProgressSections } from "../../src/gallery/progress-sections.js";

describe("R4.12 progress gallery sections", () => {
  it("R4.12 renders each chart section and notes a drill click", () => {
    render(<ProgressSections />);
    for (const name of ["track-breakdown", "leak-trend", "mastery-heatmap", "holdout-card", "progress-empty"]) {
      expect(screen.getByTestId(`gallery-${name}`)).toBeInTheDocument();
    }
    const heat = screen.getByTestId("gallery-mastery-heatmap");
    fireEvent.click(within(heat).getByRole("button", { name: /^Open or fold, big blind versus under the gun, live 100bb:/ }));
    expect(heat).toHaveTextContent("Would open the drill for rfi BB-UTG live 100.");
    const leaks = screen.getByTestId("gallery-leak-trend");
    fireEvent.click(within(leaks).getByRole("radio", { name: "4 weeks" }));
    expect(within(leaks).getByRole("radio", { name: "4 weeks" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(leaks).getByRole("button", { name: "Drill this spot: Open or fold, big blind versus cutoff, live 100bb" }));
    expect(leaks).toHaveTextContent("Would open the drill for rfi BB-CO live 100.");
  });
});
