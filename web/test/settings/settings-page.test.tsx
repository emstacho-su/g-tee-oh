/**
 * /settings through the whole app (S32, R4.12, R4.14, O-323, O-327): the Session defaults section
 * saving grouping, RNG and the configuration scope to the store (with the paged /configs read, the
 * cap and saved ids no longer offered), the Cosmetics section (unlocked items selectable, locked
 * items named with their rule, the equipped felt applied on <html>), the read-only Hotkeys table,
 * and each read's error with Try again, for a member and an admin.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FELT_ATTRIBUTE } from "../../src/cosmetics/CosmeticsRoot.js";
import { fixtureMemberSession } from "../../src/fixtures/index.js";
import { fixtureStreak } from "../../src/fixtures/progress.js";
import { fixtureConfigs } from "../../src/fixtures/study.js";
import { defaultHotkeyStore } from "../../src/hotkeys/index.js";
import type { GameConfig } from "../../src/progress/types.js";
import { ALL_CONFIGS, COSMETIC_SLOTS, MAX_SCOPE_CONFIGS, useCosmeticsStore, useSessionDefaultsStore } from "../../src/store/index.js";
import { jsonResponse, problemResponse, sessionResponse, type FetchScript } from "../api/fake-fetch.js";
import { renderApp } from "../app/render-app.js";

const STREAK = "GET /api/v1/progress/streak";
const CONFIGS = "GET /api/v1/configs";
const [FIRST_CONFIG, SECOND_CONFIG, THIRD_CONFIG] = fixtureConfigs as [GameConfig, GameConfig, GameConfig];

const member: FetchScript = {
  "GET /api/v1/me": [jsonResponse(200, fixtureMemberSession)],
  [STREAK]: [jsonResponse(200, fixtureStreak)],
  // Two pages: the read follows next_cursor.
  [CONFIGS]: [
    jsonResponse(200, { items: [FIRST_CONFIG, SECOND_CONFIG], next_cursor: "page-2" }),
    jsonResponse(200, { items: [THIRD_CONFIG], next_cursor: null }),
  ],
};

function resetStores(): void {
  for (const slot of COSMETIC_SLOTS) useCosmeticsStore.getState().equip(slot, null);
  const defaults = useSessionDefaultsStore.getState();
  defaults.setGrouping("standard");
  defaults.setRng(false);
  defaults.setConfigScope(ALL_CONFIGS);
}

beforeEach(() => {
  resetStores();
  defaultHotkeyStore.getState().setOverlayOpen(false);
});

afterEach(() => {
  resetStores();
  document.documentElement.removeAttribute(FELT_ATTRIBUTE);
});

describe("R4.12 /settings session defaults", () => {
  it("R4.12 grouping and Mixed-frequency mode save to the store at once and say so; the mode is off by default (O-344)", async () => {
    const user = userEvent.setup();
    renderApp("/settings", member);

    const defaults = await screen.findByRole("region", { name: "Session defaults" });
    expect(screen.getByText("The builder schedule is for admins.")).toBeInTheDocument();
    await user.click(within(defaults).getByRole("radio", { name: "Simple" }));
    expect(useSessionDefaultsStore.getState().defaults.grouping).toBe("simple");
    expect(within(defaults).getByRole("status")).toHaveTextContent("Saved on this browser.");
    expect(within(defaults).getByRole("checkbox", { name: "Mixed-frequency mode" })).not.toBeChecked();
    await user.click(within(defaults).getByRole("checkbox", { name: "Mixed-frequency mode" }));
    expect(useSessionDefaultsStore.getState().defaults.rng).toBe(true);
  });

  it("R4.12 a chosen configuration scope follows the paged list and saves each tick in catalog order", async () => {
    const user = userEvent.setup();
    const { fake } = renderApp("/settings", member);

    const defaults = await screen.findByRole("region", { name: "Session defaults" });
    expect(fake.keys()).not.toContain(CONFIGS);
    await user.click(within(defaults).getByRole("radio", { name: "Only the configurations I choose" }));
    const list = await within(defaults).findByRole("list", { name: "Configurations to train" });
    expect(within(list).getAllByRole("checkbox")).toHaveLength(3);
    expect(fake.keys().filter((key) => key === CONFIGS)).toHaveLength(2);
    expect(within(defaults).getByText(/Choose at least one configuration/)).toBeInTheDocument();
    expect(useSessionDefaultsStore.getState().defaults.configScope).toBe(ALL_CONFIGS);

    await user.click(within(list).getByRole("checkbox", { name: "Live, 9 players, 100 bb deep, stakes 1/3" }));
    await user.click(within(list).getByRole("checkbox", { name: "Online, 6 players, 100 bb deep, stakes online" }));
    expect(useSessionDefaultsStore.getState().defaults.configScope).toEqual([FIRST_CONFIG.config_id, THIRD_CONFIG.config_id]);

    await user.click(within(list).getByRole("checkbox", { name: "Online, 6 players, 100 bb deep, stakes online" }));
    await user.click(within(list).getByRole("checkbox", { name: "Live, 9 players, 100 bb deep, stakes 1/3" }));
    expect(useSessionDefaultsStore.getState().defaults.configScope).toBe(ALL_CONFIGS);

    await user.click(within(list).getByRole("checkbox", { name: /200 bb deep/ }));
    await user.click(within(defaults).getByRole("radio", { name: "All covered configurations" }));
    expect(useSessionDefaultsStore.getState().defaults.configScope).toBe(ALL_CONFIGS);
    expect(within(defaults).queryByRole("list", { name: "Configurations to train" })).toBeNull();
  });

  it("R4.12 saved ids the catalog no longer offers are named and can be removed", async () => {
    const user = userEvent.setup();
    useSessionDefaultsStore.getState().setConfigScope(["cfg_6_online_999", FIRST_CONFIG.config_id]);
    renderApp("/settings", member);

    const defaults = await screen.findByRole("region", { name: "Session defaults" });
    expect(await within(defaults).findByText("Saved configurations no longer offered: cfg_6_online_999.")).toBeInTheDocument();
    await user.click(within(defaults).getByRole("button", { name: "Remove them" }));
    expect(useSessionDefaultsStore.getState().defaults.configScope).toEqual([FIRST_CONFIG.config_id]);
  });

  it("R4.12 at 32 chosen configurations (the api's cap) the others cannot be ticked", async () => {
    const many = Array.from({ length: MAX_SCOPE_CONFIGS + 1 }, (_, index) => ({ ...FIRST_CONFIG, config_id: `cfg_6_online_${index + 1}`, depth_cbb: (index + 1) * 100 }));
    useSessionDefaultsStore.getState().setConfigScope(many.slice(0, MAX_SCOPE_CONFIGS).map((config) => config.config_id));
    renderApp("/settings", { ...member, [CONFIGS]: [jsonResponse(200, { items: many, next_cursor: null })] });

    const defaults = await screen.findByRole("region", { name: "Session defaults" });
    expect(await within(defaults).findByText("At most 32 configurations can be chosen.")).toBeInTheDocument();
    expect(within(defaults).getByRole("checkbox", { name: /, 33 bb deep/ })).toBeDisabled();
    expect(within(defaults).getByRole("checkbox", { name: /, 32 bb deep/ })).toBeEnabled();
  });

  it("R4.12 a failed or empty configuration read says so, and Try again reloads it", async () => {
    const user = userEvent.setup();
    useSessionDefaultsStore.getState().setConfigScope([FIRST_CONFIG.config_id]);
    renderApp("/settings", { ...member, [CONFIGS]: [problemResponse(500, "internal"), jsonResponse(200, { items: [], next_cursor: null })] });

    const defaults = await screen.findByRole("region", { name: "Session defaults" });
    expect(await within(defaults).findByRole("alert")).toHaveTextContent("The configurations could not be loaded.");
    await user.click(within(defaults).getByRole("button", { name: "Try again: the configurations" }));
    expect(await within(defaults).findByText("No configurations are in the catalog yet.")).toBeInTheDocument();
  });
});

describe("R4.14 /settings cosmetics", () => {
  it("R4.14 unlocked items are selectable; locked items are disabled and named with their unlock rule", async () => {
    renderApp("/settings", member);

    const cosmetics = await screen.findByRole("region", { name: "Cosmetics" });
    expect(cosmetics).toHaveTextContent("Cosmetics change only how the app looks; they never change training.");
    const backs = await within(cosmetics).findByRole("group", { name: "Card back" });
    expect(within(backs).getByRole("radio", { name: /^None/ })).toBeChecked();
    expect(within(backs).getByRole("radio", { name: /Fourteen-day streak card back/ })).toBeEnabled();
    const sixty = within(backs).getByRole("radio", { name: /Sixty-day streak card back/ });
    expect(sixty).toBeDisabled();
    expect(sixty).toHaveAccessibleDescription("Locked: Reach a 60-day streak");
    const felts = within(cosmetics).getByRole("group", { name: "Table felt" });
    expect(within(felts).getByRole("radio", { name: /Tier V felt/ })).toBeDisabled();
    expect(within(felts).getByText("Locked: Reach Tier V")).toBeInTheDocument();
    expect(within(cosmetics).getByRole("group", { name: "Badge" })).toBeInTheDocument();
  });

  it("R4.14 choosing an unlocked felt saves it and applies it across the app", async () => {
    const user = userEvent.setup();
    renderApp("/settings", member);

    const felts = await screen.findByRole("group", { name: "Table felt" });
    await user.click(within(felts).getByRole("radio", { name: /Tier III felt/ }));
    expect(useCosmeticsStore.getState().choices.felt).toBe("felt-tier-III");
    await waitFor(() => expect(document.documentElement.getAttribute(FELT_ATTRIBUTE)).toBe("felt-tier-III"));
    await user.click(within(felts).getByRole("radio", { name: /^None/ }));
    expect(useCosmeticsStore.getState().choices.felt).toBeNull();
    await waitFor(() => expect(document.documentElement.hasAttribute(FELT_ATTRIBUTE)).toBe(false));
  });

  it("R4.14 a stored choice that is not unlocked shows None as the effective choice", async () => {
    useCosmeticsStore.getState().equip("card-back", "card-back-streak-60");
    renderApp("/settings", member);

    const backs = await screen.findByRole("group", { name: "Card back" });
    expect(within(backs).getByRole("radio", { name: /^None/ })).toBeChecked();
  });

  it("R4.14 a failed unlock read says so and Try again loads the slots", async () => {
    const user = userEvent.setup();
    renderApp("/settings", { ...member, [STREAK]: [problemResponse(500, "internal"), jsonResponse(200, fixtureStreak)] });

    const cosmetics = await screen.findByRole("region", { name: "Cosmetics" });
    expect(await within(cosmetics).findByRole("alert")).toHaveTextContent("Your unlocks could not be loaded.");
    await user.click(within(cosmetics).getByRole("button", { name: "Try again: your unlocks" }));
    expect(await within(cosmetics).findByRole("group", { name: "Badge" })).toBeInTheDocument();
  });
});

describe("R4.12 /settings hotkeys and layout", () => {
  it("R4.12 the hotkeys table lists the trainer and app shortcuts, read only, without the retired S and U keys (O-327, O-345)", async () => {
    renderApp("/settings", member);

    const hotkeys = await screen.findByRole("region", { name: "Hotkeys" });
    const rows = within(within(hotkeys).getByRole("table", { name: "Keyboard shortcuts" })).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["1 to 9", "N", "E", "I", "?"]);
    expect(rows[0]).toHaveTextContent("Choose an action and submit it");
    expect(rows[1]).toHaveTextContent("Next hand");
    expect(rows[2]).toHaveTextContent("End session");
    expect(rows[3]).toHaveTextContent("How Mixed-frequency mode works");
    expect(hotkeys).not.toHaveTextContent("Unsure");
    expect(hotkeys).toHaveTextContent("Rebinding keys comes in a later version.");
    expect(within(hotkeys).queryByRole("button")).toBeNull();
  });

  it("R4.12 an admin sees the builder schedule above the S32 sections", async () => {
    renderApp("/settings", { ...member, "GET /api/v1/me": [sessionResponse()] });

    expect(await screen.findByRole("region", { name: "Session defaults" })).toBeInTheDocument();
    expect(screen.queryByText("The builder schedule is for admins.")).toBeNull();
    expect(screen.getByRole("region", { name: "Cosmetics" })).toBeInTheDocument();
  });
});
