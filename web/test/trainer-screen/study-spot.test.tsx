/**
 * Study this spot on the reveal (S46, R3.34, item 11): the feedback's controls row links to the
 * decision's node in Study, in a new tab so the trainer stays behind, and Shift+S opens it too.
 * No link shows until the configuration list has arrived, and a study link never turns a panel on.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DecisionFeedback, TrainerPrompt } from "../../src/contracts.js";
import { fixtureFeedback, fixturePrompt } from "../../src/fixtures/index.js";
import { fixtureConfigs } from "../../src/fixtures/study.js";
import { fixturePracticeSession } from "../../src/fixtures/trainer.js";
import type { GameConfig } from "../../src/progress/types.js";
import { HotkeyRoot, createHotkeyStore } from "../../src/hotkeys/index.js";
import { DecisionArea } from "../../src/routes/drill-run/DecisionArea.js";
import { SESSION_TEXT } from "../../src/routes/drill-run/labels.js";
import type { SessionContext, SpotState } from "../../src/trainer/spot-machine.js";
import { studyHrefFor, studySearchFor } from "../../src/trainer/study-link.js";

const CONTEXT: SessionContext = { session: fixturePracticeSession, rng: false };
const PROMPT: TrainerPrompt = {
  ...fixturePrompt,
  history: [...fixturePrompt.history, { position: "BTN", token: "r250", label: "Raise to 2.5bb" }, { position: "SB", token: "f", label: "Fold" }],
};
const FEEDBACK: DecisionFeedback = { ...fixtureFeedback, hand: "AJo" };

function revealed(): SpotState {
  return { kind: "feedback", context: CONTEXT, prompt: PROMPT, decision: { actionIndex: 1, responseMs: 50, idempotencyKey: "d1", stateVersion: 3 }, feedback: FEEDBACK };
}

function renderReveal(configs: readonly GameConfig[] | null | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HotkeyRoot store={createHotkeyStore()}>
        <DecisionArea
          state={revealed()}
          prompt={PROMPT}
          grouping="standard"
          interactive
          onChoose={vi.fn()}
          onNext={vi.fn()}
          onExplain={vi.fn()}
          {...(configs === undefined ? {} : { studyConfigs: configs })}
        />
      </HotkeyRoot>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("R3.34 Study this spot", () => {
  it("R3.34 the reveal links to the decision's node in Study, in a new tab", () => {
    renderReveal(fixtureConfigs);
    const link = screen.getByRole("link", { name: new RegExp(SESSION_TEXT.studySpot) });
    const search = studySearchFor(FEEDBACK, PROMPT, fixtureConfigs);
    if (search === null) throw new Error("no study search");
    expect(link).toHaveAttribute("href", studyHrefFor(search));
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toMatch(/\bnoopener\b/);
    expect(link).toHaveAttribute("aria-keyshortcuts", "Shift+S");
  });

  it("R3.34 Shift+S opens the same link in a new tab", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderReveal(fixtureConfigs);
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard("{Shift>}S{/Shift}");
    const search = studySearchFor(FEEDBACK, PROMPT, fixtureConfigs);
    if (search === null) throw new Error("no study search");
    expect(open).toHaveBeenCalledWith(studyHrefFor(search), "_blank", "noopener");
  });

  it("R3.34 no link, and no Shift+S, until the configuration list arrives", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderReveal(undefined);
    expect(screen.queryByRole("link", { name: new RegExp(SESSION_TEXT.studySpot) })).not.toBeInTheDocument();
    await userEvent.keyboard("{Shift>}S{/Shift}");
    expect(open).not.toHaveBeenCalled();
  });
});

describe("R3.34 PR #50 review: a failed configuration read is said, never silent", () => {
  it("R3.34 when the configuration list fails, the controls row says Study this spot is unavailable, and no link or Shift+S is offered", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderReveal(null);
    expect(screen.queryByRole("link", { name: new RegExp(SESSION_TEXT.studySpot) })).not.toBeInTheDocument();
    expect(screen.getByText(SESSION_TEXT.studyUnavailable)).toBeInTheDocument();
    await userEvent.keyboard("{Shift>}S{/Shift}");
    expect(open).not.toHaveBeenCalled();
  });
});
