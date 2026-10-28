/**
 * The whole mocked app api (S25, O-264): the auth routes plus the study and session routes, and
 * since S27 the prediction, range-painting, insight and explanation routes, for the shots project
 * and any mock flow that walks past the home shell. createMockApi() alone stays auth only, so the
 * S24 sign-in tests keep their 501 expectations for unbuilt paths. Each app mock gets its own
 * stateful routes, so two pages never share a mocked session.
 */
import type { Page } from "@playwright/test";

import { createMockApi, installMockApi, type MockApi } from "./mock-api.js";
import { createMockExplainRoute } from "./mock-explain.js";
import { createMockInsightsRoute } from "./mock-insights.js";
import { createMockPaintRoute } from "./mock-paint.js";
import { createMockPredictionRoute } from "./mock-prediction.js";
import { createMockSessionRoute } from "./mock-sessions.js";
import { mockStudyRoute } from "./mock-study.js";

export function createAppMockApi(): MockApi {
  return createMockApi({
    // The prediction and paint routes come before the session route so they answer POST /sessions
    // for their own modes (O-302); the session route answers the drill mode.
    routes: [
      mockStudyRoute,
      createMockPredictionRoute(),
      createMockPaintRoute(),
      createMockSessionRoute(),
      createMockInsightsRoute(),
      createMockExplainRoute(),
    ],
  });
}

export function installAppMockApi(page: Page): Promise<MockApi> {
  return installMockApi(page, createAppMockApi());
}
