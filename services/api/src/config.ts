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
 */
import { isIP } from "node:net";

import { z } from "zod";

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
}

export interface ProcessConfig {
  port: number;
  app: AppConfig;
  database: DatabaseConfig;
}

/** The configuration buildApp uses when none is given: the dev profile's values. */
export function defaultAppConfig(): AppConfig {
  return {
    appOrigin: DEFAULT_APP_ORIGIN,
    sessionTtlHours: DEFAULT_SESSION_TTL_HOURS,
    trustedProxies: [...DEFAULT_TRUSTED_PROXIES],
  };
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

const envSchema = z.object({
  API_PORT: z.preprocess(trimmedOrUndefined, portSchema.optional()),
  APP_ORIGIN: z.preprocess(trimmedOrUndefined, originSchema.default(DEFAULT_APP_ORIGIN)),
  SESSION_TTL_HOURS: z.preprocess(
    trimmedOrUndefined,
    z.coerce.number().int().min(1).max(MAX_SESSION_TTL_HOURS).default(DEFAULT_SESSION_TTL_HOURS),
  ),
  TRUSTED_PROXIES: z.preprocess(trimmedOrUndefined, trustedProxiesSchema.optional()),
  PGHOST: z.string().min(1),
  PGPORT: z.preprocess(trimmedOrUndefined, z.coerce.number().int().min(MIN_PORT).max(MAX_PORT).default(DEFAULT_PG_PORT)),
  PGDATABASE: z.string().min(1),
  PGUSER: z.string().min(1),
  APP_DB_PASSWORD: z.string().min(1),
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
    },
    database: {
      host: parsed.PGHOST,
      port: parsed.PGPORT,
      database: parsed.PGDATABASE,
      user: parsed.PGUSER,
      password: parsed.APP_DB_PASSWORD,
    },
  };
}
