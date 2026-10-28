/**
 * Tests for the /paint screen (S27 lane B, R3.17, O-302) through the whole app over an injected
 * fake fetch: pick a drill, start a range_paint session, paint, submit the painted map, read the
 * graded view, go Next; and the failures it names without echoing a problem's text.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { RangePaintPrompt } from "../../src/contracts.js";
import {
  FIXTURE_PAINT_DRILL_ID,
  FIXTURE_PAINT_SESSION_ID,
  fixturePaintDrills,
  fixturePaintGraded,
  fixturePaintPrompt,
  fixturePaintSession,
} from "../../src/fixtures/paint.js";
import { fixtureDrill } from "../../src/fixtures/trainer.js";
import { jsonResponse, problemResponse, type FetchScript, type ResponseFactory } from "../api/fake-fetch.js";
import { SIGNED_IN, renderApp } from "../app/render-app.js";

const DRILLS = "GET /api/v1/drills";
const SESSIONS = "POST /api/v1/sessions";
const NEXT = `GET /api/v1/range-paint/${FIXTURE_PAINT_SESSION_ID}/next`;
const SUBMIT = "POST /api/v1/range-paint/submit";
const SECOND_PROMPT: RangePaintPrompt = { ...fixturePaintPrompt, state_version: 1, prompt_no: 1 };

function script(overrides: Record<string, readonly ResponseFactory[]> = {}): FetchScript {
  return {
    ...SIGNED_IN,
    [DRILLS]: [jsonResponse(200, { items: fixturePaintDrills, next_cursor: null })],
    [SESSIONS]: [jsonResponse(201, fixturePaintSession)],
    [NEXT]: [jsonResponse(200, fixturePaintPrompt), jsonResponse(200, SECOND_PROMPT)],
    [SUBMIT]: [jsonResponse(200, fixturePaintGraded)],
    ...overrides,
  };
}

async function startPainting(path = "/paint", overrides: Record<string, readonly ResponseFactory[]> = {}) {
  const user = userEvent.setup();
  const app = renderApp(path, script(overrides));
  await user.click(await screen.findByRole("radio", { name: fixturePaintDrills[0]?.name ?? "" }));
  await user.click(screen.getByRole("button", { name: /start painting/i }));
  return { app, user };
}

function bodyOf(app: ReturnType<typeof renderApp>, key: string): unknown {
  const call = app.fake.calls.find((candidate) => `${candidate.method} ${candidate.path}` === key);
  return call === undefined ? undefined : JSON.parse(call.body);
}

describe("R3.17 /paint", () => {
  it("R3.17 picks a drill, starts a range_paint session, submits the painted map and shows the grade, then Next", async () => {
    const { app, user } = await startPainting();
    expect(bodyOf(app, SESSIONS)).toMatchObject({ mode: "range_paint", drill_id: FIXTURE_PAINT_DRILL_ID });
    expect(await screen.findByTestId("range-painter")).toBeInTheDocument();
    expect(screen.getByTestId("synthetic-banner")).toBeInTheDocument();
    expect(screen.getByText(/Raise to 2\.5bb/)).toBeInTheDocument();
    await user.keyboard("3");
    await user.click(screen.getByRole("button", { name: /^AA: / }));
    await user.click(screen.getByRole("button", { name: /submit range/i }));
    const body = bodyOf(app, SUBMIT) as { paint: Record<string, number> };
    expect(body).toMatchObject({ session_id: FIXTURE_PAINT_SESSION_ID, state_version: 0, node_key: fixturePaintPrompt.node_key });
    expect(Object.keys(body.paint)).toHaveLength(fixturePaintPrompt.hands.length);
    expect(body.paint["AA"]).toBe(2);
    expect(await screen.findByTestId("paint-total")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next range/i }));
    expect(await screen.findByText(/range 2/i)).toBeInTheDocument();
    expect(app.fake.keys().filter((key) => key === NEXT)).toHaveLength(2);
  });

  it("R3.17 a drill in the address is selected already", async () => {
    renderApp(`/paint?drill=${fixtureDrill.id}`, script());
    expect(await screen.findByRole("radio", { name: fixtureDrill.name })).toBeChecked();
  });

  it("R3.17 with no drills it points to the drill builder", async () => {
    renderApp("/paint", script({ [DRILLS]: [jsonResponse(200, { items: [], next_cursor: null })] }));
    expect(await screen.findByRole("link", { name: /new drill/i })).toHaveAttribute("href", "/drills/new");
  });

  it("R3.17 a drill the library cannot cover is named without the problem's text", async () => {
    await startPainting("/paint", { [SESSIONS]: [problemResponse(422, "no-coverage")] });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/covers no spot/i);
    expect(alert).not.toHaveTextContent(/server detail text/);
  });

  it("R3.17 a stale submit offers to load the current range", async () => {
    const { app, user } = await startPainting("/paint", { [SUBMIT]: [problemResponse(409, "stale-state")] });
    await user.click(await screen.findByRole("button", { name: /submit range/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/moved on/i);
    await user.click(within(alert).getByRole("button", { name: /load the current range/i }));
    await waitFor(() => expect(app.fake.keys().filter((key) => key === NEXT)).toHaveLength(2));
    expect(await screen.findByText(/range 2/i)).toBeInTheDocument();
  });

  it("R3.17 a failed submit keeps the paint and Try again sends it again under a new key", async () => {
    const { app, user } = await startPainting("/paint", { [SUBMIT]: [problemResponse(502, "upstream"), jsonResponse(200, fixturePaintGraded)] });
    await user.keyboard("2");
    await user.click(await screen.findByRole("button", { name: /^AA: / }));
    await user.click(screen.getByRole("button", { name: /submit range/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/solver service/i);
    expect(screen.getByRole("button", { name: /^AA: / })).toHaveAccessibleName(/Call$/);
    await user.click(within(alert).getByRole("button", { name: /try again/i }));
    expect(await screen.findByTestId("paint-graded")).toBeInTheDocument();
    const submits = app.fake.calls.filter((call) => call.path === "/api/v1/range-paint/submit");
    expect(submits.map((call) => JSON.parse(call.body) as unknown)).toEqual([JSON.parse(submits[0]?.body ?? "null"), JSON.parse(submits[0]?.body ?? "null")]);
  });

  it("R3.17 a first-to-act spot with real data shows no history and no synthetic banner", async () => {
    const opening: RangePaintPrompt = { ...fixturePaintPrompt, history: [], hero_position: "BTN", synthetic: false };
    await startPainting("/paint", { [NEXT]: [jsonResponse(200, opening)] });
    expect(await screen.findByText(/first to act/i)).toBeInTheDocument();
    expect(screen.queryByTestId("synthetic-banner")).toBeNull();
  });

  it("R3.17 a failed drill list says so", async () => {
    renderApp("/paint", script({ [DRILLS]: [problemResponse(502, "upstream")] }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i);
  });

  it("R3.17 a failed prompt read offers a retry", async () => {
    const { user } = await startPainting("/paint", { [NEXT]: [problemResponse(503, "unavailable"), jsonResponse(200, fixturePaintPrompt)] });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/solver service/i);
    await user.click(within(alert).getByRole("button", { name: /try again/i }));
    expect(await screen.findByTestId("range-painter")).toBeInTheDocument();
  });
});
