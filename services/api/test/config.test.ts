import { describe, expect, it } from "vitest";

import {
  DEFAULT_API_PORT,
  DEFAULT_APP_ORIGIN,
  DEFAULT_ASK_MODEL,
  DEFAULT_LLM_MONTHLY_CAP_CENTS,
  DEFAULT_PG_PORT,
  DEFAULT_SESSION_TTL_HOURS,
  DEFAULT_SOLVER_QUERY_URL,
  DEFAULT_TIME_ZONE,
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
      timeZone: DEFAULT_TIME_ZONE,
      explainAskEnabled: false,
      askModel: DEFAULT_ASK_MODEL,
      askMonthlyCapCents: DEFAULT_LLM_MONTHLY_CAP_CENTS,
    });
    expect(config.solverQueryUrl).toBe(DEFAULT_SOLVER_QUERY_URL);
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

  it("R3.3 SOLVER_QUERY_URL is an absolute http base URL (O-244)", () => {
    expect(loadProcessConfig({ ...COMPLETE_ENV, SOLVER_QUERY_URL: "http://127.0.0.1:7070" }).solverQueryUrl).toBe(
      "http://127.0.0.1:7070",
    );
    for (const bad of ["solver-query:7070", "ftp://solver-query", "http://sq/?x=1", "http://sq/#a"]) {
      expect(() => loadProcessConfig({ ...COMPLETE_ENV, SOLVER_QUERY_URL: bad }), bad).toThrow(/SOLVER_QUERY_URL/);
    }
  });

  it("R3.3 SOLVER_QUERY_TIMEOUT_MS bounds every solver-query call, 5000 by default (PR #25 M1)", () => {
    expect(loadProcessConfig(COMPLETE_ENV).solverQueryTimeoutMs).toBe(5000);
    expect(loadProcessConfig({ ...COMPLETE_ENV, SOLVER_QUERY_TIMEOUT_MS: "1500" }).solverQueryTimeoutMs).toBe(1500);
    for (const bad of ["0", "-1", "abc", "600000"]) {
      expect(() => loadProcessConfig({ ...COMPLETE_ENV, SOLVER_QUERY_TIMEOUT_MS: bad }), bad).toThrow(/SOLVER_QUERY_TIMEOUT_MS/);
    }
  });

  it("R3.7 APP_TIME_ZONE is an IANA zone that starts the training day (O-247)", () => {
    expect(loadProcessConfig({ ...COMPLETE_ENV, APP_TIME_ZONE: "America/New_York" }).app.timeZone).toBe(
      "America/New_York",
    );
    expect(() => loadProcessConfig({ ...COMPLETE_ENV, APP_TIME_ZONE: "Mars/Olympus" })).toThrow(/APP_TIME_ZONE/);
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

describe("R3.20 Ask configuration (O-305, O-306)", () => {
  const ENV = { PGHOST: "postgres", PGDATABASE: "gto", PGUSER: "app_login", APP_DB_PASSWORD: "secret" };
  // A made-up value shaped like no real key; no real key is ever used in a test (O-54).
  const FAKE_KEY = "test-only-not-a-key-0123456789";

  it("R3.20 Ask is off by default, with the skill's model and the 1,500 cent cap (O-5)", () => {
    const config = loadProcessConfig(ENV);
    expect(config.app.explainAskEnabled).toBe(false);
    expect(config.app.askModel).toBe(DEFAULT_ASK_MODEL);
    expect(config.app.askMonthlyCapCents).toBe(DEFAULT_LLM_MONTHLY_CAP_CENTS);
    expect(DEFAULT_LLM_MONTHLY_CAP_CENTS).toBe(1500);
    expect(config.anthropicApiKey).toBeNull();
    expect(defaultAppConfig().explainAskEnabled).toBe(false);
  });

  it("R3.20 the key lives in the process configuration only, never in AppConfig", () => {
    const config = loadProcessConfig({ ...ENV, EXPLAIN_ASK_ENABLED: "true", ANTHROPIC_API_KEY: FAKE_KEY });
    expect(config.app.explainAskEnabled).toBe(true);
    expect(config.anthropicApiKey).toBe(FAKE_KEY);
    expect(JSON.stringify(config.app)).not.toContain(FAKE_KEY);
  });

  it("R3.20 enabling Ask without a key stops startup with a message naming the variable", () => {
    expect(() => loadProcessConfig({ ...ENV, EXPLAIN_ASK_ENABLED: "true" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => loadProcessConfig({ ...ENV, EXPLAIN_ASK_ENABLED: "true", ANTHROPIC_API_KEY: "  " })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it("R3.20 a configuration error never echoes the key's value", () => {
    let message = "";
    try {
      loadProcessConfig({ ...ENV, APP_DB_PASSWORD: "", ANTHROPIC_API_KEY: FAKE_KEY, EXPLAIN_ASK_ENABLED: "maybe" });
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/EXPLAIN_ASK_ENABLED/);
    expect(message).not.toContain(FAKE_KEY);
    expect(message).not.toContain("maybe");
  });

  it("R3.20 the flag reads true, false, 1 and 0 and nothing else", () => {
    const flag = (raw: string) => loadProcessConfig({ ...ENV, EXPLAIN_ASK_ENABLED: raw, ANTHROPIC_API_KEY: FAKE_KEY }).app.explainAskEnabled;
    expect([flag("true"), flag("1"), flag("false"), flag("0"), flag(" ")]).toEqual([true, true, false, false, false]);
    expect(() => flag("yes")).toThrow(/EXPLAIN_ASK_ENABLED/);
  });

  it("R3.20 ASK_MODEL must be a priced model and the cap a bounded integer", () => {
    expect(loadProcessConfig({ ...ENV, ASK_MODEL: "claude-sonnet-5-5" }).app.askModel).toBe("claude-sonnet-5-5");
    expect(() => loadProcessConfig({ ...ENV, ASK_MODEL: "gpt-unknown" })).toThrow(/ASK_MODEL/);
    expect(loadProcessConfig({ ...ENV, LLM_MONTHLY_CAP_CENTS: "200" }).app.askMonthlyCapCents).toBe(200);
    expect(() => loadProcessConfig({ ...ENV, LLM_MONTHLY_CAP_CENTS: "-1" })).toThrow(/LLM_MONTHLY_CAP_CENTS/);
  });
});
