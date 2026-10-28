/**
 * The strength meter reruns its estimate only when the password or the user inputs change (S42
 * review round 1, G). The estimator is replaced by a counting stub, so the test sees every call:
 * typing the password runs it once per keystroke, while renders that change neither (a form
 * message appearing) run it not at all.
 */
import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../src/routes/onboarding/strength.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/routes/onboarding/strength.js")>();
  return {
    ...actual,
    loadStrengthEstimator: () =>
      Promise.resolve(() => {
        calls.count += 1;
        return 3 as const;
      }),
  };
});

import { jsonResponse, problemResponse } from "../api/fake-fetch.js";
import { renderApp } from "../app/render-app.js";

// Built from repeated characters: a synthetic token, low in entropy so no secret scanner mistakes it.
const TOKEN = `01890a5d-ac96-774b-bcce-b302099a8057.${"a".repeat(43)}`;
const PREVIEW = { email: "new.member@example.com", expires_at: "2026-11-04T12:00:00Z" };

describe("R3.13 strength meter memo", () => {
  it("R3.13 a render that changes neither the password nor the inputs does not rerun the estimator", async () => {
    renderApp(`/join#${TOKEN}`, {
      "GET /api/v1/me": [problemResponse(401, "unauthenticated")],
      "POST /api/v1/auth/invites/inspect": [jsonResponse(200, PREVIEW)],
    });
    const user = userEvent.setup();
    await screen.findByLabelText("Name");

    await user.type(screen.getByLabelText("Password"), "abcdefghijklm");
    await waitFor(() => expect(screen.getByTestId("strength-meter")).toHaveAttribute("data-score", "3"));
    const afterTyping = calls.count;
    expect(afterTyping).toBeGreaterThan(0);

    // An empty name makes the form show a message: a re-render with the same password and inputs.
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter your name.");
    expect(calls.count).toBe(afterTyping);
  });
});
