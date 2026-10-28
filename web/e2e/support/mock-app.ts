/**
 * The whole mocked app api (S25, S26, S27, S28, O-264): the auth routes plus the study, drill,
 * session and library routes, and the prediction, range-painting, insight and explanation routes,
 * for the shots project and any mock flow that walks past the home shell. createMockApi() alone
 * stays auth only, so the S24 sign-in tests keep their 501 expectations for unbuilt paths. Each app
 * mock gets its own stateful routes, so two pages never share a mocked drill, session or queue. The
 * drill route (mock-drills.ts) comes before the session route, so GET /drills/{id} reads the drill
 * store, and the session route starts sessions on any drill in that store through drillOf (S26). A
 * member app mock (admin false) signs in as the member fixture and is refused the admin routes
 * (O-290, O-242).
 */
import type { Page } from "@playwright/test";

import { fixtureMemberSession, fixtureSession } from "../../src/fixtures/index.js";
import { createMockApi, installMockApi, type MockApi } from "./mock-api.js";
import { createMockDrillRoute } from "./mock-drills.js";
import { createMockExplainRoute } from "./mock-explain.js";
import { createMockInsightsRoute } from "./mock-insights.js";
import { createMockLibraryRoute } from "./mock-library.js";
import { createMockPaintRoute } from "./mock-paint.js";
import { createMockPredictionRoute } from "./mock-prediction.js";
import { createMockSessionRoute } from "./mock-sessions.js";
import { mockStudyRoute } from "./mock-study.js";

export interface AppMockOptions {
  /** Sign in as the admin owner (default) or as a member. */
  readonly admin?: boolean;
}

export function createAppMockApi(options: AppMockOptions = {}): MockApi {
  const admin = options.admin ?? true;
  const drills = createMockDrillRoute();
  return createMockApi({
    // The drill route comes before the session route so GET /drills/{id} reads the drill store
    // (S26). The prediction and paint routes come before the session route so they answer POST
    // /sessions for their own modes (O-302); the session route answers the drill mode.
    routes: [
      mockStudyRoute,
      drills,
      createMockPredictionRoute(),
      createMockPaintRoute(),
      createMockSessionRoute({ drillOf: drills.drillOf }),
      createMockLibraryRoute({ admin }),
      createMockInsightsRoute(),
      createMockExplainRoute(),
    ],
    session: admin ? fixtureSession : fixtureMemberSession,
  });
}

export function installAppMockApi(page: Page, options: AppMockOptions = {}): Promise<MockApi> {
  return installMockApi(page, createAppMockApi(options));
}
