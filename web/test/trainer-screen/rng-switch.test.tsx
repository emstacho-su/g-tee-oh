/**
 * The start panel's RNG switch asks the explainer to open on first use (S25, R3.10, O-283), and a
 * session with RNG on asks again at its first prompt. Lane C's useRngExplainer is replaced by a
 * spy here, so this proves only the screen's side of the seam.
 */
import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { fixtureDrill, fixtureRngPrompt } from "../../src/fixtures/trainer.js";
import { jsonResponse } from "../api/fake-fetch.js";
import { NEXT_PATH, renderRun } from "./render-run.js";

const control = vi.hoisted(() => ({ showIfFirstUse: vi.fn(), setOpen: vi.fn(), hotkey: [] as (boolean | undefined)[] }));

vi.mock("../../src/components/trainer/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/components/trainer/index.js")>();
  return {
    ...original,
    useRngExplainer: (options: { hotkey?: boolean } = {}) => {
      control.hotkey.push(options.hotkey);
      return { open: false, setOpen: control.setOpen, showIfFirstUse: control.showIfFirstUse };
    },
  };
});

describe("R3.10 RNG switch and the explainer's first use", () => {
  it("R3.10 switching RNG on asks for the first-use explainer; switching it off does not", async () => {
    renderRun({ script: {} });
    await screen.findByRole("heading", { name: fixtureDrill.name });
    const rngSwitch = screen.getByRole("switch", { name: "RNG mode" });
    await userEvent.click(rngSwitch);
    expect(control.showIfFirstUse).toHaveBeenCalledTimes(1);
    await userEvent.click(rngSwitch);
    expect(control.showIfFirstUse).toHaveBeenCalledTimes(1);
    expect(control.hotkey.at(-1)).toBe(false);
  });

  it("R3.10 the first prompt with a roll asks again and the I hotkey is on while RNG is on", async () => {
    control.showIfFirstUse.mockClear();
    renderRun({ script: { [NEXT_PATH]: [jsonResponse(200, fixtureRngPrompt)] } });
    await screen.findByRole("heading", { name: fixtureDrill.name });
    await userEvent.click(screen.getByRole("switch", { name: "RNG mode" }));
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    await screen.findByTestId("roll-badge");
    expect(control.showIfFirstUse).toHaveBeenCalledTimes(2);
    expect(control.hotkey.at(-1)).toBe(true);
  });
});
