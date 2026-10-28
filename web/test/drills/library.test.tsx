/**
 * The drill library screen (S26, R3.14, O-310, O-311) over the mocked drill routes: the list with
 * its spot summaries and tags, the tag filter, duplicate, delete with the 409 in-use message, the
 * export dialog with Copy, the import dialog's success and refusal, the empty state, and an export
 * then import round trip through the UI.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { encodeMockExportCode, SEEDED_DRILLS } from "../../e2e/support/mock-drills.js";
import { spotSummary } from "../../src/drills/summary.js";
import { FIXTURE_DRILL_ID, fixtureDrill } from "../../src/fixtures/trainer.js";
import { jsonBody } from "../library/render-library.js";
import { renderDrills } from "./render-drills.js";

const UNCOVERED_NAME = "A drill the library does not cover";
const SEEDED = SEEDED_DRILLS.length;

async function rows(): Promise<HTMLElement[]> {
  const list = await screen.findByRole("list", { name: "Drills" });
  return within(list).getAllByTestId("drill-row");
}

function rowOf(name: string): HTMLElement {
  return screen.getByRole("article", { name });
}


describe("R3.14 drill library", () => {
  it("R3.14 lists the drills newest first with their spot summary, stop rule, tags and actions", async () => {
    renderDrills("/drills");
    expect(await screen.findByRole("heading", { level: 1, name: "Drill library" })).toBeInTheDocument();
    expect((await rows()).map((row) => within(row).getByRole("heading").textContent)).toEqual([...SEEDED_DRILLS].reverse().map((drill) => drill.name));
    const row = rowOf(fixtureDrill.name);
    expect(within(row).getByTestId("spot-summary")).toHaveTextContent(spotSummary(fixtureDrill.spot_filter));
    expect(within(row).getByText("Stop rule: Spot")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: `Run ${fixtureDrill.name}` })).toHaveAttribute("href", `/drills/${FIXTURE_DRILL_ID}/run`);
    expect(within(row).getByRole("link", { name: `Edit ${fixtureDrill.name}` })).toHaveAttribute("href", `/drills/${FIXTURE_DRILL_ID}`);
    expect(within(row).getByRole("link", { name: "Show drills tagged synthetic" })).toHaveAttribute("href", "/drills?tag=synthetic");
  });

  it("R3.14 the tag filter writes ?tag=, sends it to GET /drills, and a bad tag is refused in words", async () => {
    const user = userEvent.setup();
    const { router, sent } = renderDrills("/drills");
    await rows();
    const filter = screen.getByRole("search", { name: "Filter drills by tag" });
    await user.type(within(filter).getByLabelText("Tag"), "Not A Tag");
    await user.click(within(filter).getByRole("button", { name: "Filter" }));
    expect(screen.getByText(/Error: A tag is lower-case letters/)).toBeInTheDocument();
    await user.clear(within(filter).getByLabelText("Tag"));
    await user.type(within(filter).getByLabelText("Tag"), "uncovered");
    await user.click(within(filter).getByRole("button", { name: "Filter" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tag: "uncovered" }));
    await waitFor(async () => expect(await rows()).toHaveLength(1));
    expect(sent("GET", "/api/v1/drills").at(-1)?.query).toMatchObject({ tag: "uncovered" });
    expect(screen.getByTestId("tag-filter-note")).toHaveTextContent("Showing drills tagged uncovered.");
  });

  it("R3.14 an invalid ?tag= in the URL is dropped before it reaches the api", async () => {
    const { sent } = renderDrills("/drills?tag=Bad%20Tag");
    await rows();
    expect(sent("GET", "/api/v1/drills")[0]?.query["tag"]).toBeUndefined();
  });

  it("R3.14 O-311 Duplicate creates '<name> (copy)' with the same filter, under one Idempotency-Key per click", async () => {
    const user = userEvent.setup();
    const { sent } = renderDrills("/drills");
    await rows();
    await user.click(screen.getByRole("button", { name: `Duplicate ${fixtureDrill.name}` }));
    await waitFor(() => expect(screen.getByTestId("library-status")).toHaveTextContent(`Duplicated as ${fixtureDrill.name} (copy).`));
    const posts = sent("POST", "/api/v1/drills");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ name: `${fixtureDrill.name} (copy)`, tags: fixtureDrill.tags, spot_filter: fixtureDrill.spot_filter, trainer: fixtureDrill.trainer });
    expect(posts[0]?.headers["idempotency-key"]).toBe("test-key-1");
    await waitFor(async () => expect(await rows()).toHaveLength(SEEDED + 1));
    await user.click(screen.getByRole("button", { name: `Duplicate ${fixtureDrill.name}` }));
    await waitFor(() => expect(sent("POST", "/api/v1/drills")).toHaveLength(2));
    expect(sent("POST", "/api/v1/drills")[1]?.headers["idempotency-key"]).toBe("test-key-2");
  });

  it("R3.14 Delete asks first; a drill a session uses shows the 409 in-use message, another is removed", async () => {
    const user = userEvent.setup();
    const { sent } = renderDrills("/drills");
    await rows();
    await user.click(screen.getByRole("button", { name: `Delete ${fixtureDrill.name}` }));
    const confirm = screen.getByRole("dialog", { name: "Delete this drill?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(await within(rowOf(fixtureDrill.name)).findByRole("alert")).toHaveTextContent(
      "A practice session still uses this drill, so it cannot be deleted.",
    );
    await user.click(screen.getByRole("button", { name: `Delete ${UNCOVERED_NAME}` }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this drill?" })).getByRole("button", { name: "Keep it" }));
    expect(sent("DELETE", "/api/v1/drills/00000000-0000-4000-8000-000000000011")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: `Delete ${UNCOVERED_NAME}` }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this drill?" })).getByRole("button", { name: "Delete" }));
    await waitFor(async () => expect(await rows()).toHaveLength(SEEDED - 1));
  });

  it("R3.14 O-310 Export shows the code in a read-only field and Copy puts it on the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderDrills("/drills");
    await rows();
    await user.click(screen.getByRole("button", { name: `Export ${fixtureDrill.name}` }));
    const dialog = screen.getByRole("dialog", { name: `Export code: ${fixtureDrill.name}` });
    const field = await within(dialog).findByLabelText("Export code");
    expect(field).toHaveAttribute("readonly");
    const { name, tags, spot_filter, trainer } = fixtureDrill;
    expect(field).toHaveValue(encodeMockExportCode({ name, tags, spot_filter, trainer }));
    await user.click(within(dialog).getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(encodeMockExportCode({ name, tags, spot_filter, trainer }));
    expect(await within(dialog).findByText("Copied.")).toBeInTheDocument();
  });

  it("R3.14 a refused clipboard says to copy by hand, and a failed export read offers a retry", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } });
    let failExport = true;
    renderDrills("/drills", {
      override: (request) => (request.path.endsWith("/export") && failExport ? jsonBody(500, { type: "urn:g-tee-oh:problem:internal", title: "x", status: 500 }) : undefined),
    });
    await rows();
    await user.click(screen.getByRole("button", { name: `Export ${fixtureDrill.name}` }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The request failed. Try again.");
    failExport = false;
    await user.click(within(dialog).getByRole("button", { name: "Try again" }));
    await within(dialog).findByLabelText("Export code");
    await user.click(within(dialog).getByRole("button", { name: "Copy" }));
    expect(await within(dialog).findByText("Copying failed. Select the code and copy it by hand.")).toBeInTheDocument();
  });

  it("R3.14 O-310 importing a code adds the new drill to the list and announces it", async () => {
    const user = userEvent.setup();
    const { sent } = renderDrills("/drills");
    await rows();
    const code = encodeMockExportCode({ name: "Imported drill", tags: ["shared"], spot_filter: fixtureDrill.spot_filter, trainer: fixtureDrill.trainer });
    await user.click(screen.getByRole("button", { name: "Import a drill" }));
    const dialog = screen.getByRole("dialog", { name: "Import a drill" });
    await user.click(within(dialog).getByLabelText("Export code"));
    await user.paste(code);
    await user.click(within(dialog).getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.getByTestId("library-status")).toHaveTextContent("Imported Imported drill."));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sent("POST", "/api/v1/drills/import")[0]?.body).toEqual({ export_code: code });
    await waitFor(async () => expect(within((await rows())[0] as HTMLElement).getByRole("heading")).toHaveTextContent("Imported drill"));
  });

  it("R3.14 O-310 a refused code shows the api's reason; an empty code is caught before any request", async () => {
    const user = userEvent.setup();
    const { sent } = renderDrills("/drills");
    await rows();
    await user.click(screen.getByRole("button", { name: "Import a drill" }));
    const dialog = screen.getByRole("dialog", { name: "Import a drill" });
    await user.click(within(dialog).getByRole("button", { name: "Import" }));
    expect(within(dialog).getByText("Error: Paste an export code.")).toBeInTheDocument();
    expect(sent("POST", "/api/v1/drills/import")).toHaveLength(0);
    await user.type(within(dialog).getByLabelText("Export code"), "gteeoh2.abc");
    await user.click(within(dialog).getByRole("button", { name: "Import" }));
    expect(await within(dialog).findByTestId("import-failure")).toHaveTextContent("does not start with gteeoh1.");
    const stakeCode = encodeMockExportCode({ name: "x", tags: [], spot_filter: { ...fixtureDrill.spot_filter, stake: "1/3" }, trainer: fixtureDrill.trainer });
    await user.clear(within(dialog).getByLabelText("Export code"));
    await user.click(within(dialog).getByLabelText("Export code"));
    await user.paste(stakeCode);
    await user.click(within(dialog).getByRole("button", { name: "Import" }));
    await waitFor(() => expect(within(dialog).getByTestId("import-failure")).toHaveTextContent("spot_filter.stake: An online drill uses the stake online."));
  });

  it("R3.14 with no drills there is an empty state with a New drill link", async () => {
    renderDrills("/drills", {
      override: (request) => (request.method === "GET" && request.path === "/api/v1/drills" ? jsonBody(200, { items: [], next_cursor: null }) : undefined),
    });
    expect(await screen.findByText(/You have no drills yet/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "New drill" }).at(-1)).toHaveAttribute("href", "/drills/new");
  });

  it("R3.14 a failed list read says so and retries", async () => {
    const user = userEvent.setup();
    let fail = true;
    renderDrills("/drills", {
      override: (request) => (fail && request.path === "/api/v1/drills" ? jsonBody(429, { type: "urn:g-tee-oh:problem:rate-limited", title: "x", status: 429 }) : undefined),
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests.");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await rows()).toHaveLength(SEEDED);
  });

  it("R3.14 more drills than a page load with Load more over next_cursor", async () => {
    const user = userEvent.setup();
    const first = { items: [fixtureDrill], next_cursor: "cursor-1" };
    const second = { items: [{ ...fixtureDrill, id: "00000000-0000-4000-8000-0000000000e1", name: "Second page drill" }], next_cursor: null };
    renderDrills("/drills", {
      override: (request) =>
        request.method === "GET" && request.path === "/api/v1/drills" ? jsonBody(200, request.query["cursor"] === "cursor-1" ? second : first) : undefined,
    });
    expect(await rows()).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Load more drills" }));
    await waitFor(async () => expect(await rows()).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "Load more drills" })).not.toBeInTheDocument();
  });

  it("R3.14 O-310 round trip in the UI: export a drill, import its code, and the copy has the same spot summary", async () => {
    const user = userEvent.setup();
    let clipboard = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (text: string) => { clipboard = text; return Promise.resolve(); } },
    });
    renderDrills("/drills");
    await rows();
    await user.click(screen.getByRole("button", { name: `Export ${UNCOVERED_NAME}` }));
    await within(screen.getByRole("dialog")).findByLabelText("Export code");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Copy" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Import a drill" }));
    await user.click(within(screen.getByRole("dialog")).getByLabelText("Export code"));
    await user.paste(clipboard);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Import" }));
    await waitFor(async () => expect(await rows()).toHaveLength(SEEDED + 1));
    const [imported, source] = await rows();
    expect(within(imported as HTMLElement).getByRole("heading")).toHaveTextContent(UNCOVERED_NAME);
    expect(within(imported as HTMLElement).getByTestId("spot-summary").textContent).toBe(within(source as HTMLElement).getByTestId("spot-summary").textContent);
  });
});
