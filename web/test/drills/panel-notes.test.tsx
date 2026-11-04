/**
 * The builder says which stored panels and settings v1 does not serve yet (S46, R3.33, item 14,
 * O-317): the panels with no component in the trainer (the breakdowns, equity, range advantage,
 * hand class, the opponent's range) and the timebank, which is kept with the drill but not enforced.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { newDrillDraft } from "../../src/drills/draft.js";
import { panelV1Note, PANELS_WITHOUT_COMPONENT, V1_NOTES } from "../../src/drills/labels.js";
import type { DrillDraft } from "../../src/drills/draft.js";
import { PanelsSection, TrainerSection } from "../../src/routes/drills/TrainerSection.js";

function withTrainer(patch: Partial<DrillDraft["trainer"]>): DrillDraft {
  const draft = newDrillDraft();
  return { ...draft, trainer: { ...draft.trainer, ...patch } };
}

describe("R3.33 builder notes for panels and settings v1 does not serve", () => {
  it("R3.33 the panels without a component are exactly the breakdowns, equity, range advantage, hand class and the opponent's range", () => {
    expect([...PANELS_WITHOUT_COMPONENT].sort()).toEqual(
      ["draw_breakdown", "equity_distribution_chart", "hand_class", "made_hand_breakdown", "range_advantage", "villain_range_matrix"].sort(),
    );
  });

  it("R3.33 choosing such a panel shows the note naming it; a served panel alone shows none", () => {
    const { rerender } = render(<PanelsSection draft={withTrainer({ panels: { hero_range_matrix: true } })} onChange={vi.fn()} errors={{}} />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    rerender(<PanelsSection draft={withTrainer({ panels: { draw_breakdown: true, hand_class: true } })} onChange={vi.fn()} errors={{}} />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(panelV1Note(["Hand class", "Draws"]));
  });

  it("R3.33 a timebank shows the note that v1 keeps it with the drill but does not run it", () => {
    const { rerender } = render(<TrainerSection draft={withTrainer({ timebank_s: null })} onChange={vi.fn()} errors={{}} />);
    expect(screen.queryByText(`Note: ${V1_NOTES.timebank}`)).not.toBeInTheDocument();
    rerender(<TrainerSection draft={withTrainer({ timebank_s: 15 })} onChange={vi.fn()} errors={{}} />);
    expect(screen.getByText(`Note: ${V1_NOTES.timebank}`)).toBeInTheDocument();
  });
});
