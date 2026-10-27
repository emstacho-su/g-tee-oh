// Tests for infra/compose/library-reads.mjs (R2.19, R2.20, O-62): the fixture library reads the smoke
// runs against solver-query, without a running stack. node:test, run by `pnpm run test:scripts`
// (just ts-test). The answer checks run on hand-built bodies in the solver-query response shapes; the
// fetch script runs for real against a local HTTP server; and the two manifests the smoke reads are
// the committed ones under validation/fixtures/library, so a regenerated library that moved them fails here.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_LIBRARY_PATH,
  FETCH_SCRIPT,
  G6A,
  G6A_ROOT_KEY,
  HAND_CLASSES,
  SYNTHETIC,
  checkG6aRoot,
  checkSyntheticFlag,
  coverageUrl,
  manifestPath,
  nodesUrl,
  parseFetchOutput,
  singleFixtureSolution,
} from "../infra/compose/library-reads.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOLUTION_ID = "77d568b2-bf44-8f55-b130-48954e2ac642";

function coverageResponse(solutionIds, sources = solutionIds.map(() => "fixture"), status = 200) {
  const body = { config_id: G6A.configId, pair: "BB-BTN", preflop: { available: solutionIds.length > 0, solution_ids: solutionIds, sources } };
  return { status, body: JSON.stringify(body) };
}

function rootResponse({ nodeKey = G6A_ROOT_KEY, tokens = ["f", "a"], hands = HAND_CLASSES, status = 200 } = {}) {
  const body = {
    node_key: nodeKey,
    actions: tokens.map((token, index) => ({ index, token })),
    hands: Array.from({ length: hands }, (_, index) => ({ hand: `class-${index}` })),
  };
  return { status, body: JSON.stringify(body) };
}

/** The only solution id under the committed library's directory for a configuration. */
function committedSolutionId(configId, pairFilter) {
  const dir = join(REPO_ROOT, DEFAULT_LIBRARY_PATH, "preflop", configId);
  const ids = readdirSync(dir).filter((id) => pairFilter(JSON.parse(readFileSync(join(dir, id, "manifest.json"), "utf8"))));
  assert.equal(ids.length, 1, `${configId}: one BB-BTN solution`);
  return ids[0];
}

test("r2_19 the request URLs encode the configuration, pair, solution and root key", () => {
  assert.equal(coverageUrl(G6A.configId), "http://solver-query:7070/v1/coverage?config_id=cfg_2_online_norake_10&pair=BB-BTN");
  const url = new URL(nodesUrl(SOLUTION_ID, G6A_ROOT_KEY));
  assert.equal(url.pathname, "/v1/nodes");
  assert.equal(url.searchParams.get("solution_id"), SOLUTION_ID);
  assert.equal(url.searchParams.get("node_key"), "cfg_2_online_norake_10/BB-BTN/");
  assert.equal(manifestPath(G6A.configId, SOLUTION_ID), `preflop/cfg_2_online_norake_10/${SOLUTION_ID}/manifest.json`);
});

test("r2_19 singleFixtureSolution returns the one fixture id and names every other case", () => {
  assert.equal(singleFixtureSolution(G6A.configId, coverageResponse([SOLUTION_ID])), SOLUTION_ID);
  assert.throws(() => singleFixtureSolution(G6A.configId, coverageResponse([])), /lists 0 preflop solutions \(none\)/);
  assert.throws(() => singleFixtureSolution(G6A.configId, coverageResponse([SOLUTION_ID, SOLUTION_ID])), /lists 2/);
  assert.throws(() => singleFixtureSolution(G6A.configId, coverageResponse([SOLUTION_ID], ["library"])), /source "library"/);
  assert.throws(() => singleFixtureSolution(G6A.configId, coverageResponse(["../../etc"])), /not a lowercase UUID/);
  assert.throws(() => singleFixtureSolution(G6A.configId, coverageResponse([SOLUTION_ID], ["fixture"], 400)), /HTTP 400/);
  assert.throws(() => singleFixtureSolution(G6A.configId, { status: 200, body: "<html>" }), /did not answer JSON/);
});

test("r2_20 checkSyntheticFlag reads an absent flag as false and refuses a mismatch", () => {
  assert.equal(checkSyntheticFlag("m", { synthetic: true }, true), true);
  assert.equal(checkSyntheticFlag("m", {}, false), false);
  assert.throws(() => checkSyntheticFlag("m", { synthetic: false }, true), /says synthetic false, expected true/);
  assert.throws(() => checkSyntheticFlag("m", { synthetic: "yes" }, true), /not a boolean/);
});

test("r2_19 checkG6aRoot wants 200, the root key, fold then all-in and 169 hands", () => {
  assert.equal(checkG6aRoot(rootResponse()), HAND_CLASSES);
  assert.throws(() => checkG6aRoot(rootResponse({ status: 404 })), /HTTP 404/);
  assert.throws(() => checkG6aRoot(rootResponse({ nodeKey: `${G6A_ROOT_KEY}a` })), /node_key/);
  assert.throws(() => checkG6aRoot(rootResponse({ tokens: ["f", "c"] })), /actions \["f","c"\]/);
  assert.throws(() => checkG6aRoot(rootResponse({ hands: 168 })), /168 hands, expected 169/);
});

test("r2_19 parseFetchOutput accepts { status, body } only", () => {
  assert.deepEqual(parseFetchOutput("x", '{"status":200,"body":"{}"}'), { status: 200, body: "{}" });
  assert.throws(() => parseFetchOutput("x", "boom"), /printed no JSON/);
  assert.throws(() => parseFetchOutput("x", '{"status":"200","body":""}'), /expected \{ status, body \}/);
});

test("r2_19 the fetch script prints the status and body of a real request", async () => {
  const server = createServer((request, response) => {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ path: request.url }));
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  try {
    const url = `http://127.0.0.1:${server.address().port}/v1/coverage?config_id=x`;
    // Asynchronous spawn: a synchronous one would block this process's server from answering.
    const run = await new Promise((resolvePromise, reject) => {
      const child = spawn(process.execPath, ["-e", FETCH_SCRIPT, url], { stdio: ["ignore", "pipe", "pipe"] });
      const output = { stdout: "", stderr: "" };
      child.stdout.on("data", (chunk) => { output.stdout += chunk; });
      child.stderr.on("data", (chunk) => { output.stderr += chunk; });
      child.on("error", reject);
      child.on("close", (status) => resolvePromise({ ...output, status }));
    });
    assert.equal(run.status, 0, run.stderr);
    const parsed = parseFetchOutput("fetch", run.stdout);
    assert.equal(parsed.status, 404);
    assert.deepEqual(JSON.parse(parsed.body), { path: "/v1/coverage?config_id=x" });
  } finally {
    server.close();
  }
});

test("r2_20 the committed library holds the two solutions the smoke reads, with their synthetic flags", () => {
  const bbBtn = (manifest) => manifest.pair === "BB-BTN";
  for (const expected of [G6A, SYNTHETIC]) {
    const id = committedSolutionId(expected.configId, bbBtn);
    const text = readFileSync(join(REPO_ROOT, DEFAULT_LIBRARY_PATH, manifestPath(expected.configId, id)), "utf8");
    assert.equal(checkSyntheticFlag(expected.configId, JSON.parse(text), expected.synthetic), expected.synthetic);
  }
});
