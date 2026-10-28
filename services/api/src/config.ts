/**
 * Process configuration read at the boundary (R0.7, R3.1). Every variable is parsed with one Zod
 * schema at startup, so a missing or malformed value stops the process with one message naming
 * every bad variable instead of failing on the first request (A9 section 3).
 *
 * A5 section 1 fixes the listen address to every interface inside the compose network, which
 * Caddy fronts. The database connection is the app_login user, a member of the app group role
 * (O-28); compose passes PGHOST, PGPORT, PGDATABASE and PGUSER literally and APP_DB_PASSWORD from
 * .env. APP_ORIGIN is the one browser origin CORS (cross-origin resource sharing) and the CSRF
 * (cross-site request forgery) Origin check accept (A9 section 3, O-230).
 *
 * TRUSTED_PROXIES (O-236 as amended after the PR #20 security review) names the proxies whose
 * X-Forwarded-For is believed, by address: proxy-addr presets (loopback, linklocal, uniquelocal),
 * single addresses or CIDR ranges. The default is loopback only, so a client that reaches the api
 * directly cannot pick its own address for the rate limiter by sending X-Forwarded-For. Compose
 * sets uniquelocal, because there the api publishes no port and only containers on the private
 * compose network, Caddy among them, can reach it.
 *
 * Ask (O-305, O-306, O-5): EXPLAIN_ASK_ENABLED (true, false, 1 or 0; off by default) turns the
 * model path on, ASK_MODEL picks a priced model (explain/pricing.ts, the claude-api skill's
 * default when unset) and LLM_MONTHLY_CAP_CENTS caps the spend per UTC month (1,500 cents). The
 * key, ANTHROPIC_API_KEY, is read into ProcessConfig only: never into AppConfig, which the routes
 * see, never into a response or a log. Enabling Ask without a key stops startup, and like every
 * other configuration error the message names the variable, never its value.
 */
import { isIP } from "node:net";

import { z } from "zod";

import { ASK_MODELS, type AskModel, DEFAULT_ASK_MODEL } from "./explain/pricing.js";
import { DEFAULT_SOLVER_QUERY_TIMEOUT_MS } from "./solver-query/client.js";

export { DEFAULT_ASK_MODEL } from "./explain/pricing.js";

export const DEFAULT_API_PORT = 8080;
export const LISTEN_HOST = "0.0.0.0";
export const DEFAULT_APP_ORIGIN = "https://localhost";
export const DEFAULT_PG_PORT = 5432;
/** O-231: sessions expire seven days after login, with no sliding renewal. */
export const DEFAULT_SESSION_TTL_HOURS = 168;
export const MAX_SESSION_TTL_HOURS = 24 * 90;
/** Only the local host is trusted as a proxy unless TRUSTED_PROXIES says otherwise (O-236). */
export const DEFAULT_TRUSTED_PROXIES: readonly string[] = ["loopback"];
export const TRUSTED_PROXY_PRESETS: readonly string[] = ["loopback", "linklocal", "uniquelocal"];
/** O-5, O-306: the monthly Ask budget in cents. */
export const DEFAULT_LLM_MONTHLY_CAP_CENTS = 1500;
const MAX_LLM_MONTHLY_CAP_CENTS = 1_000_000;
const FLAG_VALUES: Readonly<Record<string, boolean>> = { true: true, "1": true, false: false, "0": false };

const MIN_PORT = 1;
const MAX_PORT = 65535;
const IPV4_MAX_PREFIX = 32;
const IPV6_MAX_PREFIX = 128;

const portSchema = z
  .string()
  .regex(/^[0-9]+$/, "base-10 digits only")
  .transform((digits) => Number(digits))
  .pipe(z.number().int().min(MIN_PORT).max(MAX_PORT));

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface AppConfig {
  /** The browser origin allowed by CORS and the CSRF Origin check, scheme and host, no path. */
  appOrigin: string;
  sessionTtlHours: number;
  /** Proxies trusted for X-Forwarded-For, by address (O-236). */
  trustedProxies: readonly string[];
  /** The IANA time zone whose midnight starts a training day (O-247, O-214). */
  timeZone: string;
  /** The Ask feature flag (O-305); a model client exists only when it is on. */
  explainAskEnabled: boolean;
  /** The model Ask calls, one with known prices (O-305). */
  askModel: AskModel;
  /** The Ask spend cap per UTC calendar month, in cents (O-5, O-306). */
  askMonthlyCapCents: number;
}

export interface ProcessConfig {
  port: number;
  app: AppConfig;
  database: DatabaseConfig;
  /** solver-query's base URL on the compose network (A5 section 1, O-244). */
  solverQueryUrl: string;
  /** How long one solver-query call may take before it is aborted as a 502 (PR #25 review M1). */
  solverQueryTimeoutMs: number;
  /** The model API key (O-305): here only, never in AppConfig, a response or a log; null when unset. */
  anthropicApiKey: string | null;
}

const MAX_SOLVER_QUERY_TIMEOUT_MS = 60_000;

/** solver-query inside the compose network: its service name and its internal port (A5 section 1). */
export const DEFAULT_SOLVER_QUERY_URL = "http://solver-query:7070";
/** O-247: the training day starts at midnight UTC unless APP_TIME_ZONE names another zone. */
export const DEFAULT_TIME_ZONE = "UTC";

/** The configuration buildApp uses when none is given: the dev profile's values. */
export function defaultAppConfig(): AppConfig {
  return {
    appOrigin: DEFAULT_APP_ORIGIN,
    sessionTtlHours: DEFAULT_SESSION_TTL_HOURS,
    trustedProxies: [...DEFAULT_TRUSTED_PROXIES],
    timeZone: DEFAULT_TIME_ZONE,
    explainAskEnabled: false,
    askModel: DEFAULT_ASK_MODEL,
    askMonthlyCapCents: DEFAULT_LLM_MONTHLY_CAP_CENTS,
  };
}

/** True when Intl knows the zone, so a typo stops the process at startup instead of at midnight. */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** An absolute http or https URL with no path beyond "/", no query and no fragment. */
export function isServiceBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const httpProtocol = url.protocol === "http:" || url.protocol === "https:";
    return httpProtocol && url.search === "" && url.hash === "" && !value.includes("?") && !value.includes("#");
  } catch {
    return false;
  }
}

function isBareOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

/** A proxy-addr preset, an IP address, or an IP address with a prefix length that fits it. */
export function isTrustedProxyEntry(entry: string): boolean {
  if (TRUSTED_PROXY_PRESETS.includes(entry)) {
    return true;
  }
  const [address = "", prefix, ...rest] = entry.split("/");
  const family = isIP(address);
  if (family === 0 || rest.length > 0) {
    return false;
  }
  if (prefix === undefined) {
    return true;
  }
  const maxPrefix = family === 4 ? IPV4_MAX_PREFIX : IPV6_MAX_PREFIX;
  return /^[0-9]{1,3}$/.test(prefix) && Number(prefix) <= maxPrefix;
}

const originSchema = z
  .url({ protocol: /^https?$/ })
  .refine(isBareOrigin, "an origin: scheme and host, no path or trailing slash");

const trimmedOrUndefined = (value: unknown) => {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const trustedProxiesSchema = z
  .string()
  .transform((raw) => raw.split(",").map((entry) => entry.trim()))
  .refine((entries) => entries.every(isTrustedProxyEntry), {
    message: `a comma-separated list of ${TRUSTED_PROXY_PRESETS.join(", ")}, addresses or CIDR ranges`,
  });

const flagSchema = z
  .string()
  .refine((raw) => Object.hasOwn(FLAG_VALUES, raw), "true, false, 1 or 0")
  .transform((raw) => FLAG_VALUES[raw] === true);

const envSchema = z
  .object({
    API_PORT: z.preprocess(trimmedOrUndefined, portSchema.optional()),
    APP_ORIGIN: z.preprocess(trimmedOrUndefined, originSchema.default(DEFAULT_APP_ORIGIN)),
    SESSION_TTL_HOURS: z.preprocess(
      trimmedOrUndefined,
      z.coerce.number().int().min(1).max(MAX_SESSION_TTL_HOURS).default(DEFAULT_SESSION_TTL_HOURS),
    ),
    TRUSTED_PROXIES: z.preprocess(trimmedOrUndefined, trustedProxiesSchema.optional()),
    SOLVER_QUERY_URL: z.preprocess(
      trimmedOrUndefined,
      z
        .string()
        .refine(isServiceBaseUrl, "an absolute http or https URL with no query or fragment")
        .default(DEFAULT_SOLVER_QUERY_URL),
    ),
    SOLVER_QUERY_TIMEOUT_MS: z.preprocess(
      trimmedOrUndefined,
      z.coerce.number().int().min(1).max(MAX_SOLVER_QUERY_TIMEOUT_MS).default(DEFAULT_SOLVER_QUERY_TIMEOUT_MS),
    ),
    APP_TIME_ZONE: z.preprocess(
      trimmedOrUndefined,
      z.string().refine(isTimeZone, "an IANA time zone such as UTC or America/New_York").default(DEFAULT_TIME_ZONE),
    ),
    PGHOST: z.string().min(1),
    PGPORT: z.preprocess(trimmedOrUndefined, z.coerce.number().int().min(MIN_PORT).max(MAX_PORT).default(DEFAULT_PG_PORT)),
    PGDATABASE: z.string().min(1),
    PGUSER: z.string().min(1),
    APP_DB_PASSWORD: z.string().min(1),
    EXPLAIN_ASK_ENABLED: z.preprocess(trimmedOrUndefined, flagSchema.default(false)),
    ANTHROPIC_API_KEY: z.preprocess(trimmedOrUndefined, z.string({ message: "a model API key" }).optional()),
    ASK_MODEL: z.preprocess(
      trimmedOrUndefined,
      z.enum(ASK_MODELS, { message: `one of ${ASK_MODELS.join(", ")}` }).default(DEFAULT_ASK_MODEL),
    ),
    LLM_MONTHLY_CAP_CENTS: z.preprocess(
      trimmedOrUndefined,
      z.coerce.number().int().min(0).max(MAX_LLM_MONTHLY_CAP_CENTS).default(DEFAULT_LLM_MONTHLY_CAP_CENTS),
    ),
  })
  .superRefine((env, context) => {
    // O-305: the flag needs a key; the message names the variable and never a value.
    if (env.EXPLAIN_ASK_ENABLED && env.ANTHROPIC_API_KEY === undefined) {
      context.addIssue({ code: "custom", path: ["ANTHROPIC_API_KEY"], message: "required when EXPLAIN_ASK_ENABLED is true" });
    }
  });

/** Reads the whole process configuration; throws one error naming every bad variable. */
export function loadProcessConfig(env: Readonly<Record<string, string | undefined>>): ProcessConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`invalid api configuration: ${problems.join("; ")}`);
  }
  const parsed = result.data;
  return {
    port: parsed.API_PORT ?? DEFAULT_API_PORT,
    app: {
      appOrigin: parsed.APP_ORIGIN,
      sessionTtlHours: parsed.SESSION_TTL_HOURS,
      trustedProxies: parsed.TRUSTED_PROXIES ?? [...DEFAULT_TRUSTED_PROXIES],
      timeZone: parsed.APP_TIME_ZONE,
      explainAskEnabled: parsed.EXPLAIN_ASK_ENABLED,
      askModel: parsed.ASK_MODEL,
      askMonthlyCapCents: parsed.LLM_MONTHLY_CAP_CENTS,
    },
    solverQueryUrl: parsed.SOLVER_QUERY_URL,
    solverQueryTimeoutMs: parsed.SOLVER_QUERY_TIMEOUT_MS,
    anthropicApiKey: parsed.ANTHROPIC_API_KEY ?? null,
    database: {
      host: parsed.PGHOST,
      port: parsed.PGPORT,
      database: parsed.PGDATABASE,
      user: parsed.PGUSER,
      password: parsed.APP_DB_PASSWORD,
    },
  };
}
