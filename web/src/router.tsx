/**
 * Route tree for the web app (R0.7, R3.13, A7 sections 1 and 2). Routes are code based: no
 * file-route plugin and no generated route tree to diff-check.
 *
 * Shape: the root route (RootLayout, <div data-testid="shell">) holds /login and a pathless
 * authenticated layout route ("app") that holds every other A7 section 2 route. The layout's
 * beforeLoad ensures the me query through the router context's QueryClient; signed out (null), it
 * redirects to /login?redirect=<current path>. /login's beforeLoad does the reverse: a signed-in
 * user goes to the safe redirect target (safe-redirect.ts) or "/". On /login a 401 is simply
 * signed out; a network or server failure of /me still renders the form, with a visible "service
 * unavailable" note (sessionUnavailable in the route context) and one console.error naming only
 * the status and problem slug. On the layout a /me failure shows SessionError with a retry.
 *
 * createAppRouter takes the QueryClient and api client (the router context) and an optional
 * history, so main.tsx uses the browser history and tests use createMemoryHistory. The Register
 * augmentation at the bottom tells the router's types which router is in use, so Link targets
 * are checked against this tree.
 */
import { createRootRouteWithContext, createRoute, createRouter, redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { RouterHistory } from "@tanstack/react-router";

import type { AppApi } from "./api/index.js";
import { describeFailureForLog } from "./api/http-status.js";
import { AuthLayout } from "./app/AuthLayout.js";
import { parseSearchAsStrings, stringifySearchAsStrings } from "./app/search-serialization.js";
import { RootLayout } from "./app/RootLayout.js";
import type { RouterContext } from "./app/router-context.js";
import { SessionError } from "./app/SessionError.js";
import { fetchMe, meQueryOptions, safeRedirect } from "./auth/index.js";
import { HomePage } from "./routes/home.js";
import { LoginPage } from "./routes/login.js";
import { PaintPage } from "./routes/paint/PaintPage.js";
import { PredictPage } from "./routes/predict/PredictPage.js";
import { ProgressPage } from "./routes/progress/ProgressPage.js";
import { DrillRunPage } from "./routes/drill-run/DrillRunPage.js";
import { validateDrillBuilderSearch, validateDrillsSearch } from "./drills/search.js";
import { DrillBuilderPage } from "./routes/drills/DrillBuilderPage.js";
import { DrillsPage } from "./routes/drills/DrillsPage.js";
import { validateLibrarySearch } from "./library/search.js";
import { LibraryPage } from "./routes/library/LibraryPage.js";
import { SettingsPage } from "./routes/settings/SettingsPage.js";
import { StudyPage } from "./routes/study/StudyPage.js";
import { TrainPage } from "./routes/train/TrainPage.js";
import { trainModeOf, validateTrainSearch } from "./routes/train/train-search.js";
import { validatePracticeSearch } from "./practice/search.js";
import { validateStudySearch } from "./study/search.js";
import { validateDrillRunSearch } from "./trainer/run-search.js";

export interface LoginSearch {
  redirect?: string;
}

/** What /login's beforeLoad adds to the route context: whether the session check itself failed. */
export interface LoginRouteContext {
  sessionUnavailable: boolean;
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({ component: RootLayout });

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>): LoginSearch =>
    typeof search["redirect"] === "string" ? { redirect: search["redirect"] } : {},
  beforeLoad: async ({ context, search }): Promise<LoginRouteContext> => {
    let me: Awaited<ReturnType<typeof fetchMe>>;
    try {
      // A 401 resolves to null (signed out) inside fetchMe; only a network or server failure throws.
      me = await context.queryClient.ensureQueryData(meQueryOptions(context.api));
    } catch (error: unknown) {
      console.error(`g-tee-oh: the session check failed (${describeFailureForLog(error)}); showing the login form`);
      return { sessionUnavailable: true };
    }
    if (me !== null) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's redirect protocol
      throw redirect({ href: safeRedirect(search.redirect), replace: true });
    }
    return { sessionUnavailable: false };
  },
  component: LoginPage,
});

export const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions(context.api));
    if (me === null) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's redirect protocol
      throw redirect({ to: "/login", search: { redirect: location.href }, replace: true });
    }
  },
  component: AuthLayout,
  errorComponent: SessionError,
});

export const homeRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/", component: HomePage });

// /train is a real screen (S32, R4.10, O-328): ?mode=holdout opens the holdout retest. It
// re-validates its search in the route component for the parent-merge reason given below for /study.
export const trainRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/train",
  validateSearch: validateTrainSearch,
  component: function TrainRouteScreen() {
    return <TrainPage mode={trainModeOf(validateTrainSearch(trainRoute.useSearch()))} />;
  },
});
// The drill library and builder (S26, R3.14) re-validate their search in the route component for
// the parent-merge reason given below for /study.
export const drillsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/drills",
  validateSearch: validateDrillsSearch,
  component: function DrillsRouteScreen() {
    return <DrillsPage search={validateDrillsSearch(drillsRoute.useSearch())} />;
  },
});
export const drillNewRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/drills/new", component: () => <DrillBuilderPage /> });
export const drillRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/drills/$id",
  validateSearch: validateDrillBuilderSearch,
  component: function DrillBuilderRouteScreen() {
    const { id } = drillRoute.useParams();
    const { saved } = validateDrillBuilderSearch(drillRoute.useSearch());
    return <DrillBuilderPage key={id} drillId={id} justCreated={saved === "1"} />;
  },
});
// /study and /drills/$id/run are real screens (S25, O-286, O-288). validateSearch types the
// routes' search for links, but the router merges every parent's raw search into a child's
// (router-core matchRoutes: search = { ...parentSearch, ...strictSearch }), so a key the validator
// dropped (?seed=XYZ) is still present in useSearch(). The route components therefore pass the
// screens only what the validator returns for the current search, never useSearch() itself.
export const drillRunRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/drills/$id/run",
  validateSearch: validateDrillRunSearch,
  component: function DrillRunRouteScreen() {
    const { id } = drillRunRoute.useParams();
    const { seed } = validateDrillRunSearch(drillRunRoute.useSearch());
    return <DrillRunPage drillId={id} {...(seed === undefined ? {} : { seed })} />;
  },
});
export const studyRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/study",
  validateSearch: validateStudySearch,
  component: function StudyRouteScreen() {
    return <StudyPage search={validateStudySearch(studyRoute.useSearch())} />;
  },
});
// /predict and /paint are real screens (S27, O-302) with the same re-validation rule as /study.
export const predictRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/predict",
  validateSearch: validatePracticeSearch,
  component: function PredictRouteScreen() {
    return <PredictPage search={validatePracticeSearch(predictRoute.useSearch())} />;
  },
});
export const paintRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/paint",
  validateSearch: validatePracticeSearch,
  component: function PaintRouteScreen() {
    return <PaintPage search={validatePracticeSearch(paintRoute.useSearch())} />;
  },
});
// /progress is a real screen (S32, R4.12); it takes no search, so it needs no re-validation.
export const progressRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/progress", component: ProgressPage });
// /library and /settings are real screens (S28, R3.4, R3.5); /library re-validates its search in
// the route component for the same parent-merge reason as /study above.
export const libraryRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/library",
  validateSearch: validateLibrarySearch,
  component: function LibraryRouteScreen() {
    return <LibraryPage search={validateLibrarySearch(libraryRoute.useSearch())} />;
  },
});
export const settingsRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/settings", component: SettingsPage });

export const routeTree = rootRoute.addChildren([
  loginRoute,
  appLayoutRoute.addChildren([
    homeRoute,
    trainRoute,
    drillsRoute,
    drillNewRoute,
    drillRoute,
    drillRunRoute,
    studyRoute,
    predictRoute,
    paintRoute,
    progressRoute,
    libraryRoute,
    settingsRoute,
  ]),
]);

export interface AppRouterOptions {
  queryClient: QueryClient;
  api: AppApi;
  history?: RouterHistory;
}

export function createAppRouter({ queryClient, api, history }: AppRouterOptions) {
  return createRouter({
    routeTree,
    context: { queryClient, api },
    // Every query value stays the string in the URL, so ?hand=77 and numeric-looking seeds reach
    // the string-only validators intact (search-serialization.ts, O-286, O-288).
    parseSearch: parseSearchAsStrings,
    stringifySearch: stringifySearchAsStrings,
    ...(history === undefined ? {} : { history }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
