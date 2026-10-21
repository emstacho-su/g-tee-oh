// Tests for the container image matrix infra/docker/images.json (R0.3). Run with: pnpm run test:scripts
//
// The images workflow (.github/workflows/images.yml) fans one multi-arch build out per entry of the
// matrix, so every entry must name a Dockerfile that exists and the build context every Dockerfile is
// written against: the repo root, where .dockerignore and the COPY paths live. solver-query is the
// first entry (S06); api, web and library-builder join when their sessions publish them.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MATRIX_PATH = resolve(REPO_ROOT, "infra/docker/images.json");
const ENTRY_KEYS = Object.freeze(["context", "dockerfile", "name"]);
const REPO_ROOT_CONTEXT = ".";
// ghcr.io image names are lowercase; metadata-action lowercases the repository part, not this one.
const IMAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SOLVER_QUERY_ENTRY = Object.freeze({
  name: "solver-query",
  dockerfile: "infra/docker/solver-query.Dockerfile",
  context: REPO_ROOT_CONTEXT,
});

function readMatrix() {
  return JSON.parse(readFileSync(MATRIX_PATH, "utf8"));
}

describe("images matrix", () => {
  it("r0_3 the images matrix lists solver-query with an existing Dockerfile and the repo root as context", () => {
    const { services } = readMatrix();
    const entry = services.find((service) => service.name === SOLVER_QUERY_ENTRY.name);
    assert.ok(entry, "solver-query is missing from infra/docker/images.json");
    assert.deepEqual(entry, SOLVER_QUERY_ENTRY);
    assert.ok(existsSync(resolve(REPO_ROOT, entry.dockerfile)), `${entry.dockerfile} does not exist`);
  });

  it("r0_3 every matrix entry carries exactly name, dockerfile and context, with an existing Dockerfile", () => {
    const { services } = readMatrix();
    assert.ok(Array.isArray(services) && services.length > 0, "services must be a non-empty array");
    for (const service of services) {
      const label = JSON.stringify(service);
      assert.deepEqual(Object.keys(service).sort(), [...ENTRY_KEYS], `${label} must carry exactly ${ENTRY_KEYS.join(", ")}`);
      assert.match(service.name, IMAGE_NAME_PATTERN, `${label}: the name becomes the ghcr.io image name`);
      assert.ok(existsSync(resolve(REPO_ROOT, service.dockerfile)), `${label}: the Dockerfile does not exist`);
      assert.equal(service.context, REPO_ROOT_CONTEXT, `${label}: every Dockerfile is written against the repo root`);
    }
  });

  it("r0_3 matrix names are unique, so the per-service gha cache scopes never collide", () => {
    const { services } = readMatrix();
    const names = services.map((service) => service.name);
    assert.equal(new Set(names).size, names.length, `duplicate name in ${names.join(", ")}`);
  });
});
