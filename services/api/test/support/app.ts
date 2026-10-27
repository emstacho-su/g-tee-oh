/**
 * Builds the api for integration tests and the request headers a logged-in browser sends
 * (R3.1): the session cookie, the CSRF (cross-site request forgery) token and the app Origin.
 */
import { buildApp, type ApiApp } from "../../src/app.js";
import { defaultAppConfig, type AppConfig } from "../../src/config.js";
import type { Database } from "../../src/db.js";
import { CSRF_HEADER } from "../../src/http/headers.js";
import { SESSION_COOKIE_NAME } from "../../src/http/openapi.js";
import type { TestSession } from "./database.js";

export const TEST_CONFIG: AppConfig = defaultAppConfig();
export const APP_ORIGIN = TEST_CONFIG.appOrigin;

export function buildTestApp(database: Database, config: AppConfig = TEST_CONFIG): ApiApp {
  return buildApp({ database, config });
}

export function sessionCookie(session: Pick<TestSession, "token">): string {
  return `${SESSION_COOKIE_NAME}=${session.token}`;
}

/** Headers of an authenticated read. */
export function readHeaders(session: Pick<TestSession, "token">): Record<string, string> {
  return { cookie: sessionCookie(session) };
}

/** Headers of an authenticated mutating request from the app's own origin. */
export function mutatingHeaders(session: Pick<TestSession, "token" | "csrfToken">): Record<string, string> {
  return { cookie: sessionCookie(session), [CSRF_HEADER]: session.csrfToken, origin: APP_ORIGIN };
}
