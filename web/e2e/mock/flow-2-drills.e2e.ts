/**
 * Flow 2 against the mocked api (S26, R3.14, O-264, O-310): the same steps as
 * e2e/stack/flow-2-drills.e2e.ts on the harness build under vite preview, with /api/v1 answered
 * by support/mock-app.ts (the drill store of mock-drills.ts and the sessions of mock-sessions.ts,
 * which start on any stored drill through drillOf). It runs locally, where the compose stack
 * cannot build, and in the CI e2e job's mocked step before the stack flows.
 */
import { test } from "@playwright/test";

import { FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { FIXTURE_SEED } from "../../src/fixtures/trainer.js";
import { buildRfiDrill, expectImportedTwin, exportCode, importCode, openDrillLibrary, runAndSeePrompt } from "../support/flow-2.js";
import { installAppMockApi } from "../support/mock-app.js";
import { signIn } from "../support/sign-in-flow.js";

const OWNER = { email: FIXTURE_USER_EMAIL, password: "any-non-empty-password" };

test("R3.14 mock flow 2: build RFI boundary hands, save, export, import the export and run the import", async ({ page }) => {
  await installAppMockApi(page);
  await signIn(page, OWNER);
  await buildRfiDrill(page);
  await openDrillLibrary(page);
  const code = await exportCode(page);
  const importedId = await importCode(page, code);
  await expectImportedTwin(page);
  await runAndSeePrompt(page, importedId, FIXTURE_SEED);
});
