/**
 * The Playwright base address (R0.3, R0.7). The edge Caddy serves exactly one https site, the
 * Caddyfile's `https://{$CADDY_SITE:localhost}` block, so the address the flow drives must name
 * that site or Caddy answers with no certificate and no routes. Resolution order: E2E_BASE_URL
 * when set (the CI runner's override), else https://<CADDY_SITE> with CADDY_SITE from the
 * environment or else from the repo .env (the same file compose reads), else https://localhost,
 * the Caddyfile's own fallback. A blank value counts as unset.
 *
 * resolveBaseUrl takes the environment and the .env lookup as arguments, so the tests touch
 * neither. envFileLookup parses the file with util.parseEnv for one key and never loads it into
 * the process environment, so the credentials in .env stay out of the browser processes that
 * Playwright starts.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export const DEFAULT_CADDY_SITE = "localhost";
export const DEFAULT_BASE_URL = `https://${DEFAULT_CADDY_SITE}`;
const BASE_URL_VARIABLE = "E2E_BASE_URL";
const CADDY_SITE_VARIABLE = "CADDY_SITE";

export type EnvLookup = (name: string) => string | undefined;
export type Environment = Readonly<Record<string, string | undefined>>;

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

/** A lookup over the .env file at `path`: undefined when the file or the key is absent. */
export function envFileLookup(path: string): EnvLookup {
  return (name) => {
    if (!existsSync(path)) return undefined;
    return parseEnv(readFileSync(path, "utf8"))[name];
  };
}

/** The base address for `env`, with `fromFile` answering for CADDY_SITE; see the header. */
export function resolveBaseUrl(env: Environment, fromFile: EnvLookup): string {
  const override = nonBlank(env[BASE_URL_VARIABLE]);
  if (override !== undefined) return override;
  const site =
    nonBlank(env[CADDY_SITE_VARIABLE]) ?? nonBlank(fromFile(CADDY_SITE_VARIABLE)) ?? DEFAULT_CADDY_SITE;
  return `https://${site}`;
}
