/**
 * Tests for returning to Study (S45, R3.27, O-460): the last confirmed spot seeds a bare /study (the
 * address stays the source of truth, so any setting in the address wins), Start over forgets it, a
 * star on the summary line toggles the spot, the settings panel offers "Your spots" and "Recent
 * spots" inline with one-line empty states, a pick opens that spot, the panel fills a lower field
 * that has exactly one choice and counts the covered pairs, and the library's coverage heading and
 * the Home card reach the same spots.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { FIXTURE_ONLINE_STAKE_ID, FIXTURE_STUDY_PAIR } from "../../src/fixtures/study.js";
import { useStudySpotsStore } from "../../src/store/study-spots.js";
import { SPOT_TEXT } from "../../src/routes/study/SpotShortcuts.js";
import { renderStudy } from "./render-study.js";

const SETTINGS = `format=online&table_size=6&stake=${FIXTURE_ONLINE_STAKE_ID}&depth=10000&pair=${FIXTURE_STUDY_PAIR}`;
const BASE = `/study?${SETTINGS}`;
const SPOT = { format: "online", table_size: 6, stake: FIXTURE_ONLINE_STAKE_ID, depth: 10000, pair: FIXTURE_STUDY_PAIR } as const;
const SUMMARY = "Online, 6 players, online (5% rake, cap $1.50), 100bb, BTN against BB";

let spies: { mockRestore: () => void }[] = [];

beforeEach(() => {
  spies = [
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null),
    vi.spyOn(console, "info").mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  spies.forEach((spy) => spy.mockRestore());
});

describe("R3.27 Study reopens on the last spot", () => {
  it("R3.27 a confirmed spot is remembered and a bare /study replaces to it", async () => {
    const first = renderStudy(`${BASE}&line=r250&mode=ev`);
    await screen.findByText(`${SUMMARY}, single-raised pot`);
    await waitFor(() => expect(useStudySpotsStore.getState().last).toMatchObject({ ...SPOT, line: "r250", mode: "ev" }));
    first.unmount();
    const { router } = renderStudy("/study");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ pair: FIXTURE_STUDY_PAIR, line: "r250", mode: "ev" }));
    expect(router.history.length).toBe(1);
    expect(await screen.findByRole("img", { name: /expected value mode/ })).toBeInTheDocument();
  });

  it("R3.27 after a reopen, the nav Study link (a bare /study on the same page) reopens again, never a stuck note (code review 2)", async () => {
    const user = userEvent.setup();
    useStudySpotsStore.getState().recordConfirmed({ ...SPOT, line: "r250" });
    const { router } = renderStudy("/study");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ pair: FIXTURE_STUDY_PAIR, line: "r250" }));
    await screen.findByRole("img", { name: /^Range matrix/ });
    await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Study" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ pair: FIXTURE_STUDY_PAIR, line: "r250" }));
    expect(await screen.findByRole("img", { name: /^Range matrix/ })).toBeInTheDocument();
    expect(screen.queryByText("Opening your last spot.")).not.toBeInTheDocument();
  });

  it("R3.27 a bare /study with a matrix mode keeps that mode over the stored spot's (code review 2)", async () => {
    useStudySpotsStore.getState().recordConfirmed({ ...SPOT, mode: "ev" });
    const { router } = renderStudy("/study?mode=weight");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ pair: FIXTURE_STUDY_PAIR, mode: "weight" }));
    expect(await screen.findByRole("img", { name: /range weight mode/ })).toBeInTheDocument();
  });

  it("R3.27 Start over shows only on the reopened spot, not on a later one (code review 2)", async () => {
    const user = userEvent.setup();
    useStudySpotsStore.getState().recordConfirmed(SPOT);
    renderStudy("/study");
    expect(await screen.findByRole("button", { name: SPOT_TEXT.startOver })).toBeInTheDocument();
    const actions = await screen.findByRole("region", { name: /'s actions$/ });
    await user.click(within(actions).getByRole("button", { name: /^Raise to 2\.5bb/ }));
    await screen.findByText(`${SUMMARY}, single-raised pot`);
    expect(screen.queryByRole("button", { name: SPOT_TEXT.startOver })).not.toBeInTheDocument();
  });

  it("R3.27 a spot is recorded once per spot and line, not on every re-render (code review 2)", async () => {
    const user = userEvent.setup();
    const original = useStudySpotsStore.getState().recordConfirmed;
    const record = vi.fn();
    useStudySpotsStore.setState({ recordConfirmed: record });
    onTestFinished(() => useStudySpotsStore.setState({ recordConfirmed: original }));
    renderStudy(BASE);
    await screen.findByRole("img", { name: /^Range matrix/ });
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("radio", { name: "EV" }));
    await screen.findByRole("img", { name: /expected value mode/ });
    await user.click(screen.getByRole("radio", { name: "Range weight" }));
    await screen.findByRole("img", { name: /range weight mode/ });
    expect(record).toHaveBeenCalledTimes(1);
    const actions = await screen.findByRole("region", { name: /'s actions$/ });
    await user.click(within(actions).getByRole("button", { name: /^Raise to 2\.5bb/ }));
    await waitFor(() => expect(record).toHaveBeenCalledTimes(2));
  });

  it("R3.27 any setting in the address wins over the stored spot", async () => {
    useStudySpotsStore.getState().recordConfirmed({ ...SPOT, line: "r250" });
    const { router } = renderStudy("/study?format=live");
    expect(await screen.findByRole("region", { name: "Spot settings" })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ format: "live" });
  });

  it("R3.27 Start over forgets the stored spot and shows the empty panel", async () => {
    const user = userEvent.setup();
    useStudySpotsStore.getState().recordConfirmed(SPOT);
    const { router } = renderStudy("/study");
    await user.click(await screen.findByRole("button", { name: SPOT_TEXT.startOver }));
    expect(await screen.findByRole("region", { name: "Spot settings" })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({});
    expect(useStudySpotsStore.getState().last).toBeNull();
  });
});

describe("R3.27 starred and recent spots", () => {
  it("R3.27 the summary's star toggles the spot with aria-pressed", async () => {
    const user = userEvent.setup();
    renderStudy(BASE);
    const star = await screen.findByRole("button", { name: SPOT_TEXT.star });
    expect(star).toHaveAttribute("aria-pressed", "false");
    await user.click(star);
    expect(screen.getByRole("button", { name: SPOT_TEXT.star })).toHaveAttribute("aria-pressed", "true");
    expect(useStudySpotsStore.getState().starred).toEqual([SPOT]);
  });

  it("R3.27 the empty panel says there are no starred or recent spots yet", async () => {
    renderStudy("/study");
    const panel = await screen.findByRole("region", { name: "Spot settings" });
    expect(within(panel).getByText(SPOT_TEXT.noStarred)).toBeInTheDocument();
    expect(within(panel).getByText(SPOT_TEXT.noRecent)).toBeInTheDocument();
  });

  it("R3.27 Your spots and Recent spots sit inline in the panel and a pick opens that spot", async () => {
    const user = userEvent.setup();
    useStudySpotsStore.getState().toggleStar(SPOT);
    useStudySpotsStore.getState().recordConfirmed({ ...SPOT, line: "r250" });
    useStudySpotsStore.getState().clearLast();
    const { router } = renderStudy("/study");
    const panel = await screen.findByRole("region", { name: "Spot settings" });
    const yours = within(panel).getByRole("list", { name: SPOT_TEXT.yourSpots });
    const recent = within(panel).getByRole("list", { name: SPOT_TEXT.recentSpots });
    // The labels name the stake once the stakes have loaded.
    expect(await within(yours).findByRole("link", { name: SUMMARY })).toBeInTheDocument();
    await user.click(await within(recent).findByRole("link", { name: `${SUMMARY}, single-raised pot` }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ pair: FIXTURE_STUDY_PAIR, line: "r250" }));
  });
});

describe("R3.27 the settings panel helps", () => {
  it("R3.27 choosing Live fills the table size, stake and depth that have one choice each", async () => {
    const user = userEvent.setup();
    renderStudy("/study");
    await user.click(await screen.findByRole("radio", { name: "Live" }));
    const size = screen.getByRole("radiogroup", { name: "Table size" });
    expect(within(size).getByRole("radio", { name: /^9 players/ })).toHaveAttribute("aria-checked", "true");
    const depth = await screen.findByRole("radiogroup", { name: "Depth" });
    expect(within(depth).getByRole("radio", { name: /^100bb/ })).toHaveAttribute("aria-checked", "true");
  });

  it("R3.27 the panel counts the covered pairs at the chosen settings", async () => {
    const user = userEvent.setup();
    renderStudy(BASE);
    await user.click(await screen.findByRole("button", { name: "Change settings" }));
    expect(await screen.findByText("2 covered pairs at these settings")).toBeInTheDocument();
  });
});
