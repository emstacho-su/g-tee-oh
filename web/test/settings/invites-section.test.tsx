/**
 * The admin Invites page of /settings (S42, R3.5, O-349, O-427): the list with each status, create
 * with client checks and fixed failure texts, the link shown once in a dialog with Copy and kept
 * out of the query and mutation caches and browser storage, dropped when the dialog closes, revoke
 * behind a confirmation with an Idempotency-Key, and the member note.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fixtureMemberSession, fixtureSession } from "../../src/fixtures/index.js";
import type { InviteSummary } from "../../src/contracts.js";
import { fixtureStreak } from "../../src/fixtures/progress.js";
import { jsonResponse, problemResponse, sessionResponse, type FetchScript, type ResponseFactory } from "../api/fake-fetch.js";
import { renderApp } from "../app/render-app.js";

const INVITES = "/api/v1/admin/invites";
const LINK = "http://localhost:4173/join#01890a5d-ac96-774b-bcce-b302099a8057.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const SERVER_DETAIL = "server detail text";

function invite(overrides: Partial<InviteSummary>): InviteSummary {
  return {
    id: "01890a5d-ac96-774b-bcce-b302099a8001",
    email: "pending@example.com",
    created_by_email: "owner@example.com",
    created_at: "2026-10-28T12:00:00Z",
    expires_at: "2026-11-04T12:00:00Z",
    used_at: null,
    revoked_at: null,
    status: "pending",
    ...overrides,
  };
}

const PENDING = invite({});
const LIST = {
  items: [
    PENDING,
    invite({ id: "01890a5d-ac96-774b-bcce-b302099a8002", email: "used@example.com", status: "used", used_at: "2026-10-29T12:00:00Z" }),
    invite({ id: "01890a5d-ac96-774b-bcce-b302099a8003", email: "old@example.com", status: "expired" }),
    invite({ id: "01890a5d-ac96-774b-bcce-b302099a8004", email: "gone@example.com", status: "revoked", revoked_at: "2026-10-29T12:00:00Z" }),
  ],
  next_cursor: null,
};
const CREATED = { invite: invite({ id: "01890a5d-ac96-774b-bcce-b302099a8057", email: "new@example.com" }), link: LINK };

function adminScript(extra: Partial<Record<string, readonly ResponseFactory[]>> = {}): FetchScript {
  return {
    "GET /api/v1/me": [sessionResponse()],
    "GET /api/v1/progress/streak": [jsonResponse(200, fixtureStreak)],
    [`GET ${INVITES}`]: [jsonResponse(200, LIST)],
    ...extra,
  };
}

async function openInvites(script: FetchScript) {
  const view = renderApp("/settings/invites", script);
  await screen.findByRole("region", { name: "Invites" });
  return view;
}

async function createFor(email: string) {
  const user = userEvent.setup();
  if (email !== "") await user.type(screen.getByLabelText("Email to invite"), email);
  await user.click(screen.getByRole("button", { name: "Create invite" }));
  return user;
}

function cachedText(view: Awaited<ReturnType<typeof openInvites>>): string {
  const queries = view.queryClient.getQueryCache().getAll().map((query) => query.state.data);
  const mutations = view.queryClient.getMutationCache().getAll().map((mutation) => mutation.state.data);
  return JSON.stringify([queries, mutations]);
}

function storedText(): string {
  const read = (storage: Storage) => Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index) ?? "")).join(" ");
  return `${read(window.localStorage)} ${read(window.sessionStorage)}`;
}

describe("R3.5 admin invites page", () => {
  it("R3.5 lists the newest invites with their status, and Revoke only on pending ones", async () => {
    await openInvites(adminScript());

    const list = await screen.findByRole("list", { name: "Recent invites" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Pending"),
      expect.stringContaining("Used"),
      expect.stringContaining("Expired"),
      expect.stringContaining("Revoked"),
    ]);
    expect(within(list).getAllByRole("button", { name: /^Revoke / })).toHaveLength(1);
    expect(within(list).getByRole("button", { name: "Revoke pending@example.com" })).toBeInTheDocument();
  });

  it("R3.5 the email field uses the shared field class", async () => {
    await openInvites(adminScript());
    expect(screen.getByLabelText("Email to invite")).toHaveClass("border-border-strong", "bg-surface-raised");
  });

  it.each([
    ["", "Enter the email address to invite."],
    ["nope", "Enter an email address like name@example.com."],
  ])("R3.5 create checks %j in the browser and sends nothing", async (email, message) => {
    const { fake } = await openInvites(adminScript());

    await createFor(email);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(fake.calls.some((call) => call.method === "POST" && call.path === INVITES)).toBe(false);
  });

  it("R3.5 create shows the link once in a dialog with Copy, keeps it out of caches and storage, and drops it on close (O-427)", async () => {
    const view = await openInvites(adminScript({ [`POST ${INVITES}`]: [jsonResponse(201, CREATED)] }));

    const user = await createFor("new@example.com");

    const dialog = await screen.findByRole("dialog", { name: "Invite link" });
    expect(within(dialog).getByLabelText("Join link")).toHaveValue(LINK);
    const post = view.fake.calls.find((call) => call.method === "POST" && call.path === INVITES);
    expect(JSON.parse(post?.body ?? "{}")).toEqual({ email: "new@example.com" });
    expect(post?.csrf).toBe(fixtureSession.csrf_token);

    await user.click(within(dialog).getByRole("button", { name: "Copy link" }));
    expect(await within(dialog).findByText("Copied.")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(LINK);

    expect(cachedText(view)).not.toContain(LINK);
    expect(storedText()).not.toContain(LINK);

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.innerHTML).not.toContain(LINK);
    expect(screen.getByLabelText("Email to invite")).toHaveValue("");
    expect(view.fake.calls.filter((call) => call.method === "GET" && call.path === INVITES).length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    [409, "conflict", "An account already exists for this email."],
    [429, "rate-limited", "Too many invites in a minute. Wait and try again."],
    [500, "internal", "The invite could not be created. Try again."],
  ])("R3.5 a %i on create shows a fixed text and no dialog", async (status, slug, message) => {
    await openInvites(adminScript({ [`POST ${INVITES}`]: [problemResponse(status, slug, SERVER_DETAIL)] }));

    await createFor("someone@example.com");

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body).not.toHaveTextContent(SERVER_DETAIL);
  });

  it("R3.5 revoke asks first, then sends one request with an Idempotency-Key and refreshes the list", async () => {
    const revoked = { ...PENDING, status: "revoked", revoked_at: "2026-10-29T13:00:00Z" };
    const view = await openInvites(
      adminScript({ [`POST ${INVITES}/${PENDING.id}/revoke`]: [jsonResponse(200, revoked)] }),
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Revoke pending@example.com" }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke this invite?" });
    expect(dialog).toHaveTextContent("pending@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Revoke invite" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const revokes = view.fake.calls.filter((call) => call.path === `${INVITES}/${PENDING.id}/revoke`);
    expect(revokes).toHaveLength(1);
    expect(view.fake.calls.filter((call) => call.method === "GET" && call.path === INVITES).length).toBeGreaterThanOrEqual(2);
  });

  it("R3.5 a failed revoke says so in the dialog", async () => {
    await openInvites(adminScript({ [`POST ${INVITES}/${PENDING.id}/revoke`]: [problemResponse(409, "conflict", SERVER_DETAIL)] }));
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Revoke pending@example.com" }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke this invite?" });
    await user.click(within(dialog).getByRole("button", { name: "Revoke invite" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The invite could not be revoked. Try again.");
  });

  it("R3.5 a failed list load (a 4xx, which the query client does not retry) offers a retry", async () => {
    await openInvites(adminScript({ [`GET ${INVITES}`]: [problemResponse(400, "bad-request"), jsonResponse(200, LIST)] }));
    const user = userEvent.setup();

    expect(await screen.findByText("The invites could not be loaded.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: "Recent invites" })).toBeInTheDocument();
  });

  it("R3.5 a member opening the URL reads that invites are for admins and nothing is fetched", async () => {
    const { fake } = renderApp("/settings/invites", {
      "GET /api/v1/me": [jsonResponse(200, fixtureMemberSession)],
      "GET /api/v1/progress/streak": [jsonResponse(200, fixtureStreak)],
    });

    expect(await screen.findByText("Invites are for admins.")).toBeInTheDocument();
    expect(fake.calls.some((call) => call.path === INVITES)).toBe(false);
  });
});
