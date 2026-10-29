/**
 * The decision history under the decision area (S46, R3.32, screen review row 50): a collapsible
 * "This session" list with one row per decision (hand, grade mark, loss) whose rows expand in
 * place to that decision's feedback panel, read-only, one at a time, never a dialog.
 */
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DecisionFeedback, FeedbackLabel } from "../../src/contracts.js";
import { fixtureFeedback, fixturePrompt } from "../../src/fixtures/index.js";
import { fixturePracticeSession } from "../../src/fixtures/trainer.js";
import { SessionHistory } from "../../src/routes/drill-run/SessionHistory.js";
import { EMPTY_LOG, logAfter, type DecisionEntry, type SessionLog } from "../../src/trainer/session-log.js";
import type { SessionContext, SpotState } from "../../src/trainer/spot-machine.js";

function reveal(key: string, label: FeedbackLabel, evLoss: number, ordinal: number, chosen: number): SpotState {
  const feedback: DecisionFeedback = { ...fixtureFeedback, label, ev_loss_bb: evLoss, rated: false, rng_roll: null };
  const context: SessionContext = { session: fixturePracticeSession, rng: false, hand: { handNo: ordinal - 1, ordinal, decision: 1, stateVersion: 3, heroPosition: "BB" } };
  return { kind: "feedback", context, prompt: fixturePrompt, decision: { actionIndex: chosen, responseMs: 50, idempotencyKey: key, stateVersion: 3 }, feedback };
}

const LOG: SessionLog = [reveal("d1", "best", 0, 1, 2), reveal("d2", "blunder", 1.2, 2, 0)].reduce((log, state) => logAfter(log, state), EMPTY_LOG);
const ENTRIES: readonly DecisionEntry[] = LOG.entries;

function renderHistory(entries: readonly DecisionEntry[], decisions = false) {
  return render(<SessionHistory entries={entries} decisions={decisions} slotsFor={() => ({})} />);
}

async function openList(): Promise<HTMLElement> {
  const history = screen.getByTestId("session-history");
  await userEvent.click(within(history).getByRole("button", { name: /This session/ }));
  return history;
}

describe("R3.32 session history", () => {
  it("R3.32 is collapsed by default, counts its decisions, and lists one row per decision with the hand, mark and loss", async () => {
    renderHistory(ENTRIES);
    const history = screen.getByTestId("session-history");
    const toggle = within(history).getByRole("button", { name: /This session/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("2 decisions");
    await openList();
    const rows = within(history).getAllByTestId("history-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Hand 1");
    expect(rows[0]).toHaveTextContent("★ Best");
    expect(rows[0]).toHaveTextContent("No EV lost");
    expect(rows[1]).toHaveTextContent("Hand 2");
    expect(rows[1]).toHaveTextContent("?? Blunder");
    expect(rows[1]).toHaveTextContent("Lost 1.20bb");
    expect(rows[1]).toHaveTextContent("Unrated");
  });

  it("R3.32 a row expands in place to that decision's feedback panel, read-only, one row at a time, never a dialog", async () => {
    renderHistory(ENTRIES);
    const history = await openList();
    const [first, second] = within(history).getAllByTestId("history-row") as [HTMLElement, HTMLElement];
    expect(screen.queryByTestId("feedback-panel")).not.toBeInTheDocument();
    await userEvent.click(within(second).getByRole("button", { name: /Hand 2/ }));
    const panel = within(second).getByTestId("feedback-panel");
    expect(panel).toHaveTextContent("Blunder");
    expect(panel).toHaveTextContent("Your action: Fold");
    expect(within(panel).queryByRole("button", { name: "Ask" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(within(first).getByRole("button", { name: /Hand 1/ }));
    expect(within(first).getByTestId("feedback-panel")).toHaveTextContent("Your action: Raise 2.5bb");
    expect(within(second).getByRole("button", { name: /Hand 2/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByTestId("feedback-panel")).toHaveLength(1);
  });

  it("R3.32 the slots the page gives (range, threshold, roller, insights, explanation) reach the row's panel", async () => {
    render(<SessionHistory entries={ENTRIES} decisions={false} slotsFor={(entry) => ({ rangeView: <p>{`range of ${entry.key}`}</p> })} />);
    const history = await openList();
    const [first] = within(history).getAllByTestId("history-row") as [HTMLElement];
    await userEvent.click(within(first).getByRole("button", { name: /Hand 1/ }));
    await userEvent.click(within(first).getByRole("button", { name: /^Range/ }));
    expect(within(first).getByText("range of d1")).toBeInTheDocument();
  });

  it("R3.32 street and full-hand rows name the decision within the hand", async () => {
    renderHistory(ENTRIES, true);
    const history = await openList();
    expect(within(history).getAllByTestId("history-row")[0]).toHaveTextContent("Hand 1, decision 1");
  });

  it("R3.32 with no decisions the list says so", async () => {
    renderHistory([]);
    const history = await openList();
    expect(history).toHaveTextContent("No decisions yet");
    expect(within(history).queryAllByTestId("history-row")).toHaveLength(0);
    expect(vi.fn()).not.toHaveBeenCalled();
  });
});
