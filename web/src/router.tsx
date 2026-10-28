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
import { RootLayout } from "./app/RootLayout.js";
import type { RouterContext } from "./app/router-context.js";
import { SessionError } from "./app/SessionError.js";
import { fetchMe, meQueryOptions, safeRedirect } from "./auth/index.js";
import { HomePage } from "./routes/home.js";
import { LoginPage } from "./routes/login.js";
import { DrillRunPage } from "./routes/drill-run/DrillRunPage.js";
import { placeholderRoute } from "./routes/placeholders.js";
import type { PlaceholderKey } from "./routes/placeholders.js";
import { StudyPage } from "./routes/study/StudyPage.js";
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

function screenRoute<TPath extends string>(path: TPath, key: PlaceholderKey) {
  return createRoute({ getParentRoute: () => appLayoutRoute, path, component: placeholderRoute(key) });
}

export const trainRoute = screenRoute("/train", "train");
export const drillsRoute = screenRoute("/drills", "drills");
export const drillNewRoute = screenRoute("/drills/new", "drillNew");
export const drillRoute = screenRoute("/drills/$id", "drillEdit");
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
export const predictRoute = screenRoute("/predict", "predict");
export const paintRoute = screenRoute("/paint", "paint");
export const progressRoute = screenRoute("/progress", "progress");
export const libraryRoute = screenRoute("/library", "library");
export const settingsRoute = screenRoute("/settings", "settings");

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
    ...(history === undefined ? {} : { history }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
