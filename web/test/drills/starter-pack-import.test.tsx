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

import { STARTER_PACK, STARTER_TAG, starterIdTag } from "../../src/drills/starter-pack.js";
import { fixtureDrill } from "../../src/fixtures/trainer.js";
import { jsonBody } from "../library/render-library.js";
import { renderDrills } from "./render-drills.js";

const IMPORT_PATH = "/api/v1/drills/import";
const BUTTON = "Add the starter drills";
const EMPTY_LIST = { items: [], next_cursor: null };

describe("R3.35 Add the starter drills", { timeout: 20_000 }, () => {
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

  it("R3.35 a double click sends nothing twice: the second click lands on the write in flight", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const held = new Promise<undefined>((resolve) => {
      release = () => resolve(undefined);
    });
    const { sent } = renderDrills("/drills", {
      override: (request) => (request.method === "POST" && request.path === IMPORT_PATH && sent("POST", IMPORT_PATH).length === 1 ? held : undefined),
    });
    await screen.findByRole("table", { name: "Your drills" });
    // With drills listed and none of them a starter drill, the header is the one place offering the pack.
    await user.dblClick(screen.getByRole("button", { name: BUTTON }));
    await waitFor(() => expect(sent("POST", IMPORT_PATH)).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Adding the starter drills" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByTestId("library-status")).toHaveTextContent(`Added ${STARTER_PACK.length} starter drills.`));
    expect(sent("POST", IMPORT_PATH).map((request) => request.headers["idempotency-key"])).toEqual(STARTER_PACK.map((_, index) => `test-key-1-${index}`));
  });

  it("R3.35 a retry after a network failure reuses the keys, so the api replays the codes that landed", async () => {
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
    await user.click(screen.getByRole("button", { name: BUTTON }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Error:/);
    expect(sent("POST", IMPORT_PATH)).toHaveLength(2);
    failAt = null;
    // The code that landed shows (the reads were invalidated on failure), so the retry sends only the rest.
    await screen.findByRole("button", { name: `Add the ${STARTER_PACK.length - 1} missing starter drills` });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("library-status")).toHaveTextContent(`Added ${STARTER_PACK.length - 1} starter drills.`));
    const keys = sent("POST", IMPORT_PATH).map((request) => request.headers["idempotency-key"]);
    expect(keys.slice(0, 2)).toEqual(["test-key-1-0", "test-key-1-1"]);
    // The code whose answer was lost keeps its key, so a request that did land would be replayed.
    expect(keys[2]).toBe("test-key-1-1");
    expect(sent("POST", IMPORT_PATH).slice(2).map((request) => request.body)).toEqual(STARTER_PACK.slice(1).map((entry) => ({ export_code: entry.code })));
  });

  it("R3.35 the header hides the button once every starter drill is in the library", async () => {
    const all = STARTER_PACK.map((entry, index) => ({ ...fixtureDrill, id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`, name: entry.name, tags: [STARTER_TAG] }));
    renderDrills("/drills", {
      override: (request) =>
        request.method === "GET" && request.path === "/api/v1/drills"
          ? jsonBody(200, { items: all, next_cursor: null })
          : undefined,
    });
    await screen.findByRole("table", { name: "Your drills" });
    expect(screen.queryByRole("button", { name: BUTTON })).not.toBeInTheDocument();
  });

  it("R3.35 the empty state's and the header's buttons share one intent: a click on each while the first import is in flight sends one key set (PR #48 review HIGH 2)", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const held = new Promise<undefined>((resolve) => {
      release = () => resolve(undefined);
    });
    let listed = false;
    const { sent } = renderDrills("/drills", {
      override: (request) => {
        if (!listed && request.method === "GET" && request.path === "/api/v1/drills") return jsonBody(200, EMPTY_LIST);
        return request.method === "POST" && request.path === IMPORT_PATH && sent("POST", IMPORT_PATH).length === 1 ? held : undefined;
      },
    });
    await screen.findByText(/You have no drills yet/);
    const buttons = await screen.findAllByRole("button", { name: BUTTON });
    expect(buttons).toHaveLength(2);
    listed = true;
    await user.click(buttons[0] as HTMLElement);
    await waitFor(() => expect(sent("POST", IMPORT_PATH)).toHaveLength(1));
    // The other button is the same intent: it is busy too and a click sends nothing.
    for (const button of screen.getAllByRole("button", { name: "Adding the starter drills" })) expect(button).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByTestId("library-status")).toHaveTextContent(`Added ${STARTER_PACK.length} starter drills.`));
    expect(sent("POST", IMPORT_PATH).map((request) => request.headers["idempotency-key"])).toEqual(STARTER_PACK.map((_, index) => `test-key-1-${index}`));
  });

  it("R3.35 the header stays hidden when every starter drill is listed under a new name (PR #48 review 4 finding 3)", async () => {
    const renamed = STARTER_PACK.map((entry, index) => ({ ...fixtureDrill, id: `00000000-0000-4000-8000-0000000003${String(index).padStart(2, "0")}`, name: `Renamed ${index}`, tags: [STARTER_TAG, starterIdTag(entry)] }));
    renderDrills("/drills", {
      override: (request) => (request.method === "GET" && request.path === "/api/v1/drills" ? jsonBody(200, { items: renamed, next_cursor: null }) : undefined),
    });
    await screen.findByRole("table", { name: "Your drills" });
    await waitFor(() => expect(screen.getAllByTestId("drill-row")).toHaveLength(STARTER_PACK.length));
    expect(screen.queryByRole("button", { name: /starter drills?$/ })).not.toBeInTheDocument();
  });

  it("R3.35 the header decides from its own read, not the filtered page: starter drills outside the filter still count (PR #48 review HIGH 3)", async () => {
    const all = STARTER_PACK.map((entry, index) => ({ ...fixtureDrill, id: `00000000-0000-4000-8000-0000000002${String(index).padStart(2, "0")}`, name: entry.name, tags: [STARTER_TAG] }));
    const { sent } = renderDrills("/drills?tag=synthetic", {
      override: (request) => (request.method === "GET" && request.path === "/api/v1/drills" && request.query["tag"] === STARTER_TAG ? jsonBody(200, { items: all, next_cursor: null }) : undefined),
    });
    await screen.findByRole("table", { name: "Your drills" });
    await waitFor(() => expect(sent("GET", "/api/v1/drills").some((request) => request.query["tag"] === STARTER_TAG)).toBe(true));
    expect(screen.queryByRole("button", { name: BUTTON })).not.toBeInTheDocument();
  });

  it("R3.35 with no starter drill anywhere the header offers the pack under a tag filter", async () => {
    renderDrills("/drills?tag=synthetic");
    await screen.findByRole("table", { name: "Your drills" });
    expect(await screen.findByRole("button", { name: BUTTON })).toBeInTheDocument();
  });

  it("R3.35 codes 0 to 3 land and 4 fails; after a remount the button offers the remaining six and imports only those (PR #48 review round 2 MEDIUM 3)", async () => {
    const user = userEvent.setup();
    let failAt: number | null = 5;
    let count = 0;
    const view = renderDrills("/drills", {
      override: (request) => {
        if (request.method !== "POST" || request.path !== IMPORT_PATH) return undefined;
        count += 1;
        return count === failAt ? Promise.reject(new TypeError("Failed to fetch")) : undefined;
      },
    });
    await screen.findByRole("table", { name: "Your drills" });
    await user.click(screen.getByRole("button", { name: BUTTON }));
    await screen.findByRole("alert");
    expect(view.sent("POST", IMPORT_PATH)).toHaveLength(5);
    // The four that landed are in the library at once.
    await waitFor(() => expect(screen.getAllByTestId("drill-name").map((cell) => cell.textContent)).toContain(STARTER_PACK[3]?.name));
    failAt = null;
    await view.router.navigate({ to: "/settings/$section", params: { section: "hotkeys" } });
    await view.router.navigate({ to: "/drills" });
    const button = await screen.findByRole("button", { name: "Add the 6 missing starter drills" });
    await user.click(button);
    await waitFor(() => expect(screen.getByTestId("library-status")).toHaveTextContent("Added 6 starter drills."));
    expect(view.sent("POST", IMPORT_PATH).slice(5).map((request) => request.body)).toEqual(STARTER_PACK.slice(4).map((entry) => ({ export_code: entry.code })));
    await waitFor(() => expect(screen.queryByRole("button", { name: /starter drills?$/ })).not.toBeInTheDocument());
  });

  it("R3.35 a starter drill deleted after the pack landed is re-added under a fresh key and created again (PR #48 review round 3 HIGH)", async () => {
    const user = userEvent.setup();
    const view = renderDrills("/drills");
    await screen.findByRole("table", { name: "Your drills" });
    await user.click(screen.getByRole("button", { name: BUTTON }));
    await waitFor(() => expect(screen.getByTestId("library-status")).toHaveTextContent(`Added ${STARTER_PACK.length} starter drills.`));
    const target = STARTER_PACK[2];
    if (target === undefined) throw new Error("the pack has no third drill");
    const firstKey = view.sent("POST", IMPORT_PATH)[2]?.headers["idempotency-key"];
    // Delete one starter drill on the same page.
    await user.click(await screen.findByRole("radio", { name: `Select ${target.name}` }));
    await user.click(screen.getByRole("button", { name: `Delete ${target.name}` }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this drill?" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("radio", { name: `Select ${target.name}` })).not.toBeInTheDocument());
    // Re-add it: a new key, so the api creates it instead of replaying the first answer.
    await user.click(await screen.findByRole("button", { name: "Add the 1 missing starter drill" }));
    await waitFor(() => expect(view.sent("POST", IMPORT_PATH)).toHaveLength(STARTER_PACK.length + 1));
    const reAdd = view.sent("POST", IMPORT_PATH).at(-1);
    expect(reAdd?.body).toEqual({ export_code: target.code });
    expect(reAdd?.headers["idempotency-key"]).not.toBe(firstKey);
    expect(await screen.findByRole("radio", { name: `Select ${target.name}` })).toBeInTheDocument();
    // One drill is named in the singular (PR #48 review round 3 LOW 5).
    expect(screen.getByTestId("library-status")).toHaveTextContent("Added 1 starter drill.");
  });

  /** Fails the first import once with this answer, then lets every import through; returns the keys sent. */
  async function retryAfterFirstAnswer(answer: () => Response): Promise<(string | undefined)[]> {
    const user = userEvent.setup();
    let failed = false;
    const { sent } = renderDrills("/drills", {
      override: (request) => {
        if (failed || request.method !== "POST" || request.path !== IMPORT_PATH) return undefined;
        failed = true;
        return answer();
      },
    });
    await screen.findByRole("table", { name: "Your drills" });
    await user.click(screen.getByRole("button", { name: BUTTON }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("library-status")).toHaveTextContent(`Added ${STARTER_PACK.length} starter drills.`));
    return sent("POST", IMPORT_PATH).map((request) => request.headers["idempotency-key"]);
  }

  it("R3.35 a code the api refused with a 4xx is retried under a fresh key, never the refused one (PR #48 review 4 finding 1)", async () => {
    const refusal = { type: "urn:g-tee-oh:problem:rate-limited", title: "Too many requests", status: 429 };
    const keys = await retryAfterFirstAnswer(() => jsonBody(429, refusal, "application/problem+json"));
    expect(keys[0]).toBe("test-key-1-0");
    expect(keys[1]).not.toBe("test-key-1-0");
    expect(keys.slice(2)).toEqual(STARTER_PACK.slice(1).map((_, index) => `test-key-1-${index + 1}`));
  });

  it("R3.35 a code whose import failed with a 5xx keeps its key, so a request that did land is replayed (PR #48 review 4 finding 1)", async () => {
    const failure = { type: "urn:g-tee-oh:problem:unknown", title: "Unavailable", status: 503 };
    const keys = await retryAfterFirstAnswer(() => jsonBody(503, failure, "application/problem+json"));
    expect(keys.slice(0, 2)).toEqual(["test-key-1-0", "test-key-1-0"]);
  });

  /** The first code's imports answer in turn: a lost answer (the request stalled), then this answer, then a create. */
  async function keysAfterKeyCheck(answer: () => Response): Promise<{ keys: (string | undefined)[]; firstCodeImports: number }> {
    const user = userEvent.setup();
    let firstCodeCalls = 0;
    const first = STARTER_PACK[0];
    if (first === undefined) throw new Error("the pack is empty");
    const { sent } = renderDrills("/drills", {
      override: (request) => {
        if (request.method !== "POST" || request.path !== IMPORT_PATH) return undefined;
        if ((request.body as { export_code?: string } | undefined)?.export_code !== first.code) return undefined;
        firstCodeCalls += 1;
        if (firstCodeCalls === 1) return Promise.reject(new TypeError("Failed to fetch"));
        if (firstCodeCalls === 2) return answer();
        return undefined;
      },
    });
    await screen.findByRole("table", { name: "Your drills" });
    await user.click(screen.getByRole("button", { name: BUTTON }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(sent("POST", IMPORT_PATH)).toHaveLength(2));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("library-status")).toHaveTextContent(`Added ${STARTER_PACK.length} starter drills.`));
    return { keys: sent("POST", IMPORT_PATH).map((request) => request.headers["idempotency-key"]), firstCodeImports: firstCodeCalls };
  }

  it("R3.35 a 409 in-flight answer keeps the code's key: the next retry reuses it and the drill is created once (PR #51 review HIGH 1)", async () => {
    const inFlight = { type: "urn:g-tee-oh:problem:idempotency-in-flight", title: "A request with this Idempotency-Key is still being processed", status: 409 };
    const { keys, firstCodeImports } = await keysAfterKeyCheck(() => jsonBody(409, inFlight, "application/problem+json"));
    expect(firstCodeImports).toBe(3);
    expect(keys.slice(0, 3)).toEqual(["test-key-1-0", "test-key-1-0", "test-key-1-0"]);
    const table = await screen.findByRole("table", { name: "Your drills" });
    expect(within(table).getAllByTestId("drill-name").filter((cell) => cell.textContent === STARTER_PACK[0]?.name)).toHaveLength(1);
  });

  it("R3.35 a 422 key mismatch keeps the code's key too: only a refusal that proves nothing landed mints a new one (PR #51 review HIGH 1)", async () => {
    const mismatch = { type: "urn:g-tee-oh:problem:idempotency-mismatch", title: "Idempotency-Key reused with a different request", status: 422 };
    const { keys } = await keysAfterKeyCheck(() => jsonBody(422, mismatch, "application/problem+json"));
    expect(keys.slice(0, 3)).toEqual(["test-key-1-0", "test-key-1-0", "test-key-1-0"]);
  });
});
