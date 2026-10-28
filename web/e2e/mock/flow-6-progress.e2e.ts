/**
 * Flow 6 against the mocked api (S32, R4.12, O-264, O-321): the steps of
 * e2e/stack/flow-6-progress.e2e.ts on the harness build under vite preview, with /api/v1 answered
 * by support/mock-app.ts (the seasoned learner of src/fixtures/progress.ts, S26's drill store and
 * the study catalog's configs). The fixtures fix the counts: ten trend rows, forty heat map cells
 * with never-practiced and mastered ones. A heat map cell opens a drill run screen; going back and
 * clicking the same cell opens the same drill, since the auto drill is found by its tag the
 * second time (never more than one per class).
 */
import { expect, test } from "@playwright/test";

import { FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { expectHeatCells, expectTrendRows, openDrillFromCell, openProgress, expectScreenReaderTables } from "../support/flow-6.js";
import { installAppMockApi } from "../support/mock-app.js";
import { signIn } from "../support/sign-in-flow.js";

const OWNER = { email: FIXTURE_USER_EMAIL, password: "any-non-empty-password" };
const TREND_ROWS = 10;
const HEAT_CELLS = 40;
/** A practiced class the live 9-handed 1/3 configuration seats. */
const DRILLED_CELL = /^rfi BB-UTG, live 100 bb:/;

test("R4.12 mock flow 6: /progress draws the leak trend and the heat map, checks both screen-reader tables and opens a drill from a cell", async ({ page }) => {
  await installAppMockApi(page);
  await signIn(page, OWNER);
  await openProgress(page);

  expect(await expectTrendRows(page)).toBe(TREND_ROWS);
  await expect(page.getByTestId("leak-partial-marker")).toHaveCount(TREND_ROWS);
  expect(await expectHeatCells(page)).toBe(HEAT_CELLS);
  await expect(page.locator('[data-testid="heat-cell"][data-state="new"]').first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Mastered: yes/ }).first()).toBeVisible();

  await expectScreenReaderTables(page, TREND_ROWS, HEAT_CELLS);

  const first = await openDrillFromCell(page, page.getByRole("button", { name: DRILLED_CELL }));
  await openProgress(page);
  await expectHeatCells(page);
  const second = await openDrillFromCell(page, page.getByRole("button", { name: DRILLED_CELL }));
  expect(second).toBe(first);
});
