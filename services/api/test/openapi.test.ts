import { readFile } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };
import { buildApp } from "../src/app.js";

const OPENAPI_ROUTE = "/api/v1/openapi.json";
const HEALTH_ROUTE = "/api/v1/healthz";

// The document the contracts pipeline commits, resolved relative to this test file so the
// test runs from any working directory.
const COMMITTED_DOCUMENT_URL = new URL("../../../packages/contracts/api.openapi.json", import.meta.url);

interface OpenApiDocumentShape {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, unknown>;
}

function isOpenApiDocumentShape(value: unknown): value is OpenApiDocumentShape {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.openapi === "string" &&
    typeof candidate.info === "object" &&
    candidate.info !== null &&
    typeof candidate.paths === "object" &&
    candidate.paths !== null
  );
}

describe("@g-tee-oh/api openapi.json", () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("R0.7 GET /api/v1/openapi.json serves an OpenAPI 3.1 document whose paths include /api/v1/healthz", async () => {
    const response = await app.inject({ method: "GET", url: OPENAPI_ROUTE });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);

    const document = response.json<unknown>();
    if (!isOpenApiDocumentShape(document)) {
      throw new Error("served document is not an OpenAPI document shape");
    }
    expect(document.openapi).toMatch(/^3\.1\./);
    expect(document.info).toEqual({ title: "g-tee-oh api", version: packageJson.version });
    expect(Object.keys(document.paths)).toContain(HEALTH_ROUTE);
  });

  it("R0.7 the committed packages/contracts/api.openapi.json equals the served document", async () => {
    const committedText = await readFile(COMMITTED_DOCUMENT_URL, "utf8");
    const committed: unknown = JSON.parse(committedText);
    const served = (await app.inject({ method: "GET", url: OPENAPI_ROUTE })).json<unknown>();

    expect(committed).toEqual(served);
  });
});
