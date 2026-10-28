/**
 * The drill acceptance runner (R3.15, O-315, O-67, O-244): every drill of an acceptance file is
 * expressed in the drill schema and run against a library, one test per case named
 * "R3.15 <case name>".
 *
 * The file is DRILL_ACCEPTANCE_FILE (absolute, or relative to the repository root), else the
 * synthetic drill set validation/fixtures/drills/synthetic-drill-set.json, so a plain vitest run
 * (just ts-test, CI) runs the synthetic set until the owner's build card exists (O-24, O-64).
 * just drill-acceptance FILE runs it on any file.
 *
 * A case passes when
 * - expressed: its drill parses with DrillCreate (src/schemas/drills.ts, with the SpotFilterWrite
 *   cross-field rules), and
 * - run: over the api built with the fixture solver-query (buildTrainerApp: the real binary over
 *   validation/fixtures/library, or SOLVER_QUERY_URL when set), POST /drills answers 201,
 *   POST /sessions in drill mode with a fixed seed answers 201, and GET /sessions/{id}/next answers
 *   200 with a body that parses as a TrainerPrompt and carries at least one button.
 * A failing case's message names the case, the step, the status and the problem detail only, never
 * a strategy number. The api's global rate limit is per client per minute, so the file's planned
 * requests are checked against it first (at most 64 cases of three requests each).
 */
import { randomUUID } from "node:crypto";

import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../../src/app.js";
import type { Database } from "../../src/db.js";
import { IDEMPOTENCY_HEADER } from "../../src/http/headers.js";
import { GLOBAL_RATE_LIMIT_MAX } from "../../src/http/rate-limits.js";
import { promptSchema } from "../../src/schemas/training.js";
import { mutatingHeaders, readHeaders } from "../support/app.js";
import { appDatabase, createTestSession, createTestUser, type TestSession } from "../support/database.js";
import { buildTrainerApp } from "../support/solver-query.js";
import { expressDrill, issueLines, loadAcceptanceFile, resolveAcceptancePath, type AcceptanceCase, type AcceptanceFile } from "./acceptance-file.js";

const API = "/api/v1";
const SESSION_SEED = "000000000acce515";
/** POST /drills, POST /sessions and GET /next per case. */
const REQUESTS_PER_CASE = 3;
const CASE_TIMEOUT_MS = 60_000;

const path = resolveAcceptancePath(process.env.DRILL_ACCEPTANCE_FILE);

function loaded(): { file: AcceptanceFile | null; error: Error | null } {
  try {
    return { file: loadAcceptanceFile(path), error: null };
  } catch (error: unknown) {
    return { file: null, error: error instanceof Error ? error : new Error(`the acceptance file ${path} could not be loaded`) };
  }
}

const { file, error: loadError } = loaded();

/** The problem detail of a response, or its title; nothing else of the body. */
function problemDetail(response: LightMyRequestResponse): string {
  try {
    const body = response.json<{ detail?: unknown; title?: unknown }>();
    const text = typeof body.detail === "string" ? body.detail : body.title;
    return typeof text === "string" ? text : "no problem detail";
  } catch {
    return "no problem detail";
  }
}

function stepFailure(entry: AcceptanceCase, step: string, response: LightMyRequestResponse): string {
  return `${entry.name}: ${step} answered ${response.statusCode}: ${problemDetail(response)}`;
}

describe(`R3.15 drill acceptance: ${path}`, () => {
  let database: Database;
  let app: ApiApp;
  let session: TestSession;

  beforeAll(async () => {
    database = appDatabase();
    app = buildTrainerApp(database);
    await app.ready();
    session = await createTestSession(database, (await createTestUser(database)).id);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  function write(): Record<string, string> {
    return { ...mutatingHeaders(session), [IDEMPOTENCY_HEADER]: randomUUID() };
  }

  async function runCase(entry: AcceptanceCase): Promise<void> {
    const expressed = expressDrill(entry.drill);
    if (!expressed.success) {
      expect.fail(`${entry.name}: the drill is not expressed in the drill schema: ${expressed.issues}`);
    }
    const drill = await app.inject({ method: "POST", url: `${API}/drills`, headers: write(), payload: expressed.drill });
    expect(drill.statusCode, stepFailure(entry, "POST /drills", drill)).toBe(201);
    const payload = { mode: "drill", drill_id: drill.json<{ id: string }>().id, seed: SESSION_SEED };
    const created = await app.inject({ method: "POST", url: `${API}/sessions`, headers: write(), payload });
    expect(created.statusCode, stepFailure(entry, "POST /sessions", created)).toBe(201);
    const sessionId = created.json<{ session_id: string }>().session_id;
    const next = await app.inject({ method: "GET", url: `${API}/sessions/${sessionId}/next`, headers: readHeaders(session) });
    expect(next.statusCode, stepFailure(entry, "GET /next", next)).toBe(200);
    const prompt = promptSchema.safeParse(next.json());
    if (!prompt.success) {
      expect.fail(`${entry.name}: GET /next answered a body that is not a TrainerPrompt: ${issueLines(prompt.error)}`);
    }
    expect(prompt.data.buttons.length, `${entry.name}: the prompt carries no buttons`).toBeGreaterThan(0);
  }

  it("R3.15 the acceptance file loads", () => {
    if (loadError !== null) throw loadError;
    expect(file?.cases.length).toBeGreaterThan(0);
  });

  it("R3.15 the file's requests stay under the api's per-minute limit", () => {
    expect((file?.cases.length ?? 0) * REQUESTS_PER_CASE).toBeLessThan(GLOBAL_RATE_LIMIT_MAX);
  });

  for (const entry of file?.cases ?? []) {
    it(`R3.15 ${entry.name}`, () => runCase(entry), CASE_TIMEOUT_MS);
  }
});
