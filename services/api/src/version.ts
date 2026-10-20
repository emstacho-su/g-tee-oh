/**
 * The api version served in the health JSON and in the OpenAPI (Open Application Programming
 * Interface) document comes from package.json so the three never drift. esbuild inlines the
 * JSON import into the bundle; vitest reads it from disk.
 */
import packageJson from "../package.json" with { type: "json" };

export const API_SERVICE_NAME = "api" as const;

export const API_VERSION: string = packageJson.version;
