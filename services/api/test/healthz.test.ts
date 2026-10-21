import { afterAll, beforeAll, describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };
import { buildApp } from "../src/app.js";

const HEALTH_ROUTE = "/api/v1/healthz";
const CONTAINER_PROBE_ROUTE = "/healthz";

describe("@g-tee-oh/api healthz", () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("R0.7 GET /api/v1/healthz returns the health JSON", async () => {
    const response = await app.inject({ method: "GET", url: HEALTH_ROUTE });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.json<unknown>()).toEqual({
      status: "ok",
      service: "api",
      version: packageJson.version,
    });
  });

  it("R0.7 GET /healthz answers the same for the container probe", async () => {
    const [probe, versioned] = await Promise.all([
      app.inject({ method: "GET", url: CONTAINER_PROBE_ROUTE }),
      app.inject({ method: "GET", url: HEALTH_ROUTE }),
    ]);

    expect(probe.statusCode).toBe(200);
    expect(probe.json<unknown>()).toEqual(versioned.json<unknown>());
  });
});
