/**
 * The whole mocked app api (S25, O-264): the auth routes plus the study and session routes, for
 * the shots project and any mock flow that walks past the home shell. createMockApi() alone stays
 * auth only, so the S24 sign-in tests keep their 501 expectations for unbuilt paths.
 */
import type { Page } from "@playwright/test";

import { createMockApi, installMockApi, type MockApi } from "./mock-api.js";
import { mockSessionRoute } from "./mock-sessions.js";
import { mockStudyRoute } from "./mock-study.js";

export function createAppMockApi(): MockApi {
  return createMockApi({ routes: [mockStudyRoute, mockSessionRoute] });
}

export function installAppMockApi(page: Page): Promise<MockApi> {
  return installMockApi(page, createAppMockApi());
}
