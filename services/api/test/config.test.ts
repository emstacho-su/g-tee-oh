import { describe, expect, it } from "vitest";

import {
  DEFAULT_API_PORT,
  DEFAULT_APP_ORIGIN,
  DEFAULT_PG_PORT,
  DEFAULT_SESSION_TTL_HOURS,
  DEFAULT_TRUSTED_PROXIES,
  defaultAppConfig,
  loadProcessConfig,
} from "../src/config.js";
import * as configModule from "../src/config.js";

const DATABASE_ENV = { PGHOST: "postgres", PGDATABASE: "gto", PGUSER: "app_login", APP_DB_PASSWORD: "secret" };

function portOf(raw: string | undefined): number {
  return loadProcessConfig({ ...DATABASE_ENV, API_PORT: raw }).port;
}

describe("@g-tee-oh/api config", () => {
  it("R0.7 API_PORT defaults to 8080 when unset or blank and accepts an integer port", () => {
    expect(portOf(undefined)).toBe(DEFAULT_API_PORT);
    expect(portOf("")).toBe(DEFAULT_API_PORT);
    expect(portOf("  ")).toBe(DEFAULT_API_PORT);
    expect(portOf("8081")).toBe(8081);
    expect(portOf(" 8081 ")).toBe(8081);
  });

  it("R0.7 API_PORT rejects anything that is not a port number", () => {
    for (const raw of ["0", "65536", "-1", "80a", "8080.5", "0x1F", "abc"]) {
      expect(() => portOf(raw), raw).toThrow(/API_PORT/);
    }
  });

  it("R0.7 the port is read only through loadProcessConfig (re-review LOW 5)", () => {
    expect(Object.keys(configModule)).not.toContain("parseApiPort");
  });
});

describe("R3.1 process configuration", () => {
  const COMPLETE_ENV = {
    PGHOST: "postgres",
    PGDATABASE: "gto",
    PGUSER: "app_login",
    APP_DB_PASSWORD: "secret",
  };

  it("R3.1 reads the database settings and falls back to the documented defaults", () => {
    const config = loadProcessConfig(COMPLETE_ENV);

    expect(config.port).toBe(DEFAULT_API_PORT);
    expect(config.app).toEqual({
      appOrigin: DEFAULT_APP_ORIGIN,
      sessionTtlHours: DEFAULT_SESSION_TTL_HOURS,
      trustedProxies: [...DEFAULT_TRUSTED_PROXIES],
    });
    expect(config.database).toEqual({
      host: "postgres",
      port: DEFAULT_PG_PORT,
      database: "gto",
      user: "app_login",
      password: "secret",
    });
  });

  it("R3.1 a missing database variable stops startup with a message naming it, never its value", () => {
    expect(() => loadProcessConfig({ ...COMPLETE_ENV, APP_DB_PASSWORD: undefined })).toThrow(/APP_DB_PASSWORD/);
    expect(() => loadProcessConfig({ ...COMPLETE_ENV, PGHOST: "" })).toThrow(/PGHOST/);
    expect(() => loadProcessConfig({ ...COMPLETE_ENV, APP_ORIGIN: "nope" })).not.toThrow(/secret/);
  });

  it("R3.1 APP_ORIGIN must be a bare http or https origin", () => {
    expect(loadProcessConfig({ ...COMPLETE_ENV, APP_ORIGIN: "https://gto.lan" }).app.appOrigin).toBe(
      "https://gto.lan",
    );
    for (const bad of ["https://gto.lan/", "https://gto.lan/app", "ftp://gto.lan", "gto.lan"]) {
      expect(() => loadProcessConfig({ ...COMPLETE_ENV, APP_ORIGIN: bad }), bad).toThrow(/APP_ORIGIN/);
    }
  });

  it("R3.1 SESSION_TTL_HOURS is a bounded integer", () => {
    expect(loadProcessConfig({ ...COMPLETE_ENV, SESSION_TTL_HOURS: "24" }).app.sessionTtlHours).toBe(24);
    expect(() => loadProcessConfig({ ...COMPLETE_ENV, SESSION_TTL_HOURS: "0" })).toThrow(/SESSION_TTL_HOURS/);
  });

  it("R3.1 TRUSTED_PROXIES is a list of presets, addresses and CIDR ranges (O-236, L1)", () => {
    expect(loadProcessConfig({ ...COMPLETE_ENV, TRUSTED_PROXIES: "uniquelocal, 10.0.0.5, 172.18.0.0/16" }).app.trustedProxies).toEqual([
      "uniquelocal",
      "10.0.0.5",
      "172.18.0.0/16",
    ]);
    for (const bad of ["everyone", "10.0.0.300", "172.18.0.0/40", "loopback,,"]) {
      expect(() => loadProcessConfig({ ...COMPLETE_ENV, TRUSTED_PROXIES: bad }), bad).toThrow(/TRUSTED_PROXIES/);
    }
  });

  it("R3.1 one error names every bad variable, API_PORT included (LOW 10)", () => {
    let message = "";
    try {
      loadProcessConfig({ ...COMPLETE_ENV, API_PORT: "80a", SESSION_TTL_HOURS: "0", PGHOST: "" });
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/API_PORT/);
    expect(message).toMatch(/SESSION_TTL_HOURS/);
    expect(message).toMatch(/PGHOST/);
  });

  it("R3.1 the default app configuration is the dev profile's", () => {
    expect(defaultAppConfig().appOrigin).toBe(DEFAULT_APP_ORIGIN);
  });
});
