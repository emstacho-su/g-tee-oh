/**
 * Tests for the /paint screen (S27 lane B, S41, R3.17, O-302, O-351, O-415, O-416) through the
 * whole app over an injected fake fetch: pick a table, seat, spot and opener, start a catalog-spot
 * range_paint session from the address, paint, submit the painted map, read the graded view, go
 * Next; an old drill link; and the failures it names without echoing a problem's text. One
 * Idempotency-Key per paint submission (PR #29 review M4): Try again after a failed or lost answer
 * resends the same key so the server replays, while a changed paint or the next range gets a new one.
 */
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { createAppApi } from "../../src/api/index.js";
import { App } from "../../src/app/index.js";
import { createQueryClient } from "../../src/auth/index.js";
import type { RangePaintPrompt } from "../../src/contracts.js";
import {
  FIXTURE_PAINT_DRILL_ID,
  FIXTURE_PAINT_SESSION_ID,
  fixturePaintGraded,
  fixturePaintPrompt,
  fixturePaintSession,
} from "../../src/fixtures/paint.js";
import { createAppRouter } from "../../src/router.js";
import { createFakeFetch, jsonResponse, problemResponse, type FetchScript, type ResponseFactory } from "../api/fake-fetch.js";
import { SIGNED_IN, TEST_ORIGIN, renderApp } from "../app/render-app.js";
import { catalogScript } from "../quiz/render-quiz.js";
import { PAINTER_SUITE } from "./painter-timeout.js";

const CONFIGS = "GET /api/v1/configs";
const SESSIONS = "POST /api/v1/sessions";
const NEXT = `GET /api/v1/range-paint/${FIXTURE_PAINT_SESSION_ID}/next`;
const SUBMIT = "POST /api/v1/range-paint/submit";
const SECOND_PROMPT: RangePaintPrompt = { ...fixturePaintPrompt, state_version: 1, prompt_no: 1 };
const GOAL =
  "Paint the action you take with every hand from this seat. The grade is the expected value (EV) your whole range gives up, each hand weighted by how often it reaches this spot.";

function script(overrides: Record<string, readonly ResponseFactory[]> = {}): FetchScript {
  return {
    ...SIGNED_IN,
    ...catalogScript(),
    [SESSIONS]: [jsonResponse(201, fixturePaintSession)],
    [NEXT]: [jsonResponse(200, fixturePaintPrompt), jsonResponse(200, SECOND_PROMPT)],
    [SUBMIT]: [jsonResponse(200, fixturePaintGraded)],
    ...overrides,
  };
}

type User = ReturnType<typeof userEvent.setup>;

/** Picks BB facing an open on the first table in the spot picker and starts painting. */
async function pickAndStart(user: User): Promise<void> {
  const position = await screen.findByRole("radiogroup", { name: "Position" });
  await user.click(await within(position).findByRole("radio", { name: "BB" }));
  await user.click(within(screen.getByRole("radiogroup", { name: "Spot" })).getByRole("radio", { name: "Facing an open" }));
  await user.click(screen.getByRole("button", { name: /start painting/i }));
}

async function startPainting(path = "/paint", overrides: Record<string, readonly ResponseFactory[]> = {}) {
  const user = userEvent.setup();
  const app = renderApp(path, script(overrides));
  await pickAndStart(user);
  return { app, user };
}

/** Renders the app like renderApp and records the Idempotency-Key of every submit (PR #29 review M4). */
function renderRecordingSubmitKeys(path: string, script: FetchScript) {
  const fake = createFakeFetch(script);
  const submitKeys: (string | null)[] = [];
  const fetch = (request: Request): Promise<Response> => {
    if (`${request.method} ${new URL(request.url).pathname}` === SUBMIT) submitKeys.push(request.headers.get("idempotency-key"));
    return fake.fetch(request);
  };
  const api = createAppApi({ baseUrl: TEST_ORIGIN, fetch });
  const queryClient = createQueryClient();
  const router = createAppRouter({ queryClient, api, history: createMemoryHistory({ initialEntries: [path] }) });
  render(<App router={router} queryClient={queryClient} api={api} />);
  return { fake, submitKeys };
}

async function startPaintingRecordingKeys(overrides: Record<string, readonly ResponseFactory[]>) {
  const user = userEvent.setup();
  const app = renderRecordingSubmitKeys("/paint", script(overrides));
  await pickAndStart(user);
  return { app, user };
}

function bodyOf(app: { fake: ReturnType<typeof createFakeFetch> }, key: string): unknown {
  const call = app.fake.calls.find((candidate) => `${candidate.method} ${candidate.path}` === key);
  return call === undefined ? undefined : JSON.parse(call.body);
}

describe("R3.17 /paint", PAINTER_SUITE, () => {
  it("R3.17 picks a seat and a spot, starts a catalog-spot range_paint session, submits the painted map and shows the grade, then Next", async () => {
    const { app, user } = await startPainting();
    expect(await screen.findByTestId("range-painter")).toBeInTheDocument();
    expect(bodyOf(app, SESSIONS)).toEqual({
      mode: "range_paint",
      catalog_spot: { config_id: "cfg_6_online_100", hero_positions: ["BB"], spot_types: ["vs_open"] },
    });
    expect(app.router.state.location.search).toEqual({ config: "cfg_6_online_100", position: "BB", spot: "vs_open" });
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

  it("R3.17 the picker states the goal and offers only covered seats, the five spots and an optional opponent", async () => {
    const user = userEvent.setup();
    const app = renderApp("/paint", script());
    expect(await screen.findByText(GOAL)).toBeInTheDocument();
    const table = await screen.findByRole("combobox", { name: "Table" });
    await waitFor(() => expect(table).toHaveValue("cfg_6_online_100"));
    const position = screen.getByRole("radiogroup", { name: "Position" });
    await waitFor(() => expect(within(position).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["BTN", "SB", "BB"]));
    expect(within(screen.getByRole("radiogroup", { name: "Spot" })).getAllByRole("radio").map((radio) => radio.textContent)).toEqual([
      "Open",
      "Facing an open",
      "Facing a 3-bet",
      "Squeeze",
      "Facing a 4-bet",
    ]);
    const opponent = screen.getByRole("radiogroup", { name: "Opponent" });
    expect(within(opponent).getByRole("radio", { name: "Any" })).toHaveAttribute("aria-checked", "true");
    await user.click(within(position).getByRole("radio", { name: "BB" }));
    await user.click(within(screen.getByRole("radiogroup", { name: "Spot" })).getByRole("radio", { name: "Facing an open" }));
    const opener = screen.getByRole("radiogroup", { name: "Opener" });
    expect(within(opener).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Any", "BTN"]);
    expect(app.fake.keys()).not.toContain(SESSIONS);
  });

  it("R3.17 a chosen opener goes into the address and the start as the villain seat", async () => {
    const user = userEvent.setup();
    const app = renderApp("/paint", script());
    const position = await screen.findByRole("radiogroup", { name: "Position" });
    await user.click(await within(position).findByRole("radio", { name: "BB" }));
    await user.click(within(screen.getByRole("radiogroup", { name: "Spot" })).getByRole("radio", { name: "Facing an open" }));
    await user.click(within(screen.getByRole("radiogroup", { name: "Opener" })).getByRole("radio", { name: "BTN" }));
    await user.click(screen.getByRole("button", { name: /start painting/i }));
    expect(await screen.findByTestId("range-painter")).toBeInTheDocument();
    expect(app.router.state.location.search).toEqual({ config: "cfg_6_online_100", position: "BB", spot: "vs_open", vs: "BTN" });
    expect(bodyOf(app, SESSIONS)).toMatchObject({ catalog_spot: { villain_positions: ["BTN"] } });
  });

  it("R3.17 an address with a full valid choice starts directly, with its seed", async () => {
    const app = renderApp("/paint?config=cfg_6_online_100&position=BB&spot=vs_open&vs=BTN&seed=00000000deadbeef", script());
    expect(await screen.findByTestId("range-painter")).toBeInTheDocument();
    expect(bodyOf(app, SESSIONS)).toEqual({
      mode: "range_paint",
      catalog_spot: { config_id: "cfg_6_online_100", hero_positions: ["BB"], villain_positions: ["BTN"], spot_types: ["vs_open"] },
      seed: "00000000deadbeef",
    });
  });

  it("R3.17 while the start runs a status says so, and a failed start's Try again is a new attempt with a new Idempotency-Key", async () => {
    const keys: (string | null)[] = [];
    const fake = createFakeFetch(script({ [SESSIONS]: [problemResponse(503, "unavailable"), jsonResponse(201, fixturePaintSession)] }));
    const fetch = (request: Request): Promise<Response> => {
      if (`${request.method} ${new URL(request.url).pathname}` === SESSIONS) keys.push(request.headers.get("idempotency-key"));
      return fake.fetch(request);
    };
    const api = createAppApi({ baseUrl: TEST_ORIGIN, fetch });
    const queryClient = createQueryClient();
    const router = createAppRouter({ queryClient, api, history: createMemoryHistory({ initialEntries: ["/paint?config=cfg_6_online_100&position=BB&spot=vs_open"] }) });
    render(<App router={router} queryClient={queryClient} api={api} />);
    expect(await screen.findByRole("status")).toHaveTextContent(/starting/i);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/solver service/i);
    await userEvent.click(within(alert).getByRole("button", { name: /try again/i }));
    expect(await screen.findByTestId("range-painter")).toBeInTheDocument();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("R3.17 an old drill link still starts a drill-backed session", async () => {
    const app = renderApp(`/paint?drill=${FIXTURE_PAINT_DRILL_ID}`, script());
    expect(await screen.findByTestId("range-painter")).toBeInTheDocument();
    expect(bodyOf(app, SESSIONS)).toEqual({ mode: "range_paint", drill_id: FIXTURE_PAINT_DRILL_ID });
  });

  it("R3.17 a table with no covered seat says so and offers no start", async () => {
    renderApp(
      "/paint?config=cfg_6_online_100",
      script({ "GET /api/v1/configs/cfg_6_online_100/pairs": [jsonResponse(200, { config_id: "cfg_6_online_100", items: [], next_cursor: null })] }),
    );
    expect(await screen.findByText("No seat at this table has a solved spot yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start painting/i })).toBeDisabled();
  });

  it("R3.17 a spot the library cannot cover is named without the problem's text", async () => {
    await startPainting("/paint", { [SESSIONS]: [problemResponse(422, "no-coverage")] });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The library has no solved spot for this seat and spot yet. It was queued for the builder.");
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

  it("R3.17 a failed submit keeps the paint and Try again resends it under the same Idempotency-Key (PR #29 review M4)", async () => {
    const { app, user } = await startPaintingRecordingKeys({ [SUBMIT]: [problemResponse(502, "upstream"), jsonResponse(200, fixturePaintGraded)] });
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
    expect(app.submitKeys).toHaveLength(2);
    expect(app.submitKeys[0]).toBeTruthy();
    expect(app.submitKeys[1]).toBe(app.submitKeys[0]);
  });

  it("R3.17 a changed paint after a failed submit and the next range each get a new Idempotency-Key (PR #29 review M4)", async () => {
    const { app, user } = await startPaintingRecordingKeys({
      [SUBMIT]: [problemResponse(502, "upstream"), jsonResponse(200, fixturePaintGraded), jsonResponse(200, { ...fixturePaintGraded, state_version: 2 })],
    });
    await user.keyboard("2");
    await user.click(await screen.findByRole("button", { name: /^AA: / }));
    await user.click(screen.getByRole("button", { name: /submit range/i }));
    await screen.findByRole("alert");
    await user.keyboard("3");
    await user.click(screen.getByRole("button", { name: /^AA: / }));
    await user.click(screen.getByRole("button", { name: /submit range/i }));
    await user.click(await screen.findByRole("button", { name: /next range/i }));
    expect(await screen.findByText(/range 2/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /submit range/i }));
    await waitFor(() => expect(app.submitKeys).toHaveLength(3));
    expect(new Set(app.submitKeys).size).toBe(3);
  });

  it("R3.17 a first-to-act spot with real data shows no history and no synthetic banner", async () => {
    const opening: RangePaintPrompt = { ...fixturePaintPrompt, history: [], hero_position: "BTN", synthetic: false };
    await startPainting("/paint", { [NEXT]: [jsonResponse(200, opening)] });
    expect(await screen.findByText(/first to act/i)).toBeInTheDocument();
    expect(screen.queryByTestId("synthetic-banner")).toBeNull();
  });

  it("R3.17 a failed table list says so", async () => {
    renderApp("/paint", script({ [CONFIGS]: [problemResponse(502, "upstream")] }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The tables could not be loaded. Reload the page to try again.");
  });

  it("R3.17 a failed prompt read offers a retry", async () => {
    const { user } = await startPainting("/paint", { [NEXT]: [problemResponse(503, "unavailable"), jsonResponse(200, fixturePaintPrompt)] });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/solver service/i);
    await user.click(within(alert).getByRole("button", { name: /try again/i }));
    expect(await screen.findByTestId("range-painter")).toBeInTheDocument();
  });
});
