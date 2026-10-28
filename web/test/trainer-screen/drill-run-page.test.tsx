/**
 * The drill run screen in spot mode (S25, R3.13, R3.11, O-284, O-285, O-288, ADR 0018): the start
 * panel, the confidence tap before any reveal, the decision request and its Idempotency-Key, the
 * 409 and 422 paths, the next-prompt prefetch, the hotkeys and the recap.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ME_QUERY_KEY } from "../../src/auth/index.js";
import { FIXTURE_CSRF_TOKEN } from "../../src/fixtures/index.js";
import {
  FIXTURE_SEED,
  fixtureDrill,
  fixturePlainFeedback,
  fixturePlainPrompt,
  fixtureRecap,
  fixtureRngFeedback,
  fixtureRngPrompt,
  fixtureTrainerHands,
} from "../../src/fixtures/trainer.js";
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
  await userEvent.click(screen.getByRole("button", { name: "Sure" }));
  await screen.findByTestId("feedback-panel");
}

describe("R3.13 drill run start panel", () => {
  it("R3.13 shows the drill's name, grouping, stop rule and an RNG switch set from trainer.rng", async () => {
    renderRun({ script: {} });
    expect(await screen.findByRole("heading", { name: fixtureDrill.name })).toBeInTheDocument();
    expect(screen.getByText("Grouped")).toBeInTheDocument();
    expect(screen.getByText("After each action")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "RNG mode" })).toHaveAttribute("aria-checked", "false");
  });

  it("R3.13 the start request carries mode drill, the drill id, settings.rng, the seed and an Idempotency-Key (O-288)", async () => {
    const view = renderRun({ script: PLAY_SCRIPT, seed: FIXTURE_SEED });
    await screen.findByRole("heading", { name: fixtureDrill.name });
    await userEvent.click(screen.getByRole("switch", { name: "RNG mode" }));
    await closeExplainerIfOpen();
    expect(screen.getByRole("switch", { name: "RNG mode" })).toHaveAttribute("aria-checked", "true");
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
    await userEvent.click(within(alert).getByRole("button", { name: "Back to the start panel" }));
    expect(screen.getByRole("button", { name: "Start session" })).toBeInTheDocument();
  });

  it("R3.13 a drill that cannot be read shows an explicit error", async () => {
    renderRun({ script: { [DRILL_PATH]: [problemResponse(404, "not-found")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
  });
});

describe("R3.11 confidence tap before any reveal", () => {
  it("R3.11 no feedback panel and no decision request before the tap; one request after it (O-198, O-284)", async () => {
    const view = renderRun({ script: PLAY_SCRIPT });
    await startSession(view);
    expect(screen.queryByTestId("confidence-tap")).not.toBeInTheDocument();
    await chooseRaise(view);
    expect(screen.getByTestId("confidence-tap")).toBeInTheDocument();
    expect(screen.queryByTestId("feedback-panel")).not.toBeInTheDocument();
    expect(view.sentTo(DECIDE_PATH)).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Unsure" }));
    await screen.findByTestId("feedback-panel");
    const decisions = view.sentTo(DECIDE_PATH);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.body).toEqual({
      state_version: fixturePlainPrompt.state_version,
      action_index: 2,
      confidence: "unsure",
      response_ms: COMMITTED_AT - SHOWN_AT,
    });
  });

  it("R3.11 choosing another action before the tap replaces the choice", async () => {
    const view = renderRun({ script: PLAY_SCRIPT });
    await startSession(view);
    await chooseRaise(view);
    await userEvent.click(screen.getByRole("button", { name: "Call" }));
    expect(screen.getByText("Your choice: Call")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sure" }));
    await screen.findByTestId("feedback-panel");
    expect(view.sentTo(DECIDE_PATH)[0]?.body).toMatchObject({ action_index: 1, confidence: "sure" });
  });
});

describe("R3.13 decision requests", () => {
  it("R3.13 one Idempotency-Key per decision, reused when a network failure is retried", async () => {
    const view = renderRun({
      script: { ...PLAY_SCRIPT, [DECIDE_PATH]: [networkFailure(), jsonResponse(200, fixturePlainFeedback)] },
    });
    await startSession(view);
    await chooseRaise(view);
    await userEvent.click(screen.getByRole("button", { name: "Sure" }));
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
    await userEvent.click(screen.getByRole("button", { name: "Sure" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("did not answer in time");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTestId("feedback-panel");
    await userEvent.click(screen.getByRole("button", { name: "Next hand" }));
    await screen.findByRole("button", { name: RAISE_NAME });
    await chooseRaise(view);
    await userEvent.click(screen.getByRole("button", { name: "Sure" }));
    await screen.findByTestId("feedback-panel");
    const keys = view.sentTo(DECIDE_PATH).map((request) => request.idempotencyKey);
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("R3.13 a 409 stale decision refetches the prompt and shows a notice", async () => {
    const view = renderRun({
      script: { ...PLAY_SCRIPT, [DECIDE_PATH]: [problemResponse(409, "stale-state")] },
    });
    await startSession(view);
    await chooseRaise(view);
    await userEvent.click(screen.getByRole("button", { name: "Sure" }));
    expect(await screen.findByText(/The session moved on/)).toBeInTheDocument();
    expect(view.sentTo(NEXT_PATH)).toHaveLength(2);
    expect(screen.queryByTestId("feedback-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: RAISE_NAME })).toBeEnabled();
  });

  it("R3.13 a 401 on a decision signs the screen out (the me query becomes null)", async () => {
    const view = renderRun({ script: { ...PLAY_SCRIPT, [DECIDE_PATH]: [problemResponse(401, "unauthenticated")] } });
    await startSession(view);
    await chooseRaise(view);
    await userEvent.click(screen.getByRole("button", { name: "Sure" }));
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

  it("R3.13 the table shows the hero's cards, the action so far and the synthetic banner (O-57, O-281)", async () => {
    const view = renderRun({ script: PLAY_SCRIPT });
    await startSession(view);
    expect(screen.getByRole("img", { name: "Ace of hearts" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Table, 6 seats/ })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Action so far" })).toHaveTextContent("UTG Fold");
    expect(screen.getByRole("note")).toHaveTextContent("Synthetic");
  });

  it("R3.10 with RNG on the roll shows before the decision and the roller after it", async () => {
    const view = renderRun({
      script: { ...PLAY_SCRIPT, [NEXT_PATH]: [jsonResponse(200, fixtureRngPrompt)], [DECIDE_PATH]: [jsonResponse(200, fixtureRngFeedback)] },
    });
    await screen.findByRole("heading", { name: fixtureDrill.name });
    await userEvent.click(screen.getByRole("switch", { name: "RNG mode" }));
    await closeExplainerIfOpen();
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    expect(await screen.findByTestId("roll-badge")).toHaveTextContent("37");
    await closeExplainerIfOpen();
    await chooseRaise(view);
    await userEvent.click(screen.getByRole("button", { name: "Sure" }));
    const panel = await screen.findByTestId("feedback-panel");
    expect(screen.queryByTestId("roll-badge")).not.toBeInTheDocument();
    expect(within(panel).getAllByTestId(/feedback-roller|rng-roller/).length).toBeGreaterThan(0);
  });
});

describe("R3.13 hotkeys drive the same transitions as clicks (O-285)", () => {
  it("R3.13 1 to 9 choose, S taps, N goes to the next hand, E then the confirm ends the session", async () => {
    const view = renderRun({ script: PLAY_SCRIPT });
    await startSession(view);
    view.clock.now = COMMITTED_AT;
    await userEvent.keyboard("3");
    expect(screen.getByText(`Your choice: ${RAISE_NAME}`)).toBeInTheDocument();
    await userEvent.keyboard("s");
    await screen.findByTestId("feedback-panel");
    expect(view.sentTo(DECIDE_PATH)[0]?.body).toMatchObject({ action_index: 2, confidence: "sure" });
    await userEvent.keyboard("n");
    expect(await screen.findByRole("img", { name: "King of spades" })).toBeInTheDocument();
    await userEvent.keyboard("e");
    const dialog = await screen.findByRole("dialog", { name: "End this session?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "End session" }));
    expect(await screen.findByRole("heading", { name: "Session recap" })).toBeInTheDocument();
    expect(view.sentTo(END_PATH)).toHaveLength(1);
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
