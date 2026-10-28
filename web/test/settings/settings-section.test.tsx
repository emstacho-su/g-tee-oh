/**
 * The /settings section frame (S32, R4.12): a region labelled by its heading, with the optional
 * description shown only when given.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SettingsSection } from "../../src/routes/settings/SettingsSection.js";

describe("R4.12 SettingsSection", () => {
  it("R4.12 labels the region by its heading and shows the description when given", () => {
    render(
      <SettingsSection title="Cosmetics" description="Equip what you have unlocked.">
        <p>body</p>
      </SettingsSection>,
    );
    expect(screen.getByRole("region", { name: "Cosmetics" })).toBeInTheDocument();
    expect(screen.getByText("Equip what you have unlocked.")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("R4.12 leaves the description out when none is given", () => {
    render(
      <SettingsSection title="Hotkeys">
        <p>keys</p>
      </SettingsSection>,
    );
    const region = screen.getByRole("region", { name: "Hotkeys" });
    expect(region.querySelectorAll("p")).toHaveLength(1);
  });
});
