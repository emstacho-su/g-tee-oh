/**
 * Adding the starter drills from the library screen (S47, R3.35, O-481, O-232): one click imports
 * every bundled code through POST /drills/import under one base Idempotency-Key per click and one
 * derived key per code, so a double click sends nothing twice and a retry after a failure reuses
 * the keys; the button sits in the empty state and in the header, and the header hides it once a
 * starter drill is listed.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { STARTER_PACK, STARTER_TAG } from "../../src/drills/starter-pack.js";
import { fixtureDrill } from "../../src/fixtures/trainer.js";
import { jsonBody } from "../library/render-library.js";
import { renderDrills } from "./render-drills.js";

const IMPORT_PATH = "/api/v1/drills/import";
const BUTTON = "Add the starter drills";
const EMPTY_LIST = { items: [], next_cursor: null };

describe("R3.35 Add the starter drills", () => {
  it("R3.35 imports every code under one base key per click and one derived key per code", async () => {
    const user = userEvent.setup();
    let listed = false;
    const { sent } = renderDrills("/drills", {
      override: (request) => (!listed && request.method === "GET" && request.path === "/api/v1/drills" ? jsonBody(200, EMPTY_LIST) : undefined),
    });
    const empty = await screen.findByText(/You have no drills yet/);
    listed = true;
    await user.click(within(empty.parentElement as HTMLElement).getByRole("button", { name: BUTTON }));
    await waitFor(() => expect(screen.getByTestId("library-status")).toHaveTextContent(`Added ${STARTER_PACK.length} starter drills.`));
    const imports = sent("POST", IMPORT_PATH);
    expect(imports.map((request) => request.body)).toEqual(STARTER_PACK.map((entry) => ({ export_code: entry.code })));
    expect(imports.map((request) => request.headers["idempotency-key"])).toEqual(STARTER_PACK.map((_, index) => `test-key-1-${index}`));
    const table = await screen.findByRole("table", { name: "Your drills" });
    expect(within(table).getAllByTestId("drill-row").length).toBeGreaterThanOrEqual(STARTER_PACK.length);
    // The header no longer offers the pack once a starter drill is listed.
    expect(screen.queryByRole("button", { name: BUTTON })).not.toBeInTheDocument();
  });

  it("R3.35 a double click sends nothing twice and a retry after a network failure reuses the keys", async () => {
    const user = userEvent.setup();
    let failAt: number | null = 2;
    let count = 0;
    const { sent } = renderDrills("/drills", {
      override: (request) => {
        if (request.method !== "POST" || request.path !== IMPORT_PATH) return undefined;
        count += 1;
        return count === failAt ? Promise.reject(new TypeError("Failed to fetch")) : undefined;
      },
    });
    await screen.findByRole("table", { name: "Your drills" });
    const header = screen.getByRole("banner");
    const button = within(header).getByRole("button", { name: BUTTON });
    await user.dblClick(button);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Error:/);
    expect(sent("POST", IMPORT_PATH)).toHaveLength(2);
    failAt = null;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("library-status")).toHaveTextContent(`Added ${STARTER_PACK.length} starter drills.`));
    const keys = sent("POST", IMPORT_PATH).map((request) => request.headers["idempotency-key"]);
    // The first code was imported before the failure; its retry carries the same key, so the api replays it.
    expect(keys.slice(0, 2)).toEqual(["test-key-1-0", "test-key-1-1"]);
    expect(keys.slice(2)).toEqual(STARTER_PACK.map((_, index) => `test-key-1-${index}`));
  });

  it("R3.35 the header hides the button once a starter drill is listed", async () => {
    renderDrills("/drills", {
      override: (request) =>
        request.method === "GET" && request.path === "/api/v1/drills"
          ? jsonBody(200, { items: [{ ...fixtureDrill, tags: [STARTER_TAG, "rfi"] }], next_cursor: null })
          : undefined,
    });
    await screen.findByRole("table", { name: "Your drills" });
    expect(screen.queryByRole("button", { name: BUTTON })).not.toBeInTheDocument();
  });
});
