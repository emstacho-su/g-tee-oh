/**
 * The configuration scope picker's memory (S47, R4.12, O-486): "only the configurations I choose"
 * survives a reload with zero ticks (the stored scope stays "all", so the start body is unchanged),
 * and a saved id the catalog no longer offers is named by the label it had.
 */
import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { fixtureMemberSession } from "../../src/fixtures/index.js";
import { fixtureConfigs } from "../../src/fixtures/study.js";
import type { GameConfig } from "../../src/progress/types.js";
import { ALL_CONFIGS, CONFIG_LABELS_STORAGE_KEY, rememberConfigLabels, useSessionDefaultsStore } from "../../src/store/index.js";
import { jsonResponse, sessionResponse, type FetchScript } from "../api/fake-fetch.js";
import { renderApp } from "../app/render-app.js";

const CONFIGS = "GET /api/v1/configs";
const FIRST = fixtureConfigs[0] as GameConfig;
const STALE_ID = "cfg_6_online_999";
const member: FetchScript = {
  "GET /api/v1/me": [sessionResponse(fixtureMemberSession.csrf_token)],
  [CONFIGS]: [jsonResponse(200, { items: fixtureConfigs, next_cursor: null }), jsonResponse(200, { items: fixtureConfigs, next_cursor: null })],
};

afterEach(() => {
  useSessionDefaultsStore.getState().setScopeMode("all");
  window.localStorage.removeItem(CONFIG_LABELS_STORAGE_KEY);
});

describe("R4.12 the configuration scope keeps its mode and its labels (O-486)", () => {
  it("R4.12 the chosen mode survives a reload with zero ticks", async () => {
    const user = userEvent.setup();
    const first = renderApp("/settings/configurations", member);
    const scope = await screen.findByRole("region", { name: "Configuration scope" });
    await user.click(within(scope).getByRole("radio", { name: "Only the configurations I choose" }));
    await within(scope).findByRole("list", { name: "Configurations to train" });
    expect(useSessionDefaultsStore.getState().defaults).toMatchObject({ configScope: ALL_CONFIGS, scopeMode: "chosen" });
    first.unmount();
    renderApp("/settings/configurations", member);
    const again = await screen.findByRole("region", { name: "Configuration scope" });
    expect(within(again).getByRole("radio", { name: "Only the configurations I choose" })).toBeChecked();
    expect(await within(again).findByRole("list", { name: "Configurations to train" })).toBeInTheDocument();
  });

  it("R4.12 a stale id is named by its last label", async () => {
    rememberConfigLabels({ [STALE_ID]: "Online, 6 players, 999bb deep" });
    useSessionDefaultsStore.getState().setConfigScope([STALE_ID, FIRST.config_id]);
    renderApp("/settings/configurations", member);
    const scope = await screen.findByRole("region", { name: "Configuration scope" });
    expect(await within(scope).findByText("Saved configurations no longer offered: Online, 6 players, 999bb deep.")).toBeInTheDocument();
  });
});
