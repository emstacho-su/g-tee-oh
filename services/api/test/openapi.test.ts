import { readFile } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };
import { buildApp } from "../src/app.js";

const OPENAPI_ROUTE = "/api/v1/openapi.json";
const HEALTH_ROUTE = "/api/v1/healthz";

// The document the contracts pipeline commits, resolved relative to this test file so the
// test runs from any working directory.
const COMMITTED_DOCUMENT_URL = new URL("../../../packages/contracts/api.openapi.json", import.meta.url);

// Every endpoint of A5 section 3, plus GET /drills/{id}, which the drill builder needs (R3.14).
const A5_ROUTES = [
  "POST /auth/login",
  "POST /auth/logout",
  "GET /me",
  "GET /stakes",
  "GET /configs",
  "GET /configs/{id}/pairs",
  "GET /study/node",
  "GET /study/insights",
  "GET /study/turn-roots",
  "GET /coverage",
  "POST /coverage/requests",
  "POST /sessions",
  "GET /sessions/{id}/next",
  "POST /sessions/{id}/decisions",
  "POST /sessions/{id}/end",
  "GET /prediction/{session}/next",
  "POST /prediction/{session}/answer",
  "POST /range-paint/submit",
  "GET /drills",
  "GET /drills/{id}",
  "POST /drills",
  "PATCH /drills/{id}",
  "DELETE /drills/{id}",
  "POST /drills/import",
  "GET /drills/{id}/export",
  "GET /progress/rating",
  "GET /progress/tracks",
  "GET /progress/leaks",
  "GET /progress/heatmap",
  "GET /progress/holdout",
  "GET /progress/streak",
  "GET /explain/{attempt_id}/more-info",
  "POST /explain/{attempt_id}/ask",
  "GET /events",
  "GET /admin/builder",
  "PATCH /admin/builder/settings",
  "POST /admin/builder/pause",
  "POST /admin/builder/resume",
] as const;

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

  it("R3.1 the document covers every A5 section 3 route (contract first, O-38)", async () => {
    const document = (await app.inject({ method: "GET", url: OPENAPI_ROUTE })).json<unknown>();
    if (!isOpenApiDocumentShape(document)) {
      throw new Error("served document is not an OpenAPI document shape");
    }
    const served = Object.entries(document.paths).flatMap(([path, operations]) =>
      Object.keys(operations as Record<string, unknown>).map((method) => `${method.toUpperCase()} ${path}`),
    );
    const expected = A5_ROUTES.map((route) => {
      const [method, path] = route.split(" ");
      return `${method} /api/v1${path}`;
    });
    expect(served).toEqual(expect.arrayContaining(expected));
  });

  it("R3.1 a planned route asks for a session before anything else (401 problem)", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/progress/streak" });

    expect(response.statusCode).toBe(401);
    expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(response.json<{ type: string }>().type).toBe("urn:g-tee-oh:problem:unauthenticated");
  });

  it("R0.7 the committed packages/contracts/api.openapi.json equals the served document", async () => {
    const committedText = await readFile(COMMITTED_DOCUMENT_URL, "utf8");
    const committed: unknown = JSON.parse(committedText);
    const served = (await app.inject({ method: "GET", url: OPENAPI_ROUTE })).json<unknown>();

    expect(committed).toEqual(served);
  });
});
