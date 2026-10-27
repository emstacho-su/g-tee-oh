import { describe, expect, it } from "vitest";

import {
  DEFAULT_API_PORT,
  DEFAULT_APP_ORIGIN,
  DEFAULT_PG_PORT,
  DEFAULT_SESSION_TTL_HOURS,
  DEFAULT_TRUST_PROXY_HOPS,
  defaultAppConfig,
  loadProcessConfig,
  parseApiPort,
} from "../src/config.js";

describe("@g-tee-oh/api config", () => {
  it("R0.7 API_PORT defaults to 8080 when unset or blank and accepts an integer port", () => {
    expect(parseApiPort(undefined)).toBe(DEFAULT_API_PORT);
    expect(parseApiPort("")).toBe(DEFAULT_API_PORT);
    expect(parseApiPort("  ")).toBe(DEFAULT_API_PORT);
    expect(parseApiPort("8081")).toBe(8081);
    expect(parseApiPort(" 8081 ")).toBe(8081);
  });

  it("R0.7 API_PORT rejects anything that is not a port number", () => {
    for (const raw of ["0", "65536", "-1", "80a", "8080.5", "0x1F", "abc"]) {
      expect(() => parseApiPort(raw), raw).toThrow(/API_PORT must be an integer/);
    }
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
      trustProxyHops: DEFAULT_TRUST_PROXY_HOPS,
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

  it("R3.1 SESSION_TTL_HOURS and TRUST_PROXY_HOPS are bounded integers", () => {
    const config = loadProcessConfig({ ...COMPLETE_ENV, SESSION_TTL_HOURS: "24", TRUST_PROXY_HOPS: "0" });
    expect(config.app.sessionTtlHours).toBe(24);
    expect(config.app.trustProxyHops).toBe(0);
    expect(() => loadProcessConfig({ ...COMPLETE_ENV, SESSION_TTL_HOURS: "0" })).toThrow(/SESSION_TTL_HOURS/);
    expect(() => loadProcessConfig({ ...COMPLETE_ENV, TRUST_PROXY_HOPS: "-1" })).toThrow(/TRUST_PROXY_HOPS/);
  });

  it("R3.1 the default app configuration is the dev profile's", () => {
    expect(defaultAppConfig().appOrigin).toBe(DEFAULT_APP_ORIGIN);
  });
});
