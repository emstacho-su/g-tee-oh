/** Tests for ConfidenceTap, the sure or unsure answer before any reveal (S24, R3.13). */
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfidenceTap } from "../../src/components/trainer/index.js";
import { HotkeyRoot, createHotkeyStore } from "../../src/hotkeys/index.js";

function renderTap(onChoose: (choice: "sure" | "unsure") => void, disabled = false) {
  return render(
    <HotkeyRoot store={createHotkeyStore()}>
      <ConfidenceTap onChoose={onChoose} disabled={disabled} />
    </HotkeyRoot>,
  );
}

describe("R3.13 ConfidenceTap", () => {
  it("R3.13 shows the instruction and two named buttons with their keys", () => {
    renderTap(vi.fn());
    expect(screen.getByTestId("confidence-tap")).toHaveTextContent("How sure are you? Answer before the reveal.");
    expect(screen.getByRole("button", { name: "Sure" })).toHaveAttribute("aria-keyshortcuts", "S");
    expect(screen.getByRole("button", { name: "Unsure" })).toHaveAttribute("aria-keyshortcuts", "U");
  });

  it("R3.13 clicks and the S and U keys report the choice", async () => {
    const onChoose = vi.fn();
    renderTap(onChoose);
    await userEvent.click(screen.getByRole("button", { name: "Sure" }));
    expect(onChoose).toHaveBeenLastCalledWith("sure");
    await userEvent.keyboard("u");
    expect(onChoose).toHaveBeenLastCalledWith("unsure");
    await userEvent.keyboard("s");
    expect(onChoose).toHaveBeenLastCalledWith("sure");
    expect(onChoose).toHaveBeenCalledTimes(3);
  });

  it("R3.13 disabled ignores clicks and keys", async () => {
    const onChoose = vi.fn();
    renderTap(onChoose, true);
    expect(screen.getByRole("button", { name: "Sure" })).toBeDisabled();
    await userEvent.keyboard("su");
    expect(onChoose).not.toHaveBeenCalled();
  });
});
