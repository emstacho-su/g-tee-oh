/**
 * The S26 review fixes on the drill screens (R3.14, PR #30 review MEDIUM 1, MEDIUM 2, LOW 11):
 * - a refused import lists at most MAX_LISTED_FIELD_ERRORS of the api's errors and says how many
 *   more there were (the api's errors_omitted plus any it sent past the cap), so a code that makes
 *   hundreds of errors never renders a long list;
 * - an export the api refuses with 422 (a stored drill that no longer passes the write rules)
 *   shows the api's detail and the failing paths, and offers no retry of the same fixed answer;
 * - after a create, the builder drops ?saved=1 from the URL with a replace navigation, and
 *   "Drill saved." still shows once.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MAX_LISTED_FIELD_ERRORS } from "../../src/drills/problem.js";
import { fixtureDrill } from "../../src/fixtures/trainer.js";
import { jsonBody } from "../library/render-library.js";
import { renderDrills } from "./render-drills.js";

const VALIDATION_TYPE = "urn:g-tee-oh:problem:validation";
const MANY_ERRORS = 500;
const SERVER_OMITTED = 31_000;

function tagErrors(count: number): { path: string; message: string }[] {
  return Array.from({ length: count }, (_, index) => ({ path: `body.export_code.tags.${index}`, message: `Tag ${index} is not a valid tag.` }));
}

async function submitImport(code: string): Promise<HTMLElement> {
  const user = userEvent.setup();
  await screen.findByRole("table", { name: "Your drills" });
  await user.click(screen.getByRole("button", { name: "Import a drill" }));
  const dialog = screen.getByRole("dialog", { name: "Import a drill" });
  await user.click(within(dialog).getByLabelText("Export code"));
  await user.paste(code);
  await user.click(within(dialog).getByRole("button", { name: "Import" }));
  return within(dialog).findByTestId("import-failure");
}

function refusedImport(body: object) {
  return (request: { method: string; path: string }) =>
    request.method === "POST" && request.path === "/api/v1/drills/import" ? jsonBody(400, body) : undefined;
}

describe("R3.14 review MEDIUM 1: a refused import lists a bounded number of errors", () => {
  it("R3.14 a 400 with hundreds of errors lists 20 and says how many more", async () => {
    renderDrills("/drills", {
      override: refusedImport({ type: VALIDATION_TYPE, title: "Request validation failed", status: 400, detail: "The export code holds a drill the write rules refuse.", errors: tagErrors(MANY_ERRORS) }),
    });
    const failure = await submitImport("gteeoh1.bomb");
    const items = within(failure).getAllByRole("listitem");
    expect(items).toHaveLength(MAX_LISTED_FIELD_ERRORS + 1);
    expect(items[0]).toHaveTextContent("tags.0: Tag 0 is not a valid tag.");
    expect(items.at(-1)).toHaveTextContent(`and ${MANY_ERRORS - MAX_LISTED_FIELD_ERRORS} more`);
  });

  it("R3.14 the api's errors_omitted count is added to the more line", async () => {
    renderDrills("/drills", {
      override: refusedImport({
        type: VALIDATION_TYPE,
        title: "Request validation failed",
        status: 400,
        detail: "The export code holds a drill the write rules refuse.",
        errors: tagErrors(MAX_LISTED_FIELD_ERRORS),
        errors_omitted: SERVER_OMITTED,
      }),
    });
    const failure = await submitImport("gteeoh1.bomb");
    expect(within(failure).getAllByRole("listitem")).toHaveLength(MAX_LISTED_FIELD_ERRORS + 1);
    expect(within(failure).getAllByRole("listitem").at(-1)).toHaveTextContent(`and ${SERVER_OMITTED} more`);
  });

  it("R3.14 a malformed errors_omitted is ignored and a long message is clipped", async () => {
    const long = "x".repeat(5000);
    renderDrills("/drills", {
      override: refusedImport({ type: VALIDATION_TYPE, title: "t", status: 400, detail: "Refused.", errors: [{ path: "body.export_code.name", message: long }], errors_omitted: "lots" }),
    });
    const failure = await submitImport("gteeoh1.long");
    const items = within(failure).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect((items[0]?.textContent ?? "").length).toBeLessThan(300);
  });
});

describe("R3.14 review MEDIUM 2: an export the api refuses shows why", () => {
  it("R3.14 a 422 for a stored drill that no longer passes the write rules shows the detail and the failing path, with no retry", async () => {
    const user = userEvent.setup();
    const detail = "This drill can no longer be exported: it breaks a write rule.";
    renderDrills("/drills", {
      override: (request) =>
        request.path.endsWith("/export")
          ? jsonBody(422, { type: VALIDATION_TYPE, title: "Request validation failed", status: 422, detail, errors: [{ path: "drill.spot_filter.stake", message: "An online drill uses the stake online." }] })
          : undefined,
    });
    await screen.findByRole("table", { name: "Your drills" });
    await user.click(screen.getByRole("radio", { name: `Select ${fixtureDrill.name}` }));
    await user.click(screen.getByRole("button", { name: `Export ${fixtureDrill.name}` }));
    const dialog = screen.getByRole("dialog");
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(detail);
    expect(within(alert).getByRole("listitem").textContent).toBe("spot_filter.stake: An online drill uses the stake online.");
    expect(within(dialog).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Export code")).not.toBeInTheDocument();
  });
});

/** The builder is a large form; under the whole parallel suite it can pass the default 5 seconds. */
const BUILDER_TEST_TIMEOUT_MS = 20_000;

describe("R3.14 review LOW 11: the builder drops ?saved=1 after the first render", { timeout: BUILDER_TEST_TIMEOUT_MS }, () => {
  it("R3.14 opening a just-created drill replaces the URL without saved=1 and says Drill saved. once", async () => {
    const { router } = renderDrills(`/drills/${fixtureDrill.id}?saved=1`);
    expect(await screen.findByTestId("builder-status")).toHaveTextContent("Drill saved.");
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    // S40 (O-405): the bare URL opens the builder's first page, keeping saved=1 until it is dropped.
    expect(router.state.location.pathname).toBe(`/drills/${fixtureDrill.id}/details`);
    expect(router.history.length).toBe(1);
    expect(screen.getByTestId("builder-status")).toHaveTextContent("Drill saved.");
  });

  it("R3.14 the status clears on the first edit and does not come back", async () => {
    const user = userEvent.setup();
    const { router } = renderDrills(`/drills/${fixtureDrill.id}?saved=1`);
    expect(await screen.findByTestId("builder-status")).toHaveTextContent("Drill saved.");
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    await user.type(screen.getByLabelText("Name"), "!");
    expect(screen.getByTestId("builder-status")).toHaveTextContent("");
  });
});
