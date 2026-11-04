/**
 * The pre-decision reveal notice (S46, R3.33, item 14, O-471). When the prompt names a panel that
 * shows the answer, or is a worked example, the decision is unrated, and the screen says so above
 * the action bar before the decision. The panels themselves wait on O-471 (the prompt carries no
 * node identity), so the eye button, off by default, lists the panels the drill turned on and says
 * they arrive in a later version instead of pretending to show them.
 */
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { TrainerPrompt } from "../../src/contracts.js";
import { fixtureAutomatedSession } from "../../src/fixtures/automated.js";
import { fixturePlainPrompt, fixturePracticeSession } from "../../src/fixtures/trainer.js";
import { UNRATED_REASONS } from "../../src/trainer/unrated-reason.js";
import { HotkeyRoot, createHotkeyStore } from "../../src/hotkeys/index.js";
import { DecisionArea } from "../../src/routes/drill-run/DecisionArea.js";
import { REVEAL_TEXT } from "../../src/routes/drill-run/labels.js";
import type { SessionContext, SpotState } from "../../src/trainer/spot-machine.js";

const CONTEXT: SessionContext = { session: fixturePracticeSession, rng: false };

function awaiting(prompt: TrainerPrompt, context: SessionContext = CONTEXT): SpotState {
  return { kind: "await_action", context, prompt, timer: { shownAt: 0, pausedMs: 0, pausedSince: null }, notice: null };
}

function renderArea(prompt: TrainerPrompt, context: SessionContext = CONTEXT) {
  return render(
    <HotkeyRoot store={createHotkeyStore()}>
      <DecisionArea state={awaiting(prompt, context)} prompt={prompt} grouping="standard" interactive onChoose={vi.fn()} onNext={vi.fn()} onExplain={vi.fn()} />
    </HotkeyRoot>,
  );
}

const PLAIN: TrainerPrompt = { ...fixturePlainPrompt, visible_panels: [], worked_example: false };

describe("R3.33 the reveal notice before the decision", () => {
  it("R3.33 a prompt that names a revealing panel says why the decision is not rated, above the action bar: the session's ranked reason (round 5 verifier)", () => {
    // A drill session: the one reason the feedback chip gives too (unrated-reason.ts ranks the mode first).
    renderArea({ ...PLAIN, visible_panels: ["hero_strategy_matrix", "hero_range_matrix"] });
    const notice = screen.getByTestId("reveal-notice");
    expect(notice).toHaveTextContent(UNRATED_REASONS.drill);
    expect(notice).not.toHaveTextContent("Revealed");
    const bar = screen.getByTestId("action-bar");
    expect(notice.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("R3.33 in an automated session the reason is the revealing panel, or the worked example", () => {
    const automated: SessionContext = { session: fixtureAutomatedSession(), rng: false };
    const { unmount } = renderArea({ ...PLAIN, visible_panels: ["hero_strategy_matrix", "hero_range_matrix"] }, automated);
    expect(screen.getByTestId("reveal-notice")).toHaveTextContent(UNRATED_REASONS.revealed);
    unmount();
    renderArea({ ...PLAIN, worked_example: true }, automated);
    expect(screen.getByTestId("reveal-notice")).toHaveTextContent(UNRATED_REASONS.workedExample);
  });

  it("R3.33 a worked example in a drill still names the drill, the session's one reason", () => {
    renderArea({ ...PLAIN, worked_example: true });
    expect(screen.getByTestId("reveal-notice")).toHaveTextContent(UNRATED_REASONS.drill);
  });

  it("R3.33 the panels sit behind an eye button, off by default; it names them and says they arrive later", async () => {
    renderArea({ ...PLAIN, visible_panels: ["hero_strategy_matrix", "hero_range_matrix"] });
    const eye = screen.getByRole("button", { name: REVEAL_TEXT.show });
    expect(eye).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("reveal-panels")).not.toBeInTheDocument();
    await userEvent.click(eye);
    const panels = screen.getByTestId("reveal-panels");
    expect(within(panels).getByText("Your strategy")).toBeInTheDocument();
    expect(within(panels).getByText("Your range")).toBeInTheDocument();
    expect(panels).toHaveTextContent(REVEAL_TEXT.later);
    const hide = screen.getByRole("button", { name: REVEAL_TEXT.hide });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(hide);
    expect(screen.queryByTestId("reveal-panels")).not.toBeInTheDocument();
  });

  it("R3.33 every panel is off by default: a prompt with no revealing panel and no worked example shows no notice", () => {
    renderArea({ ...PLAIN, visible_panels: ["hero_range_matrix", "streak_counter"] });
    expect(screen.queryByTestId("reveal-notice")).not.toBeInTheDocument();
  });
});
