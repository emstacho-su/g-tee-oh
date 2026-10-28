/**
 * The whole mocked app api (S25, S28, S27, O-264): the auth routes plus the study, session and
 * library routes, the prediction, range-painting, insight and explanation routes, and the S32
 * progress routes (a seasoned learner unless the options say fresh), for the shots
 * project and any mock flow that walks past the home shell. createMockApi() alone stays auth only,
 * so the S24 sign-in tests keep their 501 expectations for unbuilt paths. Each app mock gets its own
 * stateful routes, so two pages never share a mocked session or queue. A member app mock (admin
 * false) signs in as the member fixture and is refused the admin routes (O-290, O-242).
 */
import type { Page } from "@playwright/test";

import { fixtureMemberSession, fixtureSession } from "../../src/fixtures/index.js";
import { createMockApi, installMockApi, type MockApi } from "./mock-api.js";
import { createMockExplainRoute } from "./mock-explain.js";
import { createMockInsightsRoute } from "./mock-insights.js";
import { createMockLibraryRoute } from "./mock-library.js";
import { createMockPaintRoute } from "./mock-paint.js";
import { createMockPredictionRoute } from "./mock-prediction.js";
import { createMockProgressRoute, type MockLearner, type MockProgress } from "./mock-progress.js";
import { createMockSessionRoute } from "./mock-sessions.js";
import { mockStudyRoute } from "./mock-study.js";

export interface AppMockOptions {
  /** Sign in as the admin owner (default) or as a member. */
  readonly admin?: boolean;
  /** The progress learner (S32): seasoned (default) or a fresh account before any rated session. */
  readonly learner?: MockLearner;
  /** Receives the progress control, so a mocked session end can move the learner (mock flow 1). */
  readonly onProgress?: (progress: MockProgress) => void;
}

export function createAppMockApi(options: AppMockOptions = {}): MockApi {
  const admin = options.admin ?? true;
  const progress = createMockProgressRoute(options.learner ?? "seasoned");
  options.onProgress?.(progress);
  return createMockApi({
    // The prediction and paint routes come before the session route so they answer POST /sessions
    // for their own modes (O-302); the session route answers the drill mode.
    routes: [
      mockStudyRoute,
      createMockPredictionRoute(),
      createMockPaintRoute(),
      createMockSessionRoute(),
      createMockLibraryRoute({ admin }),
      createMockInsightsRoute(),
      createMockExplainRoute(),
      progress.route,
    ],
    session: admin ? fixtureSession : fixtureMemberSession,
  });
}

export function installAppMockApi(page: Page, options: AppMockOptions = {}): Promise<MockApi> {
  return installMockApi(page, createAppMockApi(options));
}
