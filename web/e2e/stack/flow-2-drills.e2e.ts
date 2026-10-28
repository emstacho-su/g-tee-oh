/**
 * Flow 2 (A7 section 5): build a drill from scratch, save, export, import the export, and run it,
 * on the compose stack with the fixture library (S26, R3.14, O-310, ADR 0018). Part of the stack
 * project, so just e2e and the CI e2e job run it; without E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD
 * it skips like flow-4-rng.e2e.ts.
 *
 * Mechanism: the steps of support/flow-2.ts, the same ones the mocked twin
 * (e2e/mock/flow-2-drills.e2e.ts) runs. The drill is "RFI boundary hands" with hands set to close
 * decisions: online 6-handed at 100 bb (the synthetic fixture set cfg_6_online_100), stake online,
 * hero BTN against any opponent, preflop action RFI, stop rule Spot. Lane C ran this filter against
 * the fixture library through the acceptance runner and POST /sessions answered 201 with a prompt
 * from GET /next, so no manual hand list fallback is needed. The run opens the imported copy with
 * a committed seed (O-288), so the hand sequence repeats on every run. The per-run owner is fresh
 * (infra/compose/e2e.mjs), so the library holds only this flow's two drills.
 *
 * When SCREENSHOT_DIR is set the flow captures the filled builder and the export dialog at the
 * desktop width in the light theme, merged into the manifest with session S26 and source stack.
 */
import { test } from "@playwright/test";

import { buildRfiDrill, expectImportedTwin, exportCode, importCode, openDrillLibrary, runAndSeePrompt, type Flow2Shooter } from "../support/flow-2.js";
import { ownerCredentials } from "../support/owner-credentials.js";
import { mergeShotManifest, shotDirectory, type ShotRecord } from "../support/shot-manifest.js";
import { capture, DESKTOP, prepareShotPage } from "../support/shots.js";
import { signIn } from "../support/sign-in-flow.js";

const credentials = ownerCredentials(process.env);
const SKIP_REASON = "Flow 2 needs E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD; just e2e creates the owner and sets both";
const SHOTS = (process.env["SCREENSHOT_DIR"] ?? "") !== "";
const OUT_DIR = shotDirectory();
const SESSION = "S26";
const SOURCE = "stack";
const THEME = "light";
/** The committed replay seed (O-288): 16 hex digits. */
const FLOW_SEED = "5eed00000000f102";
const FLOW_TIMEOUT_MS = 180_000;

const records: ShotRecord[] = [];

test.afterAll(() => {
  if (SHOTS) mergeShotManifest(OUT_DIR, SESSION, records);
});

test("R3.14 flow 2: build RFI boundary hands, save, export, import the export and run the import on the stack", async ({ page }) => {
  test.skip(credentials === undefined, SKIP_REASON);
  test.setTimeout(FLOW_TIMEOUT_MS);
  if (credentials === undefined) return;
  await prepareShotPage(page, THEME, DESKTOP);
  const shot: Flow2Shooter = async (screen, criterion) => {
    if (!SHOTS) return;
    records.push(await capture(page, page, OUT_DIR, { screen, theme: THEME, viewport: DESKTOP, criterion, source: SOURCE }));
  };
  await signIn(page, credentials);
  await buildRfiDrill(page, shot);
  await openDrillLibrary(page);
  const code = await exportCode(page, shot);
  const importedId = await importCode(page, code);
  await expectImportedTwin(page);
  await runAndSeePrompt(page, importedId, FLOW_SEED);
});
