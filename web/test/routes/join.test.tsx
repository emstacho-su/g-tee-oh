/**
 * Join page tests (S42, R3.13, O-349, O-421, O-422, O-424, O-425): the token is read from the
 * fragment and the fragment removed; the invite is inspected once; a bad invite shows one fixed
 * message with a way to sign in; the form shows the invite's email as a chip and asks only a name
 * and a password; client checks match the api's rules; the strength meter reads live; failures map
 * to fixed texts; success shows the redirecting state and lands home signed in.
 */
import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fixtureMemberSession } from "../../src/fixtures/index.js";
import { checkName, joinFailure } from "../../src/routes/join.js";
import { ApiProblem } from "../../src/api/index.js";
import { jsonResponse, networkFailure, problemResponse, type FetchScript, type ResponseFactory } from "../api/fake-fetch.js";
import { renderApp } from "../app/render-app.js";

const TOKEN = "01890a5d-ac96-774b-bcce-b302099a8057.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const INVITE_EMAIL = "new.member@example.com";
const PASSWORD = "plum orbit lantern seventy";
const SERVER_DETAIL = "server detail text";
const PREVIEW = { email: INVITE_EMAIL, expires_at: "2026-11-04T12:00:00Z" };
const JOINED = { ...fixtureMemberSession, user: { ...fixtureMemberSession.user, email: INVITE_EMAIL, display_name: "Sam" } };
const INVALID_TEXT = "This invite link is not valid. It may have expired or been used already. Ask for a new one.";

function script(inspect: readonly ResponseFactory[], join: readonly ResponseFactory[] = []): FetchScript {
  return {
    "GET /api/v1/me": [problemResponse(401, "unauthenticated")],
    "POST /api/v1/auth/invites/inspect": inspect,
    "POST /api/v1/auth/join": join,
  };
}

async function openForm(join: readonly ResponseFactory[] = []) {
  const view = renderApp(`/join#${TOKEN}`, script([jsonResponse(200, PREVIEW)], join));
  await screen.findByLabelText("Name");
  return view;
}

async function fillAndSubmit(name: string, password: string) {
  const user = userEvent.setup();
  if (name !== "") await user.type(screen.getByLabelText("Name"), name);
  if (password !== "") await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Create account" }));
  return user;
}

function callsTo(fake: { calls: readonly { path: string; body: string }[] }, path: string) {
  return fake.calls.filter((call) => call.path === path);
}

describe("join page", () => {
  it("R3.13 reads the token from the fragment, strips it from the address, and inspects once with it in the body", async () => {
    const { fake, router } = await openForm();

    await waitFor(() => expect(router.state.location.hash).toBe(""));
    const inspects = callsTo(fake, "/api/v1/auth/invites/inspect");
    expect(inspects).toHaveLength(1);
    expect(JSON.parse(inspects[0]?.body ?? "{}")).toEqual({ token: TOKEN });
    expect(router.state.location.href).not.toContain(TOKEN);
    expect(document.body).not.toHaveTextContent(TOKEN);
  });

  it("R3.13 shows the invite's email as a read-only chip and asks only a name and a password (O-421)", async () => {
    await openForm();

    expect(screen.getByRole("heading", { level: 1, name: "Join g-tee-oh" })).toBeInTheDocument();
    expect(screen.getByTestId("email-chip")).toHaveTextContent(INVITE_EMAIL);
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.getByLabelText("Name")).toHaveAttribute("autocomplete", "name");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
  });

  it("R3.13 says it is checking while inspect runs", async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = () => void Promise.resolve(jsonResponse(200, PREVIEW)()).then(resolve);
    });
    renderApp(`/join#${TOKEN}`, script([() => pending]));

    expect(await screen.findByText("Checking your invite")).toBeInTheDocument();
    release();
    expect(await screen.findByLabelText("Name")).toBeInTheDocument();
  });

  it("R3.13 a 410 from inspect shows the one fixed message and a way to sign in (O-422)", async () => {
    renderApp(`/join#${TOKEN}`, script([problemResponse(410, "invite-invalid", SERVER_DETAIL)]));

    expect(await screen.findByRole("alert")).toHaveTextContent(INVALID_TEXT);
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
    expect(document.body).not.toHaveTextContent(SERVER_DETAIL);
  });

  it("R3.13 no fragment at all says the full link is needed and calls nothing", async () => {
    const { fake } = renderApp("/join", script([]));

    expect(await screen.findByRole("alert")).toHaveTextContent("This page needs the invite link you were sent.");
    expect(callsTo(fake, "/api/v1/auth/invites/inspect")).toHaveLength(0);
  });

  it("R3.13 a failed check offers a retry that inspects again", async () => {
    const user = userEvent.setup();
    const { fake } = renderApp(`/join#${TOKEN}`, script([networkFailure(), jsonResponse(200, PREVIEW)]));

    expect(await screen.findByRole("alert")).toHaveTextContent("The invite could not be checked right now.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Name")).toBeInTheDocument();
    expect(callsTo(fake, "/api/v1/auth/invites/inspect")).toHaveLength(2);
  });

  it.each([
    ["", PASSWORD, "Enter your name."],
    ["Sam", "short pass", "Use at least 12 characters for your password."],
  ])("R3.13 client checks: name %j with that password says the fix and sends nothing", async (name, password, message) => {
    const { fake } = await openForm();

    await fillAndSubmit(name, password);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(callsTo(fake, "/api/v1/auth/join")).toHaveLength(0);
  });

  it("R3.13 the strength meter reads Too short, then a stronger word as the password grows (O-424)", async () => {
    await openForm();
    const user = userEvent.setup();
    const meter = screen.getByTestId("strength-meter");

    await user.type(screen.getByLabelText("Password"), "abc");
    expect(meter).toHaveTextContent("Too short");
    expect(meter).toHaveAttribute("data-score", "0");

    await user.type(screen.getByLabelText("Password"), "-plum-orbit-lantern-70");
    await waitFor(() => expect(Number(meter.getAttribute("data-score"))).toBeGreaterThanOrEqual(3));
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(/Password strength/);
  });

  it("R3.13 a correct form joins, shows the redirecting state and lands home signed in", async () => {
    const { fake, router, api } = await openForm([jsonResponse(200, JOINED)]);

    await fillAndSubmit("  Sam ", PASSWORD);

    expect(await screen.findByText("Setting up your account")).toBeInTheDocument();
    await screen.findByRole("heading", { level: 1, name: "Home" });
    expect(router.state.location.pathname).toBe("/");
    expect(api.tokens.get()).toBe(JOINED.csrf_token);
    const joins = callsTo(fake, "/api/v1/auth/join");
    expect(joins).toHaveLength(1);
    expect(JSON.parse(joins[0]?.body ?? "{}")).toEqual({ token: TOKEN, display_name: "Sam", password: PASSWORD });
  });

  it("R3.13 a 410 on join switches to the invalid notice", async () => {
    await openForm([problemResponse(410, "invite-invalid", SERVER_DETAIL)]);

    await fillAndSubmit("Sam", PASSWORD);

    expect(await screen.findByRole("alert")).toHaveTextContent(INVALID_TEXT);
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it.each([
    [409, "conflict", "An account already exists for this email. Sign in instead."],
    [429, "rate-limited", "Too many attempts. Wait a minute and try again."],
    [400, "validation", "Check your name and password and try again."],
    [500, "internal", "Something went wrong. Try again."],
  ])("R3.13 a %i on join shows a fixed message and never the detail or the password", async (status, slug, message) => {
    await openForm([problemResponse(status, slug, SERVER_DETAIL)]);

    await fillAndSubmit("Sam", PASSWORD);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(document.body).not.toHaveTextContent(SERVER_DETAIL);
    expect(document.body).not.toHaveTextContent(PASSWORD);
    if (status === 409) expect(screen.getByRole("link", { name: "Go to sign in" })).toBeInTheDocument();
  });
});

describe("join checks", () => {
  it.each([
    ["Sam", null],
    ["  Sam  ", null],
    ["", "Enter your name."],
    ["   ", "Enter your name."],
    ["Sam‮Rivera", "Remove invisible or control characters from your name."],
    ["Sam​Rivera", "Remove invisible or control characters from your name."],
    ["Sam\u0007", "Remove invisible or control characters from your name."],
    ["a".repeat(61), "Use 60 characters or fewer for your name."],
    ["😀".repeat(60), null],
  ])("R3.13 checkName(%j)", (name, expected) => {
    expect(checkName(name)).toBe(expected);
  });

  it("R3.13 joinFailure maps a non-problem error to the generic text", () => {
    expect(joinFailure(new Error("boom"))).toEqual({ kind: "message", text: "Something went wrong. Try again." });
    expect(joinFailure(new ApiProblem({ status: 410, slug: "invite-invalid", title: "x" }))).toEqual({ kind: "invalid" });
  });
});
