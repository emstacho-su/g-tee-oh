/**
 * CosmeticsRoot (S32, R4.14, O-323): it writes data-felt and data-card-back on the root only for
 * equipped items the server has unlocked, asks nothing when no slot has a choice, removes the
 * attributes when the read fails and on unmount, and the signed-in app mounts it.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppApi } from "../../src/api/index.js";
import { ApiProvider, createQueryClient } from "../../src/auth/index.js";
import { CARD_BACK_ATTRIBUTE, CosmeticsRoot, FELT_ATTRIBUTE } from "../../src/cosmetics/CosmeticsRoot.js";
import { fixtureStreak } from "../../src/fixtures/progress.js";
import { defaultHotkeyStore } from "../../src/hotkeys/index.js";
import { COSMETIC_SLOTS, useCosmeticsStore } from "../../src/store/index.js";
import { createFakeFetch, jsonResponse, noContent, problemResponse, sessionResponse, type FetchScript } from "../api/fake-fetch.js";
import { renderApp, TEST_ORIGIN } from "../app/render-app.js";

const STREAK_KEY = "GET /api/v1/progress/streak";

function renderRoot(script: FetchScript) {
  const fake = createFakeFetch(script);
  const api = createAppApi({ baseUrl: TEST_ORIGIN, fetch: fake.fetch });
  const root = document.createElement("div");
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <ApiProvider api={api}>
        <CosmeticsRoot root={root} />
      </ApiProvider>
    </QueryClientProvider>,
  );
  return { ...view, fake, root };
}

function clearChoices(): void {
  for (const slot of COSMETIC_SLOTS) useCosmeticsStore.getState().equip(slot, null);
}

beforeEach(clearChoices);

afterEach(() => {
  clearChoices();
  document.documentElement.removeAttribute(FELT_ATTRIBUTE);
  document.documentElement.removeAttribute(CARD_BACK_ATTRIBUTE);
  defaultHotkeyStore.getState().setOverlayOpen(false);
});

describe("R4.14 CosmeticsRoot", () => {
  it("R4.14 sets the felt and card back only for unlocked choices, and clears them on unmount", async () => {
    // The seasoned fixture has unlocked felt-tier-III and card-back-streak-14, not card-back-streak-60.
    useCosmeticsStore.getState().equip("felt", "felt-tier-III");
    useCosmeticsStore.getState().equip("card-back", "card-back-streak-60");
    const { root, unmount } = renderRoot({ [STREAK_KEY]: [jsonResponse(200, fixtureStreak)] });

    await waitFor(() => expect(root.getAttribute(FELT_ATTRIBUTE)).toBe("felt-tier-III"));
    expect(root.hasAttribute(CARD_BACK_ATTRIBUTE)).toBe(false);

    useCosmeticsStore.getState().equip("card-back", "card-back-streak-14");
    await waitFor(() => expect(root.getAttribute(CARD_BACK_ATTRIBUTE)).toBe("card-back-streak-14"));
    useCosmeticsStore.getState().equip("felt", null);
    await waitFor(() => expect(root.hasAttribute(FELT_ATTRIBUTE)).toBe(false));

    unmount();
    expect(root.hasAttribute(CARD_BACK_ATTRIBUTE)).toBe(false);
  });

  it("R4.14 asks nothing and sets nothing when no slot has a choice", async () => {
    const { root, fake } = renderRoot({ [STREAK_KEY]: [jsonResponse(200, fixtureStreak)] });
    await new Promise((done) => setTimeout(done, 20));
    expect(fake.keys()).toEqual([]);
    expect(root.hasAttribute(FELT_ATTRIBUTE)).toBe(false);
  });

  it("R4.14 a failed unlock read applies nothing", async () => {
    useCosmeticsStore.getState().equip("felt", "felt-tier-III");
    const { root, fake } = renderRoot({ [STREAK_KEY]: [problemResponse(500, "internal")] });
    await waitFor(() => expect(fake.keys()).toContain(STREAK_KEY));
    await new Promise((done) => setTimeout(done, 20));
    expect(root.hasAttribute(FELT_ATTRIBUTE)).toBe(false);
  });

  it("R4.14 the signed-in app applies the felt on <html> and removes it on sign out", async () => {
    const user = userEvent.setup();
    useCosmeticsStore.getState().equip("felt", "felt-tier-III");
    renderApp("/settings", {
      "GET /api/v1/me": [sessionResponse("live-token"), problemResponse(401, "unauthenticated")],
      "POST /api/v1/auth/logout": [noContent()],
      [STREAK_KEY]: [jsonResponse(200, fixtureStreak)],
      "GET /api/v1/configs": [jsonResponse(200, { items: [], next_cursor: null })],
    });

    await waitFor(() => expect(document.documentElement.getAttribute(FELT_ATTRIBUTE)).toBe("felt-tier-III"));
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(document.documentElement.hasAttribute(FELT_ATTRIBUTE)).toBe(false));
  });
});
