/**
 * Every control of the builder's seats and board sections reaches the DrillCreate body (S26,
 * R3.14, O-317): start street, villain positions, preflop action families, the line, alternate
 * seats, and each board filter with an explicit flop list. Fields v1 does not serve (a postflop
 * start street, the board) stay editable and carry their v1 notes, so the drill round-trips. Since
 * S40 (O-405) the sections are pages of one builder and one draft spans them.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { V1_NOTES } from "../../src/drills/labels.js";
import { openSection, renderDrills } from "./render-drills.js";

/** A large form walked control by control; the named budget keeps it clear of the 5 s default under load. */
const SECTIONS_TEST_TIMEOUT_MS = 20_000;

function group(name: string): HTMLElement {
  return screen.getByRole("group", { name });
}

describe("R3.14 builder seats and board sections", { timeout: SECTIONS_TEST_TIMEOUT_MS }, () => {
  it("R3.14 seats, action, line, alternate seats and every board filter reach the POST body", async () => {
    const { sent, router } = renderDrills("/drills/new");
    const user = userEvent.setup();
    await screen.findByRole("heading", { level: 1, name: "New drill" });

    await user.click(screen.getByLabelText("Name"));
    await user.paste("CO against the blinds, flop filters");
    await openSection(user, "Seats");
    await user.selectOptions(screen.getByLabelText("Start street"), "flop");
    expect(screen.getByText(`Note: ${V1_NOTES.street}`)).toBeInTheDocument();
    await user.click(within(group("Hero positions")).getByRole("checkbox", { name: "CO" }));
    await user.click(within(group("Villain positions")).getByRole("checkbox", { name: "SB" }));
    await user.click(within(group("Villain positions")).getByRole("checkbox", { name: "BB" }));
    await user.click(within(group("Preflop action")).getByRole("checkbox", { name: "RFI (raise first in)" }));
    await user.click(within(group("Preflop action")).getByRole("checkbox", { name: "Single-raised pot" }));
    await user.click(screen.getByLabelText("Line (optional)"));
    await user.paste("r250.c");
    await user.click(screen.getByRole("checkbox", { name: /Alternate seats/ }));

    await openSection(user, "Board");
    expect(screen.getByText(`Note: ${V1_NOTES.board}`)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("High card"), "K");
    await user.selectOptions(screen.getByLabelText("Paired board"), "no");
    await user.selectOptions(screen.getByLabelText("Suits"), "rainbow");
    await user.selectOptions(screen.getByLabelText("Connectivity"), "disconnected");
    await user.click(screen.getByLabelText("Flops (optional)"));
    await user.paste("Kh8d3c");

    await user.click(screen.getByRole("button", { name: "Save drill" }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/drills\/[0-9a-f-]{36}\/board$/));
    const body = sent("POST", "/api/v1/drills")[0]?.body as { spot_filter: Record<string, unknown> };
    expect(body.spot_filter).toMatchObject({
      start_street: "flop",
      hero_positions: ["CO"],
      villain_positions: ["SB", "BB"],
      preflop_action: ["srp"],
      line: "r250.c",
      alternate_seats: true,
      board: { high_card: "K", paired: false, suits: "rainbow", connectivity: "disconnected", flops: ["Kh8d3c"] },
    });
  });
});
