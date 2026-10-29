/**
 * The in-session tally row (S46, R3.32, design rule 10, O-477): decisions, the five label counts
 * with the grade definitions tip, the rated count, the total and mean EV loss, and the run of
 * Best or Correct only when the session's prompt names the panel key, called a run and never a
 * streak (O-278 is the daily streak).
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionTally } from "../../src/routes/drill-run/SessionTally.js";
import type { SessionTally as Tally } from "../../src/trainer/session-log.js";

const TALLY: Tally = {
  decisions: 5,
  counts: { best: 2, correct: 1, inaccuracy: 1, mistake: 1, blunder: 0 },
  rated: 4,
  evLossTotalBb: 0.431,
  evLossMeanBb: 0.0862,
  run: 2,
};

const EMPTY: Tally = { decisions: 0, counts: { best: 0, correct: 0, inaccuracy: 0, mistake: 0, blunder: 0 }, rated: 0, evLossTotalBb: 0, evLossMeanBb: null, run: 0 };

function tiles(): string[][] {
  return within(screen.getByTestId("session-tally"))
    .getAllByTestId("stat-tile")
    .map((tile) => [within(tile).getByRole("term").textContent ?? "", within(tile).getByRole("definition").textContent ?? ""]);
}

describe("R3.32 session tally", () => {
  it("R3.32 shows decisions, the five label counts, rated, and the total and mean EV loss as tiles", () => {
    render(<SessionTally tally={TALLY} showRun={false} />);
    expect(tiles()).toEqual([
      ["Decisions", "5"],
      ["Best", "2"],
      ["Correct", "1"],
      ["Inaccuracy", "1"],
      ["Mistake", "1"],
      ["Blunder", "0"],
      ["Rated", "4"],
      ["EV loss", "0.43bb"],
      ["Mean loss", "0.09bb"],
    ]);
    expect(screen.queryByText(/streak/i)).not.toBeInTheDocument();
  });

  it("R3.32 the run tile appears only when asked, named a run", () => {
    render(<SessionTally tally={TALLY} showRun />);
    expect(tiles().at(-1)).toEqual(["Run", "2"]);
    expect(screen.getByTestId("session-tally")).not.toHaveTextContent(/streak/i);
  });

  it("R3.8 every label count carries the grade definitions tip (design rule 11)", () => {
    render(<SessionTally tally={TALLY} showRun={false} />);
    expect(within(screen.getByTestId("session-tally")).getAllByRole("button", { name: "About grade labels" })).toHaveLength(5);
  });

  it("R3.32 an empty session shows zeros and no mean", () => {
    render(<SessionTally tally={EMPTY} showRun={false} />);
    expect(tiles()[0]).toEqual(["Decisions", "0"]);
    expect(tiles().at(-1)).toEqual(["Mean loss", "None yet"]);
  });
});
