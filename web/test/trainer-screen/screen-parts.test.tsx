/**
 * The drill run screen's smaller parts in their less common cases (S25, R3.13, O-57): a prompt from
 * a real (not synthetic) solution with no action yet, and a recap with no rated decision.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { fixturePlainPrompt, fixtureRecap } from "../../src/fixtures/trainer.js";
import { SessionRecapView } from "../../src/routes/drill-run/SessionParts.js";
import { SpotTable } from "../../src/routes/drill-run/SpotTable.js";

describe("R3.13 drill run screen parts", () => {
  it("R3.13 a non-synthetic prompt has no banner, and an empty history says so in the hidden action log (O-383)", () => {
    render(<SpotTable prompt={{ ...fixturePlainPrompt, synthetic: false, history: [] }} />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByRole("log", { name: "Action this hand" })).toHaveTextContent("No action before you");
    expect(screen.queryByRole("list", { name: "Action so far" })).not.toBeInTheDocument();
  });

  it("R3.13 a recap with no rated decision says None rated instead of a score", () => {
    render(<SessionRecapView recap={{ ...fixtureRecap, rated_decisions: 0, mean_score: null }} onStartAnother={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Session recap" })).toHaveTextContent("Mean scoreNone rated");
  });
});
