/**
 * Process configuration read at the boundary (R0.7, R3.1). Every variable is parsed with Zod once
 * at startup, so a missing or malformed value stops the process with a message naming it instead
 * of failing on the first request (A9 section 3).
 *
 * A5 section 1 fixes the listen address to every interface inside the compose network, which
 * Caddy fronts. The database connection is the app_login user, a member of the app group role
 * (O-28); compose passes PGHOST, PGPORT, PGDATABASE and PGUSER literally and APP_DB_PASSWORD from
 * .env. APP_ORIGIN is the one browser origin CORS (cross-origin resource sharing) and the CSRF
 * (cross-site request forgery) Origin check accept (A9 section 3, O-230).
 */
import { z } from "zod";

export const DEFAULT_API_PORT = 8080;
export const LISTEN_HOST = "0.0.0.0";
export const DEFAULT_APP_ORIGIN = "https://localhost";
export const DEFAULT_PG_PORT = 5432;
/** O-231: sessions expire seven days after login, with no sliding renewal. */
export const DEFAULT_SESSION_TTL_HOURS = 168;
export const MAX_SESSION_TTL_HOURS = 24 * 90;
/** Caddy is the one proxy hop in front of the api (A5 section 1, O-236). */
export const DEFAULT_TRUST_PROXY_HOPS = 1;

const MIN_PORT = 1;
const MAX_PORT = 65535;

const portSchema = z
  .string()
  .regex(/^[0-9]+$/, "base-10 digits only")
  .transform((digits) => Number(digits))
  .pipe(z.number().int().min(MIN_PORT).max(MAX_PORT));

/** Parses API_PORT; an unset or blank value means the default, anything else must be a port. */
export function parseApiPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_API_PORT;
  }
  const result = portSchema.safeParse(raw.trim());
  if (!result.success) {
    throw new Error(`API_PORT must be an integer between ${MIN_PORT} and ${MAX_PORT}, got "${raw}"`);
  }
  return result.data;
}

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
  trustProxyHops: number;
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
    trustProxyHops: DEFAULT_TRUST_PROXY_HOPS,
  };
}

function isBareOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

const originSchema = z
  .url({ protocol: /^https?$/ })
  .refine(isBareOrigin, "an origin: scheme and host, no path or trailing slash");

const blankAsUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const envSchema = z.object({
  API_PORT: z.string().optional(),
  APP_ORIGIN: z.preprocess(blankAsUndefined, originSchema.default(DEFAULT_APP_ORIGIN)),
  SESSION_TTL_HOURS: z.preprocess(
    blankAsUndefined,
    z.coerce.number().int().min(1).max(MAX_SESSION_TTL_HOURS).default(DEFAULT_SESSION_TTL_HOURS),
  ),
  TRUST_PROXY_HOPS: z.preprocess(
    blankAsUndefined,
    z.coerce.number().int().min(0).max(10).default(DEFAULT_TRUST_PROXY_HOPS),
  ),
  PGHOST: z.string().min(1),
  PGPORT: z.preprocess(blankAsUndefined, z.coerce.number().int().min(MIN_PORT).max(MAX_PORT).default(DEFAULT_PG_PORT)),
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
    port: parseApiPort(parsed.API_PORT),
    app: {
      appOrigin: parsed.APP_ORIGIN,
      sessionTtlHours: parsed.SESSION_TTL_HOURS,
      trustProxyHops: parsed.TRUST_PROXY_HOPS,
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
