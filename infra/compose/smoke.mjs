#!/usr/bin/env node
// Health smoke over the Compose dev profile (R0.3, R0.5): what "just smoke" and the e2e job run after dev-up.
// Zero dependencies, node ESM (ECMAScript modules). It needs no migration, so it passes on a fresh stack.
//
// Mechanism: every check below is a small probe of one service boundary, run in order and never short
// circuited, so one run reports every failing check at once. The script reads .env from the repo root
// underneath the environment (the justfile does not export .env; dbmate and Compose read it themselves)
// and only fills variables the environment does not already carry. It exits 0 with one line per check
// and 1 with the names of the failing checks.
//
// Checks: compose ps reports every dev service healthy (postgres, seaweedfs, solver-query, api, web and
// caddy; the three built images report through their own HEALTHCHECK), or exited 0 for the bucket-init
// one-shot; TCP (Transmission Control Protocol) 5432 accepts a connection and pg_isready succeeds inside
// the container; the S3 (Simple Storage Service) gateway answers HTTP (Hypertext Transfer Protocol) on
// 8333; ListBuckets with the admin identity, signed with Amazon Web Services (AWS) Signature Version 4
// (SigV4), lists library and reference-private; the library identity is denied on reference-private
// (02 section 6.4, separate credentials per bucket); Caddy answers /healthz over plain HTTP on 80 and
// over TLS (Transport Layer Security) on 443 with its internal certificate authority (A9 section 3),
// verification skipped for the TLS requests only; and the api answers GET /api/v1/healthz through
// Caddy's /api/* route with JSON (JavaScript Object Notation) status "ok" (R0.7), the same way.

import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMPOSE_FILE = "infra/compose/compose.yaml";
const COMPOSE_ARGS = ["compose", "--project-directory", ".", "-f", COMPOSE_FILE, "--profile", "dev"];
const DEV_SERVICES = ["postgres", "seaweedfs", "bucket-init", "solver-query", "api", "web", "caddy"];
const ONE_SHOT_SERVICES = new Set(["bucket-init"]);
const BUCKETS = ["library", "reference-private"];
const POSTGRES_HOST = "127.0.0.1";
const POSTGRES_PORT = 5432;
const S3_URL = "http://127.0.0.1:8333";
const CADDY_HTTP_URL = "http://127.0.0.1/healthz";
const CADDY_HTTPS_URL = "https://127.0.0.1/healthz";
const CADDY_API_HEALTHZ_URL = "https://127.0.0.1/api/v1/healthz";
const DEFAULT_CADDY_SITE = "localhost";
const HEALTHZ_OK_STATUS = "ok";
const SIGV4_REGION = "us-east-1";
const SIGV4_SERVICE = "s3";
const REQUEST_TIMEOUT_MS = 5000;

// Simple KEY=VALUE parser: no quoting, no expansion, # lines and blanks skipped.
function parseDotEnv(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#") && line.indexOf("=") > 0)
      .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
  );
}

function loadSettings() {
  const envPath = resolve(REPO_ROOT, ".env");
  const fromFile = existsSync(envPath)
    ? parseDotEnv(readFileSync(envPath, "utf8"))
    : {};
  return { ...fromFile, ...process.env };
}

function requireSetting(settings, name) {
  const value = settings[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set in the environment or .env`);
  }
  return value;
}

function runCompose(args) {
  const result = spawnSync("docker", [...COMPOSE_ARGS, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.error) {
    throw new Error(`docker could not start: ${result.error.message}`);
  }
  return result;
}

// Compose prints one JSON (JavaScript Object Notation) object per line in recent versions and a JSON array
// in older ones.
function parseComposePs(stdout) {
  const trimmed = stdout.trim();
  if (trimmed === "") {
    return [];
  }
  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  return trimmed.split(/\r?\n/).map((line) => JSON.parse(line));
}

function request(url, { method = "GET", headers = {}, rejectUnauthorized = true, servername } = {}) {
  return new Promise((resolvePromise, reject) => {
    const target = new URL(url);
    const client = target.protocol === "https:" ? https : http;
    const options = { method, headers, timeout: REQUEST_TIMEOUT_MS, rejectUnauthorized, servername };
    const req = client.request(target, options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolvePromise({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error(`no response within ${REQUEST_TIMEOUT_MS} ms`)));
    req.on("error", reject);
    req.end();
  });
}

function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

// AWS Signature Version 4 for an S3 request with an empty body, path-style addressing, no query string.
function sigV4Headers({ method, host, path, accessKey, secretKey }) {
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex("");
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${SIGV4_REGION}/${SIGV4_SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), SIGV4_REGION), SIGV4_SERVICE), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return {
    host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function s3Request({ method, path, accessKey, secretKey }) {
  const host = new URL(S3_URL).host;
  return request(`${S3_URL}${path}`, { method, headers: sigV4Headers({ method, host, path, accessKey, secretKey }) });
}

function checkComposeServices() {
  const result = runCompose(["ps", "-a", "--format", "json"]);
  if (result.status !== 0) {
    throw new Error(`docker compose ps exited ${result.status}: ${result.stderr.trim()}`);
  }
  const rows = parseComposePs(result.stdout);
  const problems = DEV_SERVICES.flatMap((service) => {
    const row = rows.find((candidate) => candidate.Service === service);
    if (!row) {
      return [`${service}: no container`];
    }
    if (ONE_SHOT_SERVICES.has(service)) {
      return row.State === "exited" && row.ExitCode === 0 ? [] : [`${service}: ${row.State} exit ${row.ExitCode}`];
    }
    return row.Health === "healthy" ? [] : [`${service}: ${row.State} ${row.Health || "no health"}`];
  });
  if (problems.length > 0) {
    throw new Error(problems.join("; "));
  }
  return DEV_SERVICES.map((service) => `${service} ${ONE_SHOT_SERVICES.has(service) ? "exited 0" : "healthy"}`).join(", ");
}

function checkPostgresTcp() {
  return new Promise((resolvePromise, reject) => {
    const socket = createConnection({ host: POSTGRES_HOST, port: POSTGRES_PORT });
    socket.setTimeout(REQUEST_TIMEOUT_MS);
    socket.once("connect", () => {
      socket.destroy();
      resolvePromise(`${POSTGRES_HOST}:${POSTGRES_PORT} accepted a connection`);
    });
    socket.once("timeout", () => socket.destroy(new Error(`no connection within ${REQUEST_TIMEOUT_MS} ms`)));
    socket.once("error", reject);
  });
}

function checkPgIsReady() {
  const result = runCompose(["exec", "-T", "postgres", "pg_isready", "-U", "postgres"]);
  if (result.status !== 0) {
    throw new Error(`pg_isready exited ${result.status}: ${(result.stdout + result.stderr).trim()}`);
  }
  return result.stdout.trim();
}

async function checkS3Http() {
  const response = await request(`${S3_URL}/`);
  return `GET / answered HTTP ${response.status}`;
}

async function checkBucketsExist(settings) {
  const response = await s3Request({
    method: "GET",
    path: "/",
    accessKey: requireSetting(settings, "S3_ADMIN_ACCESS_KEY"),
    secretKey: requireSetting(settings, "S3_ADMIN_SECRET_KEY"),
  });
  if (response.status !== 200) {
    throw new Error(`ListBuckets with the admin identity answered HTTP ${response.status}`);
  }
  const listed = [...response.body.matchAll(/<Name>([^<]+)<\/Name>/g)].map((match) => match[1]);
  const missing = BUCKETS.filter((bucket) => !listed.includes(bucket));
  if (missing.length > 0) {
    throw new Error(`missing bucket(s) ${missing.join(", ")}; listed: ${listed.join(", ") || "none"}`);
  }
  return `ListBuckets lists ${BUCKETS.join(" and ")}`;
}

async function checkBucketIsolation(settings) {
  const response = await s3Request({
    method: "HEAD",
    path: "/reference-private",
    accessKey: requireSetting(settings, "S3_LIBRARY_ACCESS_KEY"),
    secretKey: requireSetting(settings, "S3_LIBRARY_SECRET_KEY"),
  });
  if (response.status !== 403) {
    throw new Error(`HEAD reference-private with the library identity answered HTTP ${response.status}, expected 403`);
  }
  return "library identity gets 403 on reference-private";
}

async function checkCaddyHttp() {
  const response = await request(CADDY_HTTP_URL);
  if (response.status !== 200 || response.body.trim() !== "ok") {
    throw new Error(`GET ${CADDY_HTTP_URL} answered HTTP ${response.status} "${response.body.trim()}"`);
  }
  return `GET ${CADDY_HTTP_URL} answered 200 ok`;
}

function caddySite(settings) {
  return settings.CADDY_SITE || DEFAULT_CADDY_SITE;
}

// One request to the edge Caddy over TLS: Host and SNI (Server Name Indication) carry CADDY_SITE so Caddy
// picks its https site block, and certificate verification is skipped for this request only because the
// certificate is signed by Caddy's internal authority, which the host does not trust (A9 section 3, O-113).
function requestThroughCaddyTls(url, settings) {
  const site = caddySite(settings);
  return request(url, { headers: { host: site }, servername: site, rejectUnauthorized: false });
}

function parseJsonBody(url, text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`GET ${url} did not answer JSON: ${error.message}; body "${text.trim()}"`);
  }
}

async function checkCaddyHttps(settings) {
  const site = caddySite(settings);
  const response = await requestThroughCaddyTls(CADDY_HTTPS_URL, settings);
  if (response.status !== 200 || response.body.trim() !== HEALTHZ_OK_STATUS) {
    throw new Error(`GET ${CADDY_HTTPS_URL} as ${site} answered HTTP ${response.status} "${response.body.trim()}"`);
  }
  return `GET ${CADDY_HTTPS_URL} as ${site} answered 200 ok over tls internal`;
}

// The api behind Caddy's /api/* route (A5 section 1): the health JSON proves the proxy, the api container
// and its /api/v1 prefix in one request (R0.7).
async function checkApiHealthzThroughCaddy(settings) {
  const site = caddySite(settings);
  const response = await requestThroughCaddyTls(CADDY_API_HEALTHZ_URL, settings);
  if (response.status !== 200) {
    throw new Error(`GET ${CADDY_API_HEALTHZ_URL} as ${site} answered HTTP ${response.status} "${response.body.trim()}"`);
  }
  const body = parseJsonBody(CADDY_API_HEALTHZ_URL, response.body);
  if (body?.status !== HEALTHZ_OK_STATUS) {
    throw new Error(`GET ${CADDY_API_HEALTHZ_URL} as ${site} answered status ${JSON.stringify(body?.status)}, expected "${HEALTHZ_OK_STATUS}"`);
  }
  return `GET ${CADDY_API_HEALTHZ_URL} as ${site} answered 200 with status ok from ${body.service ?? "an unnamed service"}`;
}

const CHECKS = [
  ["compose services healthy", checkComposeServices],
  ["postgres tcp 5432", checkPostgresTcp],
  ["postgres pg_isready", checkPgIsReady],
  ["s3 gateway http 8333", checkS3Http],
  ["s3 buckets library and reference-private", checkBucketsExist],
  ["s3 bucket isolation", checkBucketIsolation],
  ["caddy http /healthz", checkCaddyHttp],
  ["caddy https /healthz", checkCaddyHttps],
  ["caddy https /api/v1/healthz", checkApiHealthzThroughCaddy],
];

async function runCheck(name, check, settings) {
  try {
    const detail = await check(settings);
    console.log(`ok    ${name}: ${detail}`);
    return { name, ok: true };
  } catch (error) {
    console.log(`FAIL  ${name}: ${error.message}`);
    return { name, ok: false };
  }
}

async function main() {
  const settings = loadSettings();
  const results = [];
  for (const [name, check] of CHECKS) {
    results.push(await runCheck(name, check, settings));
  }
  const failed = results.filter((result) => !result.ok).map((result) => result.name);
  if (failed.length > 0) {
    console.log(`smoke: ${failed.length} of ${results.length} checks failed: ${failed.join(", ")}`);
    process.exit(1);
  }
  console.log(`smoke: all ${results.length} checks passed`);
}

main().catch((error) => {
  console.log(`smoke: aborted: ${error.message}`);
  process.exit(1);
});
