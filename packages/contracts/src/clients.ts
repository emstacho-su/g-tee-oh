/**
 * Typed HTTP (Hypertext Transfer Protocol) clients for the two services (R0.7, O-115).
 *
 * openapi-fetch's createClient is typed with the `paths` interface that openapi-typescript
 * generated from each committed OpenAPI (Open Application Programming Interface) document, so a
 * route, method or body the service does not serve is a compile error in the caller and a
 * response body comes back typed. The base URL must be an absolute http or https URL: a relative
 * one would resolve against whatever page or process called the client, which is how a request
 * silently lands on the wrong host.
 */
import createClient, { type Client, type ClientOptions } from "openapi-fetch";

import type { paths as ApiPaths } from "./api.generated.js";
import type { paths as SolverQueryPaths } from "./solver-query.generated.js";

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/** Thrown by the client factories when the base URL is not an absolute http or https URL. */
export class InvalidBaseUrlError extends Error {
  override readonly name = "InvalidBaseUrlError";

  constructor(baseUrl: string, reason: string) {
    super(`invalid base URL ${JSON.stringify(baseUrl)}: ${reason}`);
  }
}

/** What a caller may set per client; `fetch` lets a test answer without opening a socket. */
export type ClientFactoryOptions = Pick<ClientOptions, "fetch">;

function parseUrl(baseUrl: string): URL | null {
  try {
    return new URL(baseUrl);
  } catch {
    return null;
  }
}

/** Returns the base URL when it is absolute http or https; throws InvalidBaseUrlError otherwise. */
export function assertHttpBaseUrl(baseUrl: string): string {
  const parsed = parseUrl(baseUrl);
  if (parsed === null) {
    throw new InvalidBaseUrlError(baseUrl, "not an absolute URL");
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new InvalidBaseUrlError(baseUrl, `protocol ${parsed.protocol} is not http or https`);
  }
  return baseUrl;
}

/** A client for the api service, typed by packages/contracts/api.openapi.json. */
export function createApiClient(baseUrl: string, options: ClientFactoryOptions = {}): Client<ApiPaths> {
  return createClient<ApiPaths>({ baseUrl: assertHttpBaseUrl(baseUrl), ...options });
}

/** A client for solver-query, typed by packages/contracts/solver-query.openapi.json. */
export function createSolverQueryClient(baseUrl: string, options: ClientFactoryOptions = {}): Client<SolverQueryPaths> {
  return createClient<SolverQueryPaths>({ baseUrl: assertHttpBaseUrl(baseUrl), ...options });
}
