/**
 * The drill builder (S26, R3.14, O-311, O-317) over the mocked drill routes: creating a drill from
 * scratch (flow 2's RFI boundary hands), editing a stored drill as a patch of the changed fields,
 * client validation before any request, the api's 400 field errors next to their fields, the hand
 * picker by mouse and keyboard, the stake choices by format, and the v1 notes.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DEFAULT_TRAINER } from "../../src/drills/draft.js";
import { V1_NOTES } from "../../src/drills/labels.js";
import { nextCellIndex } from "../../src/routes/drills/HandPicker.js";
import { FIXTURE_DRILL_ID, fixtureDrill } from "../../src/fixtures/trainer.js";
import { jsonBody } from "../library/render-library.js";
import { renderDrills } from "./render-drills.js";

async function openNew(): Promise<UserEvent> {
  const user = userEvent.setup();
  await screen.findByRole("heading", { level: 1, name: "New drill" });
  return user;
}

function group(name: string): HTMLElement {
  return screen.getByRole("group", { name });
}

async function fillRfiDrill(user: UserEvent): Promise<void> {
  await user.click(screen.getByLabelText("Name"));
  await user.paste("RFI boundary hands");
  await user.click(within(group("Hero positions")).getByRole("checkbox", { name: "BTN" }));
  await user.click(within(group("Hands to train")).getByRole("radio", { name: /Close decisions/ }));
}

/** The builder is a large form and each test walks many controls; under the whole parallel suite
 * one test can pass the default 5 seconds, so these tests get a longer, named budget. */
const BUILDER_TEST_TIMEOUT_MS = 20_000;

describe("R3.14 drill builder", { timeout: BUILDER_TEST_TIMEOUT_MS }, () => {
  it("R3.14 builds RFI boundary hands from scratch, POSTs the DrillCreate body and opens the saved drill", async () => {
    const { sent, router } = renderDrills("/drills/new");
    const user = await openNew();
    await fillRfiDrill(user);
    await user.click(screen.getByRole("button", { name: "Save drill" }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/drills\/[0-9a-f-]{36}$/));
    expect(sent("POST", "/api/v1/drills")[0]?.body).toEqual({
      name: "RFI boundary hands",
      tags: [],
      spot_filter: {
        game_config: { format: "online", table_size: 6, depths_bb: [100] },
        stake: "online",
        sizing: { mode: "convention" },
        start_street: "preflop",
        hero_positions: ["BTN"],
        villain_positions: [],
        preflop_action: ["rfi"],
        hands: { mode: "close_decisions" },
        alternate_seats: false,
      },
      trainer: DEFAULT_TRAINER,
    });
    expect(sent("POST", "/api/v1/drills")[0]?.headers["idempotency-key"]).toBe("test-key-1");
    expect(await screen.findByRole("heading", { level: 1, name: "Edit drill" })).toBeInTheDocument();
    expect(await screen.findByTestId("builder-status")).toHaveTextContent("Drill saved.");
    expect(screen.getByTestId("spot-summary")).toHaveTextContent("hero BTN against any opponent; RFI; close decisions");
    expect(screen.getByRole("link", { name: "Run" })).toHaveAttribute("href", expect.stringMatching(/\/run$/));
  });

  it("R3.14 client validation marks every bad field and sends nothing", async () => {
    const { sent } = renderDrills("/drills/new");
    const user = await openNew();
    await user.clear(screen.getByLabelText("Depths (bb)"));
    await user.type(screen.getByLabelText("Depths (bb)"), "100, abc");
    await user.click(screen.getByRole("button", { name: "Save drill" }));
    expect(screen.getByTestId("form-alert")).toHaveTextContent("Error: Fix the fields marked below.");
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("Error: Give the drill a name.");
    expect(screen.getByLabelText("Depths (bb)")).toHaveAttribute("aria-invalid", "true");
    expect(group("Hero positions")).toHaveAccessibleDescription("Error: Choose at least one hero position.");
    expect(sent("POST", "/api/v1/drills")).toHaveLength(0);
    await user.type(screen.getByLabelText("Name"), "Fixed");
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("R3.14 the api's 400 field errors show next to the field they name", async () => {
    const problem = {
      type: "urn:g-tee-oh:problem:validation",
      title: "Request validation failed",
      status: 400,
      errors: [
        { path: "body.spot_filter.stake", message: "the server refuses this stake" },
        { path: "body.extra", message: "unrecognized key" },
      ],
    };
    renderDrills("/drills/new", {
      override: (request) => (request.method === "POST" && request.path === "/api/v1/drills" ? jsonBody(400, problem, "application/problem+json") : undefined),
    });
    const user = await openNew();
    await fillRfiDrill(user);
    await user.click(screen.getByRole("button", { name: "Save drill" }));
    expect(await screen.findByLabelText("Stake")).toHaveAccessibleDescription("Error: the server refuses this stake");
    expect(screen.getByTestId("form-alert")).toHaveTextContent("unrecognized key");
    await user.type(screen.getByLabelText("Name"), " again");
    expect(screen.queryByTestId("form-alert")).not.toBeInTheDocument();
  });

  it("R3.14 a failure without field errors shows its sentence", async () => {
    renderDrills("/drills/new", {
      override: (request) =>
        request.method === "POST" ? jsonBody(403, { type: "urn:g-tee-oh:problem:forbidden-origin", title: "x", status: 403 }, "application/problem+json") : undefined,
    });
    const user = await openNew();
    await fillRfiDrill(user);
    await user.click(screen.getByRole("button", { name: "Save drill" }));
    expect(await screen.findByTestId("form-alert")).toHaveTextContent("The session check failed.");
  });

  it("R3.14 editing a stored drill shows its values and PATCHes only what changed", async () => {
    const { sent } = renderDrills(`/drills/${FIXTURE_DRILL_ID}`);
    const user = userEvent.setup();
    await screen.findByRole("heading", { level: 1, name: "Edit drill" });
    const name = await screen.findByLabelText("Name");
    expect(name).toHaveValue(fixtureDrill.name);
    expect(within(group("Hero positions")).getByRole("checkbox", { name: "BTN" })).toBeChecked();
    expect(screen.getByLabelText("Tags")).toHaveValue("synthetic");
    await user.click(screen.getByRole("button", { name: "Save drill" }));
    expect(screen.getByTestId("builder-status")).toHaveTextContent("Nothing changed, so nothing was saved.");
    await user.clear(name);
    await user.click(name);
    await user.paste("Renamed drill");
    await user.click(within(group("Panels shown after a decision")).getByRole("checkbox", { name: "Streak counter" }));
    await user.click(screen.getByRole("button", { name: "Save drill" }));
    await waitFor(() => expect(screen.getByTestId("builder-status")).toHaveTextContent("Changes saved."));
    const patch = sent("PATCH", `/api/v1/drills/${FIXTURE_DRILL_ID}`)[0]?.body;
    expect(patch).toEqual({ name: "Renamed drill", trainer: { ...fixtureDrill.trainer, panels: { ...fixtureDrill.trainer.panels, streak_counter: true } } });
  });

  it("R3.14 a missing drill says so with a way back", async () => {
    renderDrills("/drills/00000000-0000-4000-8000-0000000000ff");
    expect(await screen.findByRole("alert")).toHaveTextContent("This drill no longer exists.");
    expect(screen.getAllByRole("link", { name: "Back to the drill library" }).length).toBeGreaterThan(0);
  });

  it("R3.14 the hand picker toggles hands by click and keyboard and sends the manual list", async () => {
    const { sent } = renderDrills("/drills/new");
    const user = await openNew();
    await fillRfiDrill(user);
    await user.click(within(group("Hands to train")).getByRole("radio", { name: "Manual list" }));
    const picker = group("Hand picker");
    expect(within(picker).getAllByRole("button")).toHaveLength(169);
    await user.click(within(picker).getByRole("button", { name: "AKs" }));
    expect(within(picker).getByRole("button", { name: "AKs" })).toHaveAttribute("aria-pressed", "true");
    within(picker).getByRole("button", { name: "AA" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(within(picker).getByRole("button", { name: "AKo" })).toHaveFocus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowRight}{End}{Enter}");
    expect(within(picker).getByRole("button", { name: "K2o" })).toHaveAttribute("aria-pressed", "false");
    expect(within(picker).getByRole("button", { name: "K2s" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("hand-count")).toHaveTextContent("3 of 169 hands chosen");
    await user.click(screen.getByRole("button", { name: "Save drill" }));
    await waitFor(() => expect(sent("POST", "/api/v1/drills")).toHaveLength(1));
    expect((sent("POST", "/api/v1/drills")[0]?.body as { spot_filter: { hands: unknown } }).spot_filter.hands).toEqual({
      mode: "manual",
      hands: ["AKs", "AKo", "K2s"],
    });
  });

  it("R3.14 an empty manual list is refused, and Choose all and Clear set every hand", async () => {
    renderDrills("/drills/new");
    const user = await openNew();
    await fillRfiDrill(user);
    await user.click(within(group("Hands to train")).getByRole("radio", { name: "Manual list" }));
    await user.click(screen.getByRole("button", { name: "Save drill" }));
    expect(group("Hand picker")).toHaveAccessibleDescription("Error: Pick 1 to 169 hands.");
    await user.click(screen.getByRole("button", { name: "Choose all" }));
    expect(screen.getByTestId("hand-count")).toHaveTextContent("169 of 169");
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByTestId("hand-count")).toHaveTextContent("0 of 169");
  });

  it("R3.14 nextCellIndex moves within the 13 by 13 grid and stops at its edges", () => {
    expect(nextCellIndex(0, "ArrowLeft")).toBe(0);
    expect(nextCellIndex(0, "ArrowUp")).toBe(0);
    expect(nextCellIndex(0, "ArrowRight")).toBe(1);
    expect(nextCellIndex(0, "ArrowDown")).toBe(13);
    expect(nextCellIndex(14, "Home")).toBe(13);
    expect(nextCellIndex(14, "End")).toBe(25);
    expect(nextCellIndex(168, "ArrowDown")).toBe(168);
    expect(nextCellIndex(5, "a")).toBeUndefined();
  });

  it("R3.14 the stake choices follow the format, and the seats follow the table size", async () => {
    renderDrills("/drills/new");
    const user = await openNew();
    await user.click(within(group("Format")).getByRole("radio", { name: "Live" }));
    const stake = screen.getByLabelText("Stake");
    await waitFor(() => expect(within(stake).getAllByRole("option").map((option) => option.textContent)).toEqual(["Choose a stake", "1/3", "2/5"]));
    await user.selectOptions(stake, "2/5");
    expect(stake).toHaveValue("2/5");
    expect(within(group("Hero positions")).queryByRole("checkbox", { name: "LJ" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Table size"), "9");
    expect(within(group("Hero positions")).getByRole("checkbox", { name: "LJ" })).toBeInTheDocument();
    await user.click(within(group("Hero positions")).getByRole("checkbox", { name: "CO" }));
    expect(within(group("Villain positions")).queryByRole("checkbox", { name: "CO" })).not.toBeInTheDocument();
  });

  it("R3.14 O-317 fields v1 does not serve stay editable with a note", async () => {
    const { sent } = renderDrills("/drills/new");
    const user = await openNew();
    expect(screen.getByText(`Note: ${V1_NOTES.board}`)).toBeInTheDocument();
    expect(screen.queryByText(`Note: ${V1_NOTES.street}`)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Start street"), "flop");
    expect(screen.getByText(`Note: ${V1_NOTES.street}`)).toBeInTheDocument();
    await user.click(within(group("Input")).getByRole("radio", { name: "Frequencies" }));
    expect(screen.getByText(`Note: ${V1_NOTES.input}`)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Tables"), "2");
    expect(screen.getByText(`Note: ${V1_NOTES.tables}`)).toBeInTheDocument();
    await user.click(within(group("Stop rule")).getByRole("radio", { name: /Full hand/ }));
    await user.selectOptions(screen.getByLabelText("Timebank"), "15");
    await user.selectOptions(screen.getByLabelText("High card"), "K");
    await user.type(screen.getByLabelText("Flops (optional)"), "Kh8d3c");
    await user.click(within(group("Sizing")).getByRole("radio", { name: "Fixed sizes" }));
    await user.type(screen.getByLabelText("Open size (bb)"), "2.5");
    await fillRfiDrill(user);
    await user.click(screen.getByRole("button", { name: "Save drill" }));
    await waitFor(() => expect(sent("POST", "/api/v1/drills")).toHaveLength(1));
    const body = sent("POST", "/api/v1/drills")[0]?.body as { spot_filter: Record<string, unknown>; trainer: Record<string, unknown> };
    expect(body.spot_filter).toMatchObject({ start_street: "flop", board: { high_card: "K", flops: ["Kh8d3c"] }, sizing: { mode: "fixed", open_bb: 2.5 } });
    expect(body.trainer).toMatchObject({ input: "frequency", tables: 2, stop_rule: "end_of_hand", timebank_s: 15 });
  });

  it("R3.14 O-311 the builder of a stored drill offers Run, Export and Duplicate", async () => {
    const user = userEvent.setup();
    const { sent } = renderDrills(`/drills/${FIXTURE_DRILL_ID}`);
    await screen.findByLabelText("Name");
    expect(screen.getByRole("link", { name: "Run" })).toHaveAttribute("href", `/drills/${FIXTURE_DRILL_ID}/run`);
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(await screen.findByText(`Duplicated as ${fixtureDrill.name} (copy).`)).toBeInTheDocument();
    expect(sent("POST", "/api/v1/drills")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Export" }));
    const code = await within(screen.getByRole("dialog")).findByLabelText<HTMLTextAreaElement>("Export code");
    expect(code.value).toMatch(/^gteeoh1\./);
  });
});
