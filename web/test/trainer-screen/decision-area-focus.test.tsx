/**
 * The decision area moves the focus off the action bar (S46, R3.30, PR #45 review round 3,
 * finding 1). A clicked action button kept the focus; when the next prompt rendered into the same
 * DecisionArea (a prefetched prompt in the same batch, or a street-mode prompt in the same hand),
 * React kept the same DOM button for the same NodeAction.index, enabled again and still focused,
 * so the next Enter or Space submitted an action the user never chose. Rendering two prompts into
 * one DecisionArea reproduces that exactly.
 */
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { TrainerPrompt } from "../../src/contracts.js";
import { fixturePlainPrompt, fixturePracticeSession } from "../../src/fixtures/trainer.js";
import { HotkeyRoot, createHotkeyStore } from "../../src/hotkeys/index.js";
import { DecisionArea } from "../../src/routes/drill-run/DecisionArea.js";
import type { SessionContext, SpotState } from "../../src/trainer/spot-machine.js";

const CONTEXT: SessionContext = { session: fixturePracticeSession, rng: false };
const NEXT: TrainerPrompt = { ...fixturePlainPrompt, hand_no: 1, state_version: fixturePlainPrompt.state_version + 2 };

function awaiting(prompt: TrainerPrompt): SpotState {
  return { kind: "await_action", context: CONTEXT, prompt, timer: { shownAt: 0, pausedMs: 0, pausedSince: null }, notice: null };
}

function area(state: SpotState, prompt: TrainerPrompt, onChoose: (index: number) => void) {
  return (
    <HotkeyRoot store={createHotkeyStore()}>
      <DecisionArea state={state} prompt={prompt} grouping="standard" interactive onChoose={onChoose} onNext={vi.fn()} onExplain={vi.fn()} />
    </HotkeyRoot>
  );
}

function actionButtons(): HTMLElement[] {
  return within(screen.getByRole("group", { name: "Actions" })).getAllByRole("button");
}

describe("R3.30 the focus leaves the action bar (review round 3, finding 1)", () => {
  it("R3.30 clicking an action moves the focus off the bar, onto the decision area", async () => {
    const onChoose = vi.fn();
    render(area(awaiting(fixturePlainPrompt), fixturePlainPrompt, onChoose));
    await userEvent.click(screen.getByRole("button", { name: "Raise to 2.5bb" }));
    expect(onChoose).toHaveBeenCalledOnce();
    expect(actionButtons()).not.toContain(document.activeElement);
    expect(document.activeElement).toBe(screen.getByTestId("decision-area"));
  });

  it("R3.30 a new prompt in the same area takes the focus off a focused action button; Space and Enter then submit nothing", async () => {
    const onChoose = vi.fn();
    const { rerender } = render(area(awaiting(fixturePlainPrompt), fixturePlainPrompt, onChoose));
    screen.getByRole("button", { name: "Raise to 2.5bb" }).focus();
    rerender(area(awaiting(NEXT), NEXT, onChoose));
    expect(actionButtons()).not.toContain(document.activeElement);
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Enter}");
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("R3.30 the same prompt rendered again keeps a focus the user put on a button", () => {
    const onChoose = vi.fn();
    const { rerender } = render(area(awaiting(fixturePlainPrompt), fixturePlainPrompt, onChoose));
    const call = screen.getByRole("button", { name: "Call" });
    call.focus();
    rerender(area(awaiting(fixturePlainPrompt), fixturePlainPrompt, onChoose));
    expect(document.activeElement).toBe(call);
  });
});
