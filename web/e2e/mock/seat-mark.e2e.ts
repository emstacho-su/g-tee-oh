/**
 * The seat marks paint (S43 review round 2, finding 1; R3.13, O-432): the hero's accent mark and the
 * acting seat's focus mark are outlines, so the raised card's own box-shadow cannot replace them, as
 * it did a Tailwind ring (both are box-shadow, and the raised utility is emitted later). jsdom has
 * no stylesheet, so this mock-project spec reads the computed style in a real browser, in both
 * themes, on the gallery's tables: the 6-seat hero on the button is acting (the focus mark; its
 * accent border stays), and the 9-seat hero in the cutoff is not (the accent mark).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

const THEMES = ["light", "dark"] as const;
const MARK_WIDTH = "2px";
const MARK_OFFSET = "2px";

/** A token resolved to the computed rgb() the browser paints it as. */
async function paintedColour(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);
}

async function markOf(seat: Locator): Promise<{ style: string; width: string; offset: string; colour: string; shadow: string }> {
  return seat.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth, offset: style.outlineOffset, colour: style.outlineColor, shadow: style.boxShadow };
  });
}

for (const theme of THEMES) {
  test(`R3.13 O-432 ${theme}: the acting seat paints the focus mark and the hero the accent mark, beside the raised shadow`, async ({ page }) => {
    await page.goto(`/gallery.html?theme=${theme}`);
    const acting = page.getByTestId("gallery-poker-table-6").getByTestId("seat-BTN");
    const hero = page.getByTestId("gallery-poker-table-9").getByTestId("seat-CO");
    await expect(acting).toHaveAttribute("data-active", "true");
    await expect(hero).toHaveAttribute("data-hero", "true");
    await expect(hero).toHaveAttribute("data-active", "false");

    const actingMark = await markOf(acting);
    expect(actingMark).toMatchObject({ style: "solid", width: MARK_WIDTH, offset: MARK_OFFSET, colour: await paintedColour(page, "--focus") });
    const heroMark = await markOf(hero);
    expect(heroMark).toMatchObject({ style: "solid", width: MARK_WIDTH, offset: MARK_OFFSET, colour: await paintedColour(page, "--accent") });
    // The raised depth is still there: the mark composes with it instead of replacing it.
    for (const mark of [actingMark, heroMark]) expect(mark.shadow).not.toBe("none");
    expect(actingMark.colour).not.toBe(heroMark.colour);
  });
}
