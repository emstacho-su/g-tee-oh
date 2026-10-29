/**
 * The drill run screen in spot mode (S25, S37, R3.13, R3.10, O-284, O-285, O-288, O-345, ADR 0018,
 * ADR 0024): the start panel, choosing an action submits it (the confidence tap is retired), the
 * decision request and its Idempotency-Key, the 409 and 422 paths, the next-prompt prefetch, the
 * hidden-then-revealed roll scale of Mixed-frequency mode, the hotkeys and the recap.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ME_QUERY_KEY } from "../../src/auth/index.js";
import { SYNTHETIC_TEXT } from "../../src/components/ui/index.js";
import { FIXTURE_CSRF_TOKEN } from "../../src/fixtures/index.js";
import {
  FIXTURE_SEED,
  fixtureDrill,
  fixturePlainFeedback,
  fixturePlainPrompt,
  fixturePracticeSession,
  fixtureRecap,
  fixtureRngFeedback,
  fixtureRngPrompt,
  fixtureTrainerHands,
} from "../../src/fixtures/trainer.js";
import { useTrainerTableStore } from "../../src/store/index.js";
import { drillQuery } from "../../src/trainer/session-api.js";
import { jsonResponse, networkFailure, problemResponse } from "../api/fake-fetch.js";
import { DECIDE_PATH, DRILL_PATH, END_PATH, NEXT_PATH, START_PATH, renderRun, type RunView } from "./render-run.js";

const SHOWN_AT = 1_000;
const COMMITTED_AT = 3_450;
const RAISE_NAME = "Raise to 2.5bb";
const SECOND_PROMPT = { ...(fixtureTrainerHands[1]?.prompt ?? fixturePlainPrompt), state_version: 5 };

const PLAY_SCRIPT = {
  [NEXT_PATH]: [jsonResponse(200, fixturePlainPrompt), jsonResponse(200, SECOND_PROMPT)],
  [DECIDE_PATH]: [jsonResponse(200, fixturePlainFeedback)],
  [END_PATH]: [jsonResponse(200, fixtureRecap)],
};
const NEXT_ONLY = { [NEXT_PATH]: [jsonResponse(200, fixturePlainPrompt)] };

async function startSession(view: RunView): Promise<void> {
  await screen.findByRole("heading", { name: fixtureDrill.name });
  view.clock.now = SHOWN_AT;
  await userEvent.click(screen.getByRole("button", { name: "Start session" }));
  await screen.findByRole("group", { name: "Actions" });
}

async function chooseRaise(view: RunView): Promise<void> {
  view.clock.now = COMMITTED_AT;
  await userEvent.click(screen.getByRole("button", { name: RAISE_NAME }));
}

/** Lane C's explainer opens on first use (O-283); this screen test only needs it out of the way. */
async function closeExplainerIfOpen(): Promise<void> {
  if (screen.queryByRole("dialog") !== null) await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

async function playToFeedback(view: RunView): Promise<void> {
  await startSession(view);
  await chooseRaise(view);
  await screen.findByTestId("feedback-panel");
}

describe("R3.13 drill run start panel", () => {
  it("R3.13 shows the drill's name, grouping, stop rule and an RNG switch set from trainer.rng", async () => {
    renderRun({ script: {} });
    expect(await screen.findByRole("heading", { name: fixtureDrill.name })).toBeInTheDocument();
    expect(screen.getByText("Grouped")).toBeInTheDocument();
    // The stop rule reads as the library and the builder name it (src/drills/labels.ts, LOW 10).
    expect(screen.getByText("Spot")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Mixed-frequency mode" })).toHaveAttribute("aria-checked", "false");
  });

  it("R3.13 the start request carries mode drill, the drill id, settings.rng, the seed and an Idempotency-Key (O-288)", async () => {
    const view = renderRun({ script: PLAY_SCRIPT, seed: FIXTURE_SEED });
    await screen.findByRole("heading", { name: fixtureDrill.name });
    await userEvent.click(screen.getByRole("switch", { name: "Mixed-frequency mode" }));
    await closeExplainerIfOpen();
    expect(screen.getByRole("switch", { name: "Mixed-frequency mode" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    await screen.findByRole("group", { name: "Actions" });
    const [start] = view.sentTo(START_PATH);
    expect(start?.body).toEqual({ mode: "drill", drill_id: fixtureDrill.id, settings: { rng: true }, seed: FIXTURE_SEED });
    expect(start?.idempotencyKey).toMatch(/^key-\d+$/);
  });

  it("R3.13 without a seed the start request has none, and RNG off sends settings.rng false", async () => {
    const view = renderRun({ script: PLAY_SCRIPT });
    await startSession(view);
    expect(view.sentTo(START_PATH)[0]?.body).toEqual({ mode: "drill", drill_id: fixtureDrill.id, settings: { rng: false } });
  });

  it("R3.13 a 422 no-coverage says the drill has no covered spot and its gaps were queued (ADR 0018)", async () => {
    renderRun({ script: { [START_PATH]: [problemResponse(422, "no-coverage", "server detail never shown")] } });
    await screen.findByRole("heading", { name: fixtureDrill.name });
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("no covered spot");
    expect(alert).toHaveTextContent("queued for the library builder");
    expect(alert).not.toHaveTextContent("server detail never shown");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to the start panel" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start session" })).toBeEnabled();
  });

  it("R3.13 Start works again after a 422: a new request with a new key", async () => {
    const view = renderRun({ script: { [START_PATH]: [problemResponse(422, "no-coverage"), jsonResponse(201, fixturePracticeSession)], ...NEXT_ONLY } });
    await screen.findByRole("heading", { name: fixtureDrill.name });
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    await screen.findByRole("group", { name: "Actions" });
    const [first, second] = view.sentTo(START_PATH);
    expect(second?.idempotencyKey).not.toBe(first?.idempotencyKey);
  });

  it("R3.13 Start after a network failure resends the same request and key; a changed RNG switch is sent with a new key", async () => {
    const view = renderRun({
      script: { [START_PATH]: [networkFailure(), networkFailure(), jsonResponse(201, fixturePracticeSession)], ...NEXT_ONLY },
    });
    await screen.findByRole("heading", { name: fixtureDrill.name });
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("did not reach the server");
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    await waitFor(() => expect(view.sentTo(START_PATH)).toHaveLength(2));
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("switch", { name: "Mixed-frequency mode" }));
    await closeExplainerIfOpen();
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    await screen.findByRole("group", { name: "Actions" });
    const [first, second, third] = view.sentTo(START_PATH);
    expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
    expect(second?.body).toEqual(first?.body);
    expect(third?.idempotencyKey).not.toBe(first?.idempotencyKey);
    expect(third?.body).toMatchObject({ settings: { rng: true } });
  });

  it("R3.13 a failed background refetch of the drill does not cover a running session", async () => {
    const view = renderRun({ script: { ...PLAY_SCRIPT, [DRILL_PATH]: [jsonResponse(200, fixtureDrill), problemResponse(503, "unavailable")] } });
    await startSession(view);
    await view.queryClient.refetchQueries({ queryKey: drillQuery(view.api, fixtureDrill.id).queryKey });
    expect(view.sentTo(DRILL_PATH)).toHaveLength(2);
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: RAISE_NAME })).toBeEnabled();
  });

  it("R3.13 a drill that cannot be read shows an explicit error", async () => {
    renderRun({ script: { [DRILL_PATH]: [problemResponse(404, "not-found")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
  });
});

describe("R3.13 choosing an action submits it (O-345)", () => {
  it("R3.13 no feedback panel and no decision request before the choice; the choice sends one request with no confidence field (O-198, O-345, O-373)", async () => {
    const view = renderRun({ script: PLAY_SCRIPT });
    await startSession(view);
    expect(screen.queryByTestId("feedback-panel")).not.toBeInTheDocument();
    expect(view.sentTo(DECIDE_PATH)).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Sure" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unsure" })).not.toBeInTheDocument();

    await chooseRaise(view);
    await screen.findByTestId("feedback-panel");
    const decisions = view.sentTo(DECIDE_PATH);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.body).toEqual({
      state_version: fixturePlainPrompt.state_version,
      action_index: 2,
      response_ms: COMMITTED_AT - SHOWN_AT,
    });
  });
});

describe("R3.13 decision requests", () => {
  it("R3.13 one Idempotency-Key per decision, reused when a network failure is retried", async () => {
    const view = renderRun({
      script: { ...PLAY_SCRIPT, [DECIDE_PATH]: [networkFailure(), jsonResponse(200, fixturePlainFeedback)] },
    });
    await startSession(view);
    await chooseRaise(view);
    expect(await screen.findByRole("alert")).toHaveTextContent("did not reach the server");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTestId("feedback-panel");
    const [first, second] = view.sentTo(DECIDE_PATH);
    expect(first?.idempotencyKey).toMatch(/^key-\d+$/);
    expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
    expect(second?.body).toEqual(first?.body);
  });

  it("R3.13 a 503 shows a retry, and the retry reuses the key; the next decision gets a new key", async () => {
    const view = renderRun({
      script: {
        ...PLAY_SCRIPT,
        [DECIDE_PATH]: [problemResponse(503, "unavailable"), jsonResponse(200, fixturePlainFeedback), jsonResponse(200, fixturePlainFeedback)],
      },
    });
    await startSession(view);
    await chooseRaise(view);
    expect(await screen.findByRole("alert")).toHaveTextContent("did not answer in time");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTestId("feedback-panel");
    await userEvent.click(screen.getByRole("button", { name: "Next hand" }));
    await screen.findByRole("button", { name: RAISE_NAME });
    await chooseRaise(view);
    await screen.findByTestId("feedback-panel");
    const keys = view.sentTo(DECIDE_PATH).map((request) => request.idempotencyKey);
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("R3.13 a fixed 400 on a decision offers End, not Try again", async () => {
    const view = renderRun({ script: { ...PLAY_SCRIPT, [DECIDE_PATH]: [problemResponse(400, "validation")] } });
    await startSession(view);
    await chooseRaise(view);
    expect(await screen.findByRole("alert")).toHaveTextContent("The request failed (status 400).");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "End session" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "End session" }));
    expect(await screen.findByRole("heading", { name: "Session recap" })).toBeInTheDocument();
  });

  it("R3.13 a session that already ended shows its recap, fetched through POST end", async () => {
    const view = renderRun({ script: { ...PLAY_SCRIPT, [NEXT_PATH]: [problemResponse(409, "session-ended")] } });
    await screen.findByRole("heading", { name: fixtureDrill.name });
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    expect(await screen.findByRole("heading", { name: "Session recap" })).toBeInTheDocument();
    expect(view.sentTo(END_PATH)).toHaveLength(1);
  });

  it("R3.13 time with the explainer open does not count toward response_ms (O-284)", async () => {
    const view = renderRun({
      script: { ...PLAY_SCRIPT, [NEXT_PATH]: [jsonResponse(200, fixtureRngPrompt)], [DECIDE_PATH]: [jsonResponse(200, fixtureRngFeedback)] },
    });
    await screen.findByRole("heading", { name: fixtureDrill.name });
    await userEvent.click(screen.getByRole("switch", { name: "Mixed-frequency mode" }));
    await closeExplainerIfOpen();
    view.clock.now = SHOWN_AT;
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    const badge = await screen.findByTestId("rng-roller");
    await closeExplainerIfOpen();
    view.clock.now = 2_000;
    await userEvent.click(within(badge).getByRole("button", { name: "How Mixed-frequency mode works" }));
    await screen.findByRole("dialog");
    view.clock.now = 5_000;
    await closeExplainerIfOpen();
    view.clock.now = 6_000;
    await userEvent.click(screen.getByRole("button", { name: RAISE_NAME }));
    await screen.findByTestId("feedback-panel");
    expect(view.sentTo(DECIDE_PATH)[0]?.body).toMatchObject({ response_ms: 2_000 });
  });

  it("R3.13 a response that arrives after the screen unmounted writes nothing", async () => {
    let answer: (response: Response) => void = () => undefined;
    const late = () => new Promise<Response>((resolve) => (answer = resolve));
    const view = renderRun({ script: { [NEXT_PATH]: [late] } });
    await screen.findByRole("heading", { name: fixtureDrill.name });
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    await waitFor(() => expect(view.sentTo(NEXT_PATH)).toHaveLength(1));
    view.unmount();
    answer(await jsonResponse(200, fixturePlainPrompt)());
    await new Promise((done) => setTimeout(done, 0));
    expect(useTrainerTableStore.getState().prompt).toBeNull();
  });

  it("R3.13 a 409 stale decision refetches the prompt and shows a notice", async () => {
    const view = renderRun({
      script: { ...PLAY_SCRIPT, [DECIDE_PATH]: [problemResponse(409, "stale-state")] },
    });
    await startSession(view);
    await chooseRaise(view);
    expect(await screen.findByText(/The session moved on/)).toBeInTheDocument();
    expect(view.sentTo(NEXT_PATH)).toHaveLength(2);
    expect(screen.queryByTestId("feedback-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: RAISE_NAME })).toBeEnabled();
  });

  it("R3.13 a 401 on a decision signs the screen out (the me query becomes null)", async () => {
    const view = renderRun({ script: { ...PLAY_SCRIPT, [DECIDE_PATH]: [problemResponse(401, "unauthenticated")] } });
    await startSession(view);
    await chooseRaise(view);
    expect(await screen.findByRole("alert")).toHaveTextContent("signed out");
    expect(view.queryClient.getQueryData(ME_QUERY_KEY)).toBeNull();
  });

  it("R3.13 every POST goes out with the csrf token header (O-197)", async () => {
    const view = renderRun({ script: PLAY_SCRIPT });
    await playToFeedback(view);
    const posts = view.sent.filter((request) => request.key.startsWith("POST "));
    expect(posts.map((request) => request.key)).toEqual([START_PATH, DECIDE_PATH]);
    for (const post of posts) expect(post.csrf).toBe(FIXTURE_CSRF_TOKEN);
  });
});

describe("R3.13 feedback, next and prefetch", () => {
  it("R3.13 the next prompt is prefetched while the feedback shows, so Next sends no request (A7 section 4)", async () => {
    const view = renderRun({ script: PLAY_SCRIPT });
    await playToFeedback(view);
    await waitFor(() => expect(view.sentTo(NEXT_PATH)).toHaveLength(2));
    await userEvent.click(screen.getByRole("button", { name: "Next hand" }));
    expect(await screen.findByRole("img", { name: "King of spades" })).toBeInTheDocument();
    expect(view.sentTo(NEXT_PATH)).toHaveLength(2);
    expect(screen.queryByTestId("feedback-panel")).not.toBeInTheDocument();
  });

  it("R3.13 the feedback pauses until Next: the action bar is disabled and the chosen action is reported (O-284)", async () => {
    const view = renderRun({ script: PLAY_SCRIPT });
    await playToFeedback(view);
    expect(screen.getByRole("button", { name: RAISE_NAME })).toBeDisabled();
    expect(screen.getByTestId("feedback-panel")).toHaveTextContent("Your action: Raise 2.5bb");
  });

  it("R3.13 the table shows the hero's cards, the action log and the synthetic banner (O-57, O-281, O-383)", async () => {
    const view = renderRun({ script: PLAY_SCRIPT });
    await startSession(view);
    expect(screen.getByRole("img", { name: "Ace of hearts" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Table, 6 seats/ })).toBeInTheDocument();
    expect(screen.getByRole("log", { name: "Action this hand" })).toHaveTextContent("UTG: Fold");
    expect(screen.getByTestId("synthetic-banner")).toHaveTextContent(SYNTHETIC_TEXT);
  });

  it("R3.10 with Mixed-frequency mode on, the scale shows the roll and no bands before the decision, and the same scale reveals the bands after it (ADR 0024, O-344)", async () => {
    const view = renderRun({
      script: { ...PLAY_SCRIPT, [NEXT_PATH]: [jsonResponse(200, fixtureRngPrompt)], [DECIDE_PATH]: [jsonResponse(200, fixtureRngFeedback)] },
    });
    await screen.findByRole("heading", { name: fixtureDrill.name });
    await userEvent.click(screen.getByRole("switch", { name: "Mixed-frequency mode" }));
    await closeExplainerIfOpen();
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    const hidden = await screen.findByTestId("rng-roller");
    expect(hidden).toHaveAttribute("data-revealed", "false");
    expect(hidden).toHaveTextContent("Roll 37");
    expect(within(hidden).queryByRole("list", { name: "Mixed-frequency bands" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("roll-badge")).not.toBeInTheDocument();
    await closeExplainerIfOpen();
    await chooseRaise(view);
    const panel = await screen.findByTestId("feedback-panel");
    const revealed = within(panel).getByTestId("rng-roller");
    expect(revealed).toHaveAttribute("data-revealed", "true");
    expect(within(revealed).getByRole("list", { name: "Mixed-frequency bands" })).toBeInTheDocument();
    expect(screen.getAllByTestId("rng-roller"), "one scale on screen, now revealed").toHaveLength(1);
  });
});

describe("R3.13 hotkeys drive the same transitions as clicks (O-285)", () => {
  it("R3.30 the size digit submits, Enter goes to the next hand, Shift+E then the confirm ends the session (O-345)", async () => {
    const view = renderRun({ script: PLAY_SCRIPT });
    await startSession(view);
    view.clock.now = COMMITTED_AT;
    // The raise is the first size at the node, so its key is 1 whatever stands before it (O-475).
    await userEvent.keyboard("1");
    await screen.findByTestId("feedback-panel");
    expect(view.sentTo(DECIDE_PATH)[0]?.body).toEqual({
      state_version: fixturePlainPrompt.state_version,
      action_index: 2,
      response_ms: COMMITTED_AT - SHOWN_AT,
    });
    await userEvent.keyboard("r");
    expect(screen.getByTestId("feedback-panel"), "R is reserved and does nothing").toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("img", { name: "King of spades" })).toBeInTheDocument();
    await userEvent.keyboard("e");
    expect(screen.queryByRole("dialog", { name: "End this session?" }), "a bare E no longer ends").not.toBeInTheDocument();
    await userEvent.keyboard("{Shift>}e{/Shift}");
    const dialog = await screen.findByRole("dialog", { name: "End this session?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "End session" }));
    expect(await screen.findByRole("heading", { name: "Session recap" })).toBeInTheDocument();
    expect(view.sentTo(END_PATH)).toHaveLength(1);
  });

  it("R3.30 the letter of the kind submits (F folds), the bar marks the chosen button, and N still goes on", async () => {
    const view = renderRun({ script: PLAY_SCRIPT });
    await startSession(view);
    view.clock.now = COMMITTED_AT;
    await userEvent.keyboard("f");
    await screen.findByTestId("feedback-panel");
    expect(view.sentTo(DECIDE_PATH)[0]?.body).toMatchObject({ action_index: 0 });
    expect(screen.getByRole("button", { name: "Fold" }), "the chosen action stays marked on the strip (critic G10)").toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: RAISE_NAME })).not.toHaveAttribute("aria-pressed");
    await userEvent.keyboard("n");
    expect(await screen.findByRole("img", { name: "King of spades" })).toBeInTheDocument();
  });

  it("R3.13 N does nothing before the feedback", async () => {
    const view = renderRun({ script: PLAY_SCRIPT });
    await startSession(view);
    await userEvent.keyboard("n");
    expect(view.sentTo(NEXT_PATH)).toHaveLength(1);
    expect(screen.getByRole("button", { name: RAISE_NAME })).toBeEnabled();
  });

  it("R3.13 Keep playing closes the confirm without ending", async () => {
    const view = renderRun({ script: PLAY_SCRIPT });
    await startSession(view);
    await userEvent.click(screen.getByRole("button", { name: "End session" }));
    const dialog = await screen.findByRole("dialog", { name: "End this session?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep playing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(view.sentTo(END_PATH)).toHaveLength(0);
  });
});

describe("R3.13 recap after end", () => {
  it("R3.13 ending shows the recap from the api, and a new session can start", async () => {
    const view = renderRun({ script: PLAY_SCRIPT });
    await playToFeedback(view);
    await userEvent.click(screen.getByRole("button", { name: "End session" }));
    const dialog = await screen.findByRole("dialog", { name: "End this session?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "End session" }));
    const recap = await screen.findByRole("region", { name: "Session recap" });
    expect(recap).toHaveTextContent("Decisions3");
    expect(recap).toHaveTextContent("Rated decisions3");
    expect(recap).toHaveTextContent("Mean score0.75");
    expect(recap).toHaveTextContent("EV loss0.19bb");
    expect(view.sentTo(END_PATH)[0]?.body).toEqual({});
    await userEvent.click(screen.getByRole("button", { name: "Start another session" }));
    expect(screen.getByRole("button", { name: "Start session" })).toBeInTheDocument();
  });

  it("R3.13 End pressed again after a failed end reuses the stored key", async () => {
    const view = renderRun({ script: { ...PLAY_SCRIPT, [END_PATH]: [networkFailure(), jsonResponse(200, fixtureRecap)] } });
    await startSession(view);
    await userEvent.click(screen.getByRole("button", { name: "End session" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "End session" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "End session" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "End session" }));
    await screen.findByRole("heading", { name: "Session recap" });
    const [first, second] = view.sentTo(END_PATH);
    expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
  });

  it("R3.13 a failed end can be retried with the same key", async () => {
    const view = renderRun({ script: { ...PLAY_SCRIPT, [END_PATH]: [networkFailure(), jsonResponse(200, fixtureRecap)] } });
    await startSession(view);
    await userEvent.click(screen.getByRole("button", { name: "End session" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "End session" }));
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { name: "Session recap" });
    const [first, second] = view.sentTo(END_PATH);
    expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
  });
});
