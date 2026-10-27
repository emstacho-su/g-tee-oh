/**
 * Login page tests (R3.13, A9 section 3). The form checks its fields before sending, maps 401,
 * 429 and every other failure to fixed messages (never the server's detail text and never the
 * password), disables its button while the request runs, and on success follows the safe redirect.
 */
import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { fixtureSession } from "../../src/fixtures/index.js";
import { problemResponse, sessionResponse } from "../api/fake-fetch.js";
import type { FetchScript, ResponseFactory } from "../api/fake-fetch.js";
import { renderApp } from "../app/render-app.js";

const PASSWORD = "a-very-secret-passphrase";
const SERVER_DETAIL = "server detail text";
const SERVICE_NOTE = "The service is unavailable right now. You can still try to sign in.";

function signedOutWith(login: readonly ResponseFactory[]): FetchScript {
  return {
    "GET /api/v1/me": [problemResponse(401, "unauthenticated", SERVER_DETAIL)],
    "POST /api/v1/auth/login": login,
  };
}

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup();
  if (email !== "") await user.type(screen.getByLabelText("Email"), email);
  if (password !== "") await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

async function openLogin(script: FetchScript, path = "/login") {
  const view = renderApp(path, script);
  await screen.findByRole("heading", { level: 1, name: "Sign in" });
  return view;
}

describe("login page", () => {
  it("R3.13 labels its inputs with the right types and autocomplete hints", async () => {
    await openLogin(signedOutWith([]));

    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
  });

  it.each([
    ["", PASSWORD, "Enter your email address."],
    ["not-an-email", PASSWORD, "Enter an email address like name@example.com."],
    ["a@b", PASSWORD, "Enter an email address like name@example.com."],
    ["owner@example.com", "", "Enter your password."],
  ])("R3.13 client check for email %j (case %#) says the fix and sends nothing", async (email, password, message) => {
    const { fake } = await openLogin(signedOutWith([]));

    await fillAndSubmit(email, password);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(fake.calls.some((call) => call.path === "/api/v1/auth/login")).toBe(false);
  });

  it.each([
    [401, "unauthenticated", "Email or password is incorrect."],
    [429, "rate-limited", "Too many sign-in attempts. Wait a minute and try again."],
    [400, "validation", "Sign-in failed. Try again."],
    [500, "internal", "Sign-in failed. Try again."],
  ])("R3.13 a %i answer shows a fixed message", async (status, slug, message) => {
    await openLogin(signedOutWith([problemResponse(status, slug, SERVER_DETAIL)]));

    await fillAndSubmit("owner@example.com", PASSWORD);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(document.body).not.toHaveTextContent(SERVER_DETAIL);
    expect(document.body).not.toHaveTextContent(PASSWORD);
  });

  it("R3.13 a 401 from /me renders the form with no service note", async () => {
    await openLogin(signedOutWith([]));

    expect(screen.queryByText(SERVICE_NOTE)).not.toBeInTheDocument();
  });

  it.each([
    ["a 503", problemResponse(503, "unavailable", SERVER_DETAIL)],
    ["a 500", problemResponse(500, "internal", SERVER_DETAIL)],
    ["a network failure", (() => Promise.reject(new TypeError("network down")))],
  ])("R3.13 %s from /me still renders the form, with a service note and a console error", async (_label, me) => {
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

  it("R3.13 a network failure shows the generic message", async () => {
    const networkDown: ResponseFactory = () => Promise.reject(new TypeError("network down"));
    await openLogin(signedOutWith([networkDown]));

    await fillAndSubmit("owner@example.com", PASSWORD);

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in failed. Try again.");
  });

  it("R3.13 disables the button while pending, then follows the safe redirect", async () => {
    let releaseLogin: () => void = () => undefined;
    const loginAnswer = new Promise<Response>((resolve) => {
      releaseLogin = () => void Promise.resolve(sessionResponse("login-token")()).then(resolve);
    });
    const { api, router } = await openLogin(signedOutWith([() => loginAnswer]), "/login?redirect=%2Fdrills%2Fnew");

    await fillAndSubmit("owner@example.com", PASSWORD);

    await waitFor(() => expect(screen.getByRole("button", { name: /Sign/ })).toBeDisabled());
    releaseLogin();
    await screen.findByRole("heading", { level: 1, name: "Drill builder" });
    expect(router.state.location.pathname).toBe("/drills/new");
    expect(api.tokens.get()).toBe("login-token");
    expect(await screen.findByText(fixtureSession.user.email)).toBeInTheDocument();
  });

  it("R3.13 an unsafe redirect after sign-in lands home", async () => {
    const { router } = await openLogin(signedOutWith([sessionResponse()]), "/login?redirect=https%3A%2F%2Fevil.example");

    await fillAndSubmit("owner@example.com", PASSWORD);

    await screen.findByRole("heading", { level: 1, name: "Home" });
    expect(router.state.location.pathname).toBe("/");
  });
});
