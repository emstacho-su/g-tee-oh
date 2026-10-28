// R3.3, O-248, O-263: the http client, the stack checks and the measured flow of just perf
// (scripts/perf/), against an in-memory fake of the api's routes, so no Docker and no dev stack.
// node:test, run by `pnpm run test:scripts`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

import { PerfError } from "../perf/errors.mjs";
import { createApiClient } from "../perf/http.mjs";
import { DEFAULT_COUNTS, PERF_CONFIG_ID, PERF_PAIR, PERF_SESSION_SEED, runPerf } from "../perf/flow.mjs";
import {
  CADDY_ROOT_PATH,
  caddyRootArgs,
  checkStack,
  createPerfOwner,
  perfOwnerEmail,
  readCaddyRoot,
} from "../perf/stack.mjs";

const BASE_URL = "https://localhost";
const CSRF = "csrf-token-value";
const SESSION_ID = "01900000-0000-7000-8000-000000000001";
const DRILL_ID = "01900000-0000-7000-8000-000000000002";
const PAIRS = ["UTG-HJ", "BB-BTN", "SB-BB"];
const COVERED = new Set(["BB-BTN", "SB-BB"]);
const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
const SMALL_COUNTS = { warmup: 2, samples: 5 };
const GRADE_MS = 4.5;
const PERF_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "perf.mjs");
/** Port 1 (tcpmux) has no listener on a development machine, so the connection is refused. */
const CLOSED_PORT_URL = "https://127.0.0.1:1";

function json(status, body, headers = {}) {
  return { status, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
}

/** A fake of the api routes perf drives; records every request it saw. */
function fakeApi({ healthStatus = 200, prompt = {} } = {}) {
  const seen = [];
  let version = 0;
  const transport = async (request) => {
    const url = new URL(request.url);
    seen.push({ method: request.method, path: url.pathname, query: url.searchParams.toString(), headers: request.headers, body: request.body });
    const route = `${request.method} ${url.pathname}`;
    if (route === "GET /api/v1/healthz") return json(healthStatus, { status: "ok" });
    if (route === "POST /api/v1/auth/login") {
      return json(200, { csrf_token: CSRF, user: {} }, { "set-cookie": ["gto_session=abc; Path=/; HttpOnly; Secure"] });
    }
    if (route === `GET /api/v1/configs/${PERF_CONFIG_ID}/pairs`) {
      return json(200, { items: PAIRS.map((pair) => ({ pair })), next_cursor: null });
    }
    if (route === "GET /api/v1/study/node") {
      const pair = url.searchParams.get("pair");
      if (url.searchParams.has("node_key")) {
        return json(200, { node_key: url.searchParams.get("node_key"), next_likely_node_key: null });
      }
      if (!COVERED.has(pair)) return json(404, { title: "Not Found" });
      return json(200, { node_key: `${PERF_CONFIG_ID}/${pair}/`, next_likely_node_key: `${PERF_CONFIG_ID}/${pair}/r250` });
    }
    if (route === "POST /api/v1/drills") return json(201, { id: DRILL_ID });
    if (route === "POST /api/v1/sessions") return json(201, { session_id: SESSION_ID, state_version: 0 });
    if (route === `GET /api/v1/sessions/${SESSION_ID}/next`) {
      return json(200, { state: "await_hero", state_version: version, buttons: [{ index: 0 }, { index: 1 }], ...prompt });
    }
    if (route === `POST /api/v1/sessions/${SESSION_ID}/decisions`) {
      version += 1;
      return json(200, { state_version: version, label: "best" }, { "server-timing": `sq-grade;dur=${GRADE_MS}` });
    }
    return json(404, { title: `no fake route ${route}` });
  };
  return { transport, seen };
}

function client(transport) {
  return createApiClient({ baseUrl: BASE_URL, transport, minIntervalMs: 0 });
}

const OWNER = { email: "perf-0011223344556677@example.com", password: "a-long-random-password" };

test("R3.3 runPerf logs in, keeps the cookie and CSRF token, and measures every path", async () => {
  const api = fakeApi();
  const result = await runPerf(client(api.transport), { owner: OWNER, counts: SMALL_COUNTS });

  assert.equal(result.timings["study-node"].length, SMALL_COUNTS.samples);
  assert.equal(result.timings["decision-feedback"].length, SMALL_COUNTS.samples);
  assert.deepEqual(result.timings.grade, Array(SMALL_COUNTS.samples).fill(GRADE_MS));
  assert.equal(result.run.config_id, PERF_CONFIG_ID);
  assert.equal(result.run.pair, PERF_PAIR);
  // Two covered roots, each naming one next likely node: four distinct study targets.
  assert.equal(result.run.study_targets, 4);
  const childReads = api.seen.filter((entry) => entry.path === "/api/v1/study/node" && entry.query.includes("node_key"));
  assert.ok(childReads.some((entry) => new URLSearchParams(entry.query).get("node_key") === `${PERF_CONFIG_ID}/BB-BTN/r250`));

  const login = api.seen.find((entry) => entry.path === "/api/v1/auth/login");
  assert.deepEqual(JSON.parse(login.body), { email: OWNER.email, password: OWNER.password });
  const mutating = api.seen.filter((entry) => entry.method === "POST" && entry.path !== "/api/v1/auth/login");
  assert.ok(mutating.length > 0);
  for (const entry of mutating) {
    assert.equal(entry.headers["x-csrf-token"], CSRF);
    assert.equal(entry.headers.origin, BASE_URL);
    assert.match(entry.headers.cookie, /gto_session=abc/);
  }
  const decisions = mutating.filter((entry) => entry.path.endsWith("/decisions"));
  const total = SMALL_COUNTS.warmup + SMALL_COUNTS.samples;
  assert.equal(decisions.length, total);
  assert.equal(new Set(decisions.map((entry) => entry.headers["idempotency-key"])).size, total);
  // Every decision answers the state_version the preceding GET /next returned.
  decisions.forEach((entry, index) => assert.equal(JSON.parse(entry.body).state_version, index));

  const session = mutating.find((entry) => entry.path === "/api/v1/sessions");
  assert.deepEqual(JSON.parse(session.body), { mode: "drill", drill_id: DRILL_ID, seed: PERF_SESSION_SEED });
  const studyReads = api.seen.filter((entry) => entry.path === "/api/v1/study/node");
  assert.ok(studyReads.length >= total);
});

test("R3.3 the default counts are 20 warm-up and 200 timed samples per path", () => {
  assert.deepEqual(DEFAULT_COUNTS, { warmup: 20, samples: 200 });
});

test("R3.3 runPerf fails with the status when a prompt is not the hero's turn", async () => {
  const api = fakeApi({ prompt: { state: "ended" } });
  await assert.rejects(runPerf(client(api.transport), { owner: OWNER, counts: SMALL_COUNTS }), /await_hero.*ended/);
});

test("R3.3 checkStack fails with a clear message when the stack is not up", async () => {
  const refused = async () => {
    throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { code: "ECONNREFUSED" });
  };
  await assert.rejects(checkStack(client(refused), BASE_URL), (error) => {
    assert.ok(error instanceof PerfError);
    assert.match(error.message, /dev stack is not up/);
    assert.match(error.message, /just dev-up/);
    assert.match(error.message, /ECONNREFUSED/);
    return true;
  });
  await assert.rejects(checkStack(client(fakeApi({ healthStatus: 503 }).transport), BASE_URL), /dev stack is not up.*503/);
  await checkStack(client(fakeApi().transport), BASE_URL);
});

test("R3.3 the client refuses a 429 instead of timing it", async () => {
  const limited = async () => json(429, { title: "Too Many Requests" }, { "retry-after": "30" });
  await assert.rejects(client(limited).request("GET", "/api/v1/healthz"), /429/);
});

test("R3.3 the client paces requests at least minIntervalMs apart", async () => {
  const sleeps = [];
  let clock = 0;
  const paced = createApiClient({
    baseUrl: BASE_URL,
    transport: async () => json(200, {}),
    minIntervalMs: 250,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  await paced.request("GET", "/a");
  clock += 100;
  await paced.request("GET", "/b");
  assert.deepEqual(sleeps, [150]);
});

test("R3.3 readCaddyRoot copies the root certificate out of the caddy container", () => {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    return { status: 0, stdout: PEM, stderr: "" };
  };
  assert.equal(readCaddyRoot({ run }), PEM);
  assert.deepEqual(calls[0][1].slice(-5), ["exec", "-T", "caddy", "cat", CADDY_ROOT_PATH]);
  assert.deepEqual(caddyRootArgs(["compose"]), ["compose", "exec", "-T", "caddy", "cat", CADDY_ROOT_PATH]);
});

test("R3.3 readCaddyRoot says the stack is not up when docker fails or prints no certificate", () => {
  const failing = () => ({ status: 1, stdout: "", stderr: "service \"caddy\" is not running" });
  assert.throws(() => readCaddyRoot({ run: failing }), /dev stack is not up.*caddy/s);
  const notPem = () => ({ status: 0, stdout: "nothing", stderr: "" });
  assert.throws(() => readCaddyRoot({ run: notPem }), /not a PEM certificate/);
  const missingDocker = () => ({ error: new Error("spawn docker ENOENT"), status: null, stdout: "", stderr: "" });
  assert.throws(() => readCaddyRoot({ run: missingDocker }), /docker/);
});

test("R3.3 createPerfOwner sends the password on stdin only, never as an argument", () => {
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, input: options.input });
    return { status: 0, stdout: "", stderr: "" };
  };
  createPerfOwner(OWNER, { run });
  assert.equal(calls[0].command, "docker");
  assert.ok(!calls[0].args.some((argument) => argument.includes(OWNER.password)));
  assert.ok(calls[0].args.includes(OWNER.email));
  assert.equal(calls[0].input, `${OWNER.password}\n`);
  const failing = () => ({ status: 1, stdout: "", stderr: "create-user failed: duplicate" });
  assert.throws(() => createPerfOwner(OWNER, { run: failing }), /create-user.*exited 1/);
});

test("R3.3 scripts/perf.mjs exits 1 with the reason on a bad argument", () => {
  const result = spawnSync(process.execPath, [PERF_SCRIPT, "--samples", "5"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^perf: unknown argument --samples/);
});

test("R3.3 scripts/perf.mjs exits 1 saying the stack is not up when nothing listens", () => {
  const dir = mkdtempSync(join(tmpdir(), "perf-ca-"));
  try {
    const caFile = join(dir, "root.crt");
    writeFileSync(caFile, `${tls.rootCertificates[0]}\n`, "utf8");
    const args = [PERF_SCRIPT, "--base-url", CLOSED_PORT_URL, "--ca-file", caFile, "--out-dir", dir];
    const result = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /perf: the dev stack is not up: .*\/api\/v1\/healthz did not answer/);
    assert.deepEqual(readdirSync(dir), ["root.crt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R3.3 perfOwnerEmail is a fresh lowercase address per run", () => {
  const email = perfOwnerEmail((size) => Buffer.alloc(size, 0xab));
  assert.equal(email, "perf-abababababababab@example.com");
  assert.notEqual(perfOwnerEmail(), perfOwnerEmail());
});
