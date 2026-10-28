/**
 * A practice run owns its session's life (S41, R3.16, R3.17, O-419, PR #41 review round 1). Only the
 * player's Start posts POST /sessions; whatever way the run is left (another address, another
 * route, a sign-out, a tab close, or the start still in flight), its session is ended with POST
 * /sessions/{id}/end, once, under one Idempotency-Key; a failed end is reported on the console; and
 * React's development double mount (StrictMode) never ends a live session. Each case runs on /quiz
 * and on /paint.
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_PAINT_SESSION_ID, fixturePaintPrompt, fixturePaintSession } from "../../src/fixtures/paint.js";
import { fixturePredictionPrompt, fixturePredictionSession } from "../../src/fixtures/prediction.js";
import { jsonResponse, noContent, problemResponse, type FetchScript, type ResponseFactory } from "../api/fake-fetch.js";
import { APP_SUITE } from "./app-suite-timeout.js";
import { END_PATH, NEXT_PATH, SESSION_ID, START_PATH, pressStart, renderQuiz, type QuizView } from "./render-quiz.js";

const QUIZ_LINK = "/quiz?config=cfg_6_online_100&positions=BB&spots=vs_open&kinds=range,hand&difficulty=medium";
const QUIZ_HARD_LINK = "/quiz?config=cfg_6_online_100&positions=BB&spots=vs_open&kinds=range,hand&difficulty=hard";
const PAINT_LINK = "/paint?config=cfg_6_online_100&position=BB&spot=vs_open&vs=BTN";
const LOGOUT_PATH = "POST /api/v1/auth/logout";
const SERVER_FAILURE = 500;
/** Long enough for a deferred cleanup (a zero-delay timer) to have run. */
const AFTER_DEFERRED_CLEANUP_MS = 50;

const ENDED = {
  ended_at: "2026-10-28T12:00:00Z",
  decisions: 0,
  rated_decisions: 0,
  mean_score: null,
  ev_loss_bb_total: 0,
  rating_changes: [],
  tier: null,
  unlocks: [],
};

interface Surface {
  rid: string;
  name: string;
  link: string;
  startLabel: string;
  endPath: string;
  sessionId: string;
  /** The start answer and the first prompt read. */
  script: (start: ResponseFactory) => FetchScript;
  /** Waits until the run shows its first prompt. */
  live: () => Promise<unknown>;
}

const QUIZ: Surface = {
  rid: "R3.16",
  name: "quiz",
  link: QUIZ_LINK,
  startLabel: "Start quiz",
  endPath: END_PATH,
  sessionId: SESSION_ID,
  script: (start) => ({ [START_PATH]: [start], [NEXT_PATH]: [jsonResponse(200, fixturePredictionPrompt("percent"))] }),
  live: () => screen.findByRole("heading", { name: fixturePredictionPrompt("percent").question }),
};

const PAINT: Surface = {
  rid: "R3.17",
  name: "painting",
  link: PAINT_LINK,
  startLabel: "Start painting",
  endPath: `POST /api/v1/sessions/${FIXTURE_PAINT_SESSION_ID}/end`,
  sessionId: FIXTURE_PAINT_SESSION_ID,
  script: (start) => ({ [START_PATH]: [start], [`GET /api/v1/range-paint/${FIXTURE_PAINT_SESSION_ID}/next`]: [jsonResponse(200, fixturePaintPrompt)] }),
  live: () => screen.findByTestId("range-painter"),
};

const START_ANSWER = { [QUIZ.name]: fixturePredictionSession, [PAINT.name]: fixturePaintSession };

interface Gate {
  factory: ResponseFactory;
  release: () => void;
}

/** A response held back until the test releases it. */
function gate(factory: ResponseFactory): Gate {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { factory: async () => opened.then(factory), release: () => open() };
}

function endOk(surface: Surface): ResponseFactory {
  return jsonResponse(200, { ...ENDED, session_id: surface.sessionId });
}

function startOk(surface: Surface): ResponseFactory {
  return jsonResponse(201, START_ANSWER[surface.name]);
}

async function settled(view: QuizView): Promise<void> {
  await waitFor(() => expect(view.queryClient.isFetching() === 0 && view.queryClient.isMutating() === 0).toBe(true));
}

async function startedRun(surface: Surface, extra: FetchScript = {}, strict = false): Promise<QuizView> {
  const view = renderQuiz(surface.link, { ...surface.script(startOk(surface)), [surface.endPath]: [endOk(surface)], ...extra }, { strict });
  await pressStart(surface.startLabel);
  await surface.live();
  return view;
}

async function go(view: QuizView, to: string): Promise<void> {
  await act(async () => {
    view.history.push(to);
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([QUIZ, PAINT])("$rid a $name run ends its session however it is left (PR #41 review round 1)", APP_SUITE, (surface) => {
  it(`${surface.rid} leaving while POST /sessions is in flight ends the new session once it exists (finding 1)`, async () => {
    const start = gate(startOk(surface));
    const view = renderQuiz(surface.link, { ...surface.script(start.factory), [surface.endPath]: [endOk(surface)] });
    await pressStart(surface.startLabel);
    await waitFor(() => expect(view.sentTo(START_PATH)).toHaveLength(1));
    await go(view, "/study");
    act(() => start.release());
    await waitFor(() => expect(view.sentTo(surface.endPath)).toHaveLength(1));
    await settled(view);
    expect(view.sentTo(START_PATH)).toHaveLength(1);
    expect(view.sentTo(surface.endPath)).toHaveLength(1);
  });

  it(`${surface.rid} navigating to /study ends the session (finding 2)`, async () => {
    const view = await startedRun(surface);
    await go(view, "/study");
    await waitFor(() => expect(view.sentTo(surface.endPath)).toHaveLength(1));
    expect(view.sentTo(surface.endPath)[0]?.idempotencyKey).toBeTruthy();
  });

  it(`${surface.rid} signing out ends the session before the logout (finding 2)`, async () => {
    const view = await startedRun(surface, { [LOGOUT_PATH]: [noContent()] });
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(view.sentTo(LOGOUT_PATH)).toHaveLength(1));
    await settled(view);
    const order = view.sent.map((request) => request.key).filter((key) => key === surface.endPath || key === LOGOUT_PATH);
    expect(order).toEqual([surface.endPath, LOGOUT_PATH]);
  });

  it(`${surface.rid} closing the tab sends a keepalive end (pagehide)`, async () => {
    const view = await startedRun(surface);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await waitFor(() => expect(view.sentTo(surface.endPath)).toHaveLength(1));
    expect(view.sentTo(surface.endPath)[0]?.keepalive).toBe(true);
  });

  it(`${surface.rid} a link visit, Back and Forward never POST /sessions without Start (finding 4)`, async () => {
    const view = renderQuiz(surface.link, { ...surface.script(startOk(surface)), [surface.endPath]: [endOk(surface)] });
    await screen.findByRole("button", { name: surface.startLabel });
    await settled(view);
    expect(view.sentTo(START_PATH)).toHaveLength(0);
    await pressStart(surface.startLabel);
    await surface.live();
    await go(view, surface.link.split("?")[0] ?? "/");
    await waitFor(() => expect(view.sentTo(surface.endPath)).toHaveLength(1));
    act(() => view.history.back());
    await waitFor(() => expect(screen.getByRole("button", { name: surface.startLabel })).toBeInTheDocument());
    act(() => view.history.forward());
    act(() => view.history.back());
    await waitFor(() => expect(screen.getByRole("button", { name: surface.startLabel })).toBeInTheDocument());
    await settled(view);
    expect(view.sentTo(START_PATH)).toHaveLength(1);
    expect(view.sentTo(surface.endPath)).toHaveLength(1);
  });

  it(`${surface.rid} a failed end is reported on the console, never swallowed (finding 5)`, async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = await startedRun(surface, { [surface.endPath]: [problemResponse(SERVER_FAILURE, "internal")] });
    await go(view, "/study");
    await waitFor(() => expect(view.sentTo(surface.endPath)).toHaveLength(1));
    await waitFor(() => expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(`status ${SERVER_FAILURE}`)));
  });

  it(`${surface.rid} StrictMode's double mount never ends a live session`, async () => {
    const view = await startedRun(surface, {}, true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, AFTER_DEFERRED_CLEANUP_MS));
    });
    expect(view.sentTo(surface.endPath)).toHaveLength(0);
    expect(view.sentTo(START_PATH)).toHaveLength(1);
    await surface.live();
    await go(view, "/study");
    await waitFor(() => expect(view.sentTo(surface.endPath)).toHaveLength(1));
  });
});

describe("R3.16 End quiz and leaving share one end (PR #41 review round 1, finding 3)", APP_SUITE, () => {
  it.each([
    ["another quiz address", QUIZ_HARD_LINK, "/quiz", { difficulty: "hard" }],
    ["another route", "/study", "/study", {}],
  ])("R3.16 End quiz in flight, then %s: one end, one Idempotency-Key, and no navigation back to /quiz", async (_why, to, pathname, search) => {
    const end = gate(endOk(QUIZ));
    const view = await startedRun(QUIZ, { [END_PATH]: [end.factory] });
    await userEvent.click(screen.getByRole("button", { name: "End quiz" }));
    await waitFor(() => expect(view.sentTo(END_PATH)).toHaveLength(1));
    await go(view, to);
    act(() => end.release());
    await settled(view);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, AFTER_DEFERRED_CLEANUP_MS));
    });
    expect(new Set(view.sentTo(END_PATH).map((request) => request.idempotencyKey)).size).toBe(1);
    expect(view.sentTo(END_PATH)).toHaveLength(1);
    expect(view.router.state.location.pathname).toBe(pathname);
    expect(view.router.state.location.search).toMatchObject(search);
  });
});

describe("R3.16 a Start overtaken by another navigation arms nothing (PR #41 review round 1, finding 4)", APP_SUITE, () => {
  it("R3.16 a later visit to the started address shows the start screen and posts nothing", async () => {
    const view = renderQuiz(QUIZ_LINK, { ...QUIZ.script(startOk(QUIZ)), [END_PATH]: [endOk(QUIZ)] });
    const start = await screen.findByRole("button", { name: "Start quiz" });
    await waitFor(() => expect(start).toBeEnabled());
    await settled(view);
    await userEvent.click(screen.getByRole("radio", { name: "Hard" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start quiz" }));
      view.history.push("/quiz");
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Start quiz" })).toBeInTheDocument());
    await go(view, QUIZ_HARD_LINK);
    await waitFor(() => expect(screen.getByRole("button", { name: "Start quiz" })).toBeInTheDocument());
    await settled(view);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, AFTER_DEFERRED_CLEANUP_MS));
    });
    expect(view.sentTo(START_PATH)).toHaveLength(0);
  });
});
