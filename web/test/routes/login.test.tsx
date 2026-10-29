/**
 * Two-step sign-in tests (S42, R3.13, O-349, O-425; S24 before it). Step 1 checks the email in
 * the browser and never calls the api, so it cannot reveal whether an account exists. Step 2 sends
 * the one login call; 401, 429 and every other failure map to fixed messages (never the server's
 * detail and never the password), the password is cleared and the email kept. "Use a different
 * email" goes back. On success the redirecting state shows, then the safe redirect.
 */
import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { fixtureSession } from "../../src/fixtures/index.js";
import { problemResponse, sessionResponse } from "../api/fake-fetch.js";
import type { FetchScript, ResponseFactory } from "../api/fake-fetch.js";
import { renderApp } from "../app/render-app.js";

const PASSWORD = "a-very-secret-passphrase";
const EMAIL = "owner@example.com";
const SERVER_DETAIL = "server detail text";
const SERVICE_NOTE = "The service is unavailable right now. You can still try to sign in.";
const LOGIN_PATH = "/api/v1/auth/login";

function signedOutWith(login: readonly ResponseFactory[]): FetchScript {
  return {
    "GET /api/v1/me": [problemResponse(401, "unauthenticated", SERVER_DETAIL)],
    "POST /api/v1/auth/login": login,
  };
}

async function openLogin(script: FetchScript, path = "/login") {
  const view = renderApp(path, script);
  await screen.findByRole("heading", { level: 1, name: "Sign in" });
  return view;
}

async function continueWith(email: string) {
  const user = userEvent.setup();
  if (email !== "") await user.type(screen.getByLabelText("Email"), email);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  return user;
}

async function signInWith(password: string, email = EMAIL) {
  const user = await continueWith(email);
  const field = await screen.findByLabelText("Password");
  if (password !== "") await user.type(field, password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  return user;
}

function loginCalls(fake: { calls: readonly { path: string; body: string }[] }) {
  return fake.calls.filter((call) => call.path === LOGIN_PATH);
}

describe("two-step sign-in", () => {
  it("R3.13 step 1 is one email field with username autocomplete and no password field", async () => {
    await openLogin(signedOutWith([]));

    const email = screen.getByLabelText("Email");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it.each([
    ["", "Enter your email address."],
    ["not-an-email", "Enter an email address like name@example.com."],
    ["a@b", "Enter an email address like name@example.com."],
  ])("R3.13 step 1 refuses %j with a fixed hint and sends nothing", async (email, message) => {
    const { fake } = await openLogin(signedOutWith([]));

    await continueWith(email);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(loginCalls(fake)).toHaveLength(0);
  });

  it("R3.13 a well-formed email moves to step 2 without any api call, showing the email as a chip", async () => {
    const { fake } = await openLogin(signedOutWith([]));
    const before = fake.calls.length;

    await continueWith(`  ${EMAIL} `);

    const password = await screen.findByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByTestId("email-chip")).toHaveTextContent(EMAIL);
    expect(fake.calls.length).toBe(before);
  });

  it("R3.13 the show and hide toggle reveals the password locally", async () => {
    await openLogin(signedOutWith([]));
    const user = await continueWith(EMAIL);
    const password = await screen.findByLabelText("Password");

    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("R3.13 an empty password says so and sends nothing", async () => {
    const { fake } = await openLogin(signedOutWith([]));

    await signInWith("");

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter your password.");
    expect(loginCalls(fake)).toHaveLength(0);
  });

  it.each([
    [401, "unauthenticated", "Email or password is incorrect."],
    [429, "rate-limited", "Too many sign-in attempts. Wait a minute and try again."],
    [400, "validation", "Sign-in failed. Try again."],
    [500, "internal", "Sign-in failed. Try again."],
  ])("R3.13 a %i answer shows a fixed message on step 2, clears the password and keeps the email", async (status, slug, message) => {
    const { fake } = await openLogin(signedOutWith([problemResponse(status, slug, SERVER_DETAIL)]));

    await signInWith(PASSWORD);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(document.body).not.toHaveTextContent(SERVER_DETAIL);
    expect(document.body).not.toHaveTextContent(PASSWORD);
    expect(screen.getByLabelText("Password")).toHaveValue("");
    await waitFor(() => expect(screen.getByLabelText("Password")).toHaveFocus());
    expect(screen.getByTestId("email-chip")).toHaveTextContent(EMAIL);
    expect(loginCalls(fake)).toHaveLength(1);
    expect(JSON.parse(loginCalls(fake)[0]?.body ?? "{}")).toEqual({ email: EMAIL, password: PASSWORD });
  });

  it("R3.13 an unknown email and a wrong password read the same", async () => {
    await openLogin(signedOutWith([problemResponse(401, "unauthenticated", "no such account")]));
    await signInWith(PASSWORD, "nobody@example.com");
    const unknown = (await screen.findByRole("alert")).textContent;

    expect(unknown).toBe("Email or password is incorrect.");
  });

  it("R3.13 Use a different email goes back to step 1 with the email kept and the message cleared", async () => {
    await openLogin(signedOutWith([problemResponse(401, "unauthenticated")]));
    const user = await signInWith(PASSWORD);
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Use a different email" }));

    expect(screen.getByLabelText("Email")).toHaveValue(EMAIL);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("R3.13 a 401 from /me renders step 1 with no service note", async () => {
    await openLogin(signedOutWith([]));

    expect(screen.queryByText(SERVICE_NOTE)).not.toBeInTheDocument();
  });

  it.each([
    ["a 503", problemResponse(503, "unavailable", SERVER_DETAIL)],
    ["a 500", problemResponse(500, "internal", SERVER_DETAIL)],
    ["a network failure", (() => Promise.reject(new TypeError("network down")))],
  ])("R3.13 %s from /me still renders step 1, with a service note and a console error", async (_label, me) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await openLogin({ "GET /api/v1/me": [me], "POST /api/v1/auth/login": [] });

      expect(await screen.findByText(SERVICE_NOTE)).toBeInTheDocument();
      expect(screen.getByLabelText("Email")).toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(SERVER_DETAIL);
      expect(consoleError).toHaveBeenCalled();
      const logged = consoleError.mock.calls.flat().map(String).join(" ");
      expect(logged).not.toContain(SERVER_DETAIL);
      expect(logged).not.toContain(fixtureSession.csrf_token);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("R3.13 a network failure on sign-in shows the generic message", async () => {
    const networkDown: ResponseFactory = () => Promise.reject(new TypeError("network down"));
    await openLogin(signedOutWith([networkDown]));

    await signInWith(PASSWORD);

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in failed. Try again.");
  });

  it("R3.13 disables the button while pending, shows the redirecting state, then follows the safe redirect", async () => {
    let releaseLogin: () => void = () => undefined;
    const loginAnswer = new Promise<Response>((resolve) => {
      releaseLogin = () => void Promise.resolve(sessionResponse("login-token")()).then(resolve);
    });
    const { api, router } = await openLogin(signedOutWith([() => loginAnswer]), "/login?redirect=%2Fdrills%2Fnew");

    await signInWith(PASSWORD);

    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled());
    releaseLogin();
    expect(await screen.findByText("Signing you in")).toBeInTheDocument();
    await screen.findByRole("heading", { level: 1, name: "New drill" });
    // /drills/new opens the builder's first page since S40 (O-405), so the redirect lands there.
    expect(router.state.location.pathname).toBe("/drills/new/details");
    expect(api.tokens.get()).toBe("login-token");
    expect(await screen.findByText(fixtureSession.user.email)).toBeInTheDocument();
  });

  it("R3.13 signing in clears data an earlier account left in the cache (review round 1, B)", async () => {
    const view = await openLogin(signedOutWith([sessionResponse()]));
    view.queryClient.setQueryData(["admin", "invites"], { items: [{ email: "earlier@example.com" }], hasMore: false });

    await signInWith(PASSWORD);

    await screen.findByRole("heading", { level: 1, name: "Home" });
    expect(view.queryClient.getQueryData(["admin", "invites"])).toBeUndefined();
    expect(view.queryClient.getQueryData(["auth", "me"])).toMatchObject({ user: { email: fixtureSession.user.email } });
  });

  it("R3.13 an unsafe redirect after sign-in lands home", async () => {
    const { router } = await openLogin(signedOutWith([sessionResponse()]), "/login?redirect=https%3A%2F%2Fevil.example");

    await signInWith(PASSWORD);

    await screen.findByRole("heading", { level: 1, name: "Home" });
    expect(router.state.location.pathname).toBe("/");
  });
});
