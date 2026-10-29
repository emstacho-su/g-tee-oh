/**
 * The steps of flow 2 (A7 section 5, S26, R3.14, O-310), shared by the stack flow and its mock
 * twin: build "RFI boundary hands" from scratch in the builder, save it, open the library, export
 * it and read the code, import the code, see the imported drill with the same spot summary, run
 * the imported drill with a fixed seed, start, and see a prompt with action buttons.
 *
 * Mechanism: every step drives the screens through their visible, labeled controls only (the
 * accessible names the component tests pin). The drill is online 6-handed at 100 bb, stake
 * online, hero BTN against any opponent, preflop action RFI, close decisions, stop rule Spot;
 * lane C confirmed that this filter finds BTN RFI spots in the fixture library (cfg_6_online_100),
 * so the stack flow uses close decisions as well. The imported drill's id is read from the POST
 * /drills/import answer, so the run opens exactly the imported copy, never its source. Since S40
 * (O-404, O-405) the builder's sections are pages reached through its "Drill sections" list, and
 * the library acts on the drill selected in its table through the "Selected drill" toolbar.
 */
import { expect, type Page } from "@playwright/test";

export const FLOW_2_DRILL_NAME = "RFI boundary hands";
const HTTP_CREATED = 201;
const IMPORT_PATH = "/api/v1/drills/import";
/** A stored drill's builder page (S40, O-405): /drills/<id>/<section>. */
const DRILL_PAGE = /^\/drills\/[0-9a-f-]{36}\/[a-z]+$/;

export interface Flow2Shooter {
  (screen: string, criterion: string): Promise<void>;
}

const NO_SHOTS: Flow2Shooter = () => Promise.resolve();

/** Opens a builder page through the "Drill sections" list (S40, O-405); one draft spans the pages. */
export async function openBuilderPage(page: Page, label: string): Promise<void> {
  const link = page.getByRole("navigation", { name: "Drill sections" }).getByRole("link", { name: new RegExp(`^${label}`) });
  await link.click();
  await expect(link).toHaveAttribute("aria-current", "page");
}

export async function buildRfiDrill(page: Page, shot: Flow2Shooter = NO_SHOTS): Promise<void> {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "New drill" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New drill" })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill(FLOW_2_DRILL_NAME);
  await openBuilderPage(page, "Game");
  await page.getByRole("group", { name: "Format" }).getByRole("radio", { name: "Online" }).check();
  await page.getByLabel("Table size", { exact: true }).selectOption("6");
  await page.getByLabel("Depths (bb)").fill("100");
  await page.getByLabel("Stake", { exact: true }).selectOption("online");
  await openBuilderPage(page, "Seats");
  await page.getByRole("group", { name: "Hero positions" }).getByRole("checkbox", { name: "BTN" }).check();
  const villains = page.getByRole("group", { name: "Villain positions" }).getByRole("checkbox", { checked: true });
  await expect(villains).toHaveCount(0);
  await page.getByRole("group", { name: "Preflop action" }).getByRole("checkbox", { name: /^RFI/ }).check();
  await openBuilderPage(page, "Hands");
  await page.getByRole("group", { name: "Hands to train" }).getByRole("radio", { name: /Close decisions/ }).check();
  await openBuilderPage(page, "Trainer");
  await page.getByRole("group", { name: "Stop rule" }).getByRole("radio", { name: /^Spot/ }).check();
  await shot("flow2-builder-filled", "R3.14 flow 2: RFI boundary hands built from scratch in the builder");
  await page.getByRole("button", { name: "Save drill" }).click();
  await expect(page).toHaveURL((url) => DRILL_PAGE.test(url.pathname));
  await expect(page.getByTestId("builder-status")).toHaveText("Drill saved.");
}

export async function openDrillLibrary(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Drills", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Drill library" })).toBeVisible();
}

/** Selects the drill's row, opens the toolbar's export dialog, reads the code and closes the dialog. */
export async function exportCode(page: Page, shot: Flow2Shooter = NO_SHOTS): Promise<string> {
  await page.getByRole("radio", { name: `Select ${FLOW_2_DRILL_NAME}` }).first().check();
  await page.getByRole("group", { name: "Selected drill" }).getByRole("button", { name: `Export ${FLOW_2_DRILL_NAME}` }).click();
  const dialog = page.getByRole("dialog", { name: `Export code: ${FLOW_2_DRILL_NAME}` });
  const field = dialog.getByLabel("Export code");
  await expect(field).toHaveValue(/^gteeoh1\./);
  await shot("flow2-export", "R3.14 O-310 flow 2: the export code in a read-only field with Copy");
  const code = await field.inputValue();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  return code;
}

/** Imports the code through the dialog and returns the imported drill's id. */
export async function importCode(page: Page, code: string): Promise<string> {
  await page.getByRole("button", { name: "Import a drill" }).click();
  const dialog = page.getByRole("dialog", { name: "Import a drill" });
  await dialog.getByLabel("Export code").fill(code);
  const answer = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === IMPORT_PATH);
  await dialog.getByRole("button", { name: "Import" }).click();
  const response = await answer;
  expect(response.status(), "POST /drills/import").toBe(HTTP_CREATED);
  await expect(page.getByTestId("library-status")).toHaveText(`Imported ${FLOW_2_DRILL_NAME}.`);
  return ((await response.json()) as { id: string }).id;
}

/** Both drills named RFI boundary hands are listed, the import first, with one spot summary. */
export async function expectImportedTwin(page: Page): Promise<void> {
  const rows = page.getByTestId("drill-row").filter({ has: page.getByRole("rowheader", { name: FLOW_2_DRILL_NAME, exact: true }) });
  await expect(rows).toHaveCount(2);
  const summaries = await rows.getByTestId("spot-summary").allTextContents();
  expect(summaries[0]).toContain("hero BTN against any opponent; RFI; close decisions");
  expect(summaries[0]).toBe(summaries[1]);
}

export async function runAndSeePrompt(page: Page, drillId: string, seed: string): Promise<void> {
  await page.goto(`/drills/${drillId}/run?seed=${seed}`);
  await expect(page.getByRole("heading", { name: FLOW_2_DRILL_NAME })).toBeVisible();
  await page.getByRole("button", { name: "Start session" }).click();
  const actions = page.getByRole("group", { name: "Actions" });
  await expect(actions).toBeVisible();
  await expect(actions.getByRole("button").first()).toBeVisible();
}
