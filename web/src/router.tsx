/**
 * Route tree for the web app (R0.7, A7 section 1). Routes are code based: no file-route
 * plugin and no generated route tree to diff-check. S06 lands the shell, the home placeholder
 * and the /login placeholder; the other A7 section 2 routes arrive with S24 and later.
 *
 * createAppRouter takes an optional history so main.tsx uses the browser history and tests use
 * createMemoryHistory. The Register augmentation at the bottom tells the router's types which
 * router instance is in use, so Link targets are checked against this tree.
 */
import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";

import { HomePage } from "./routes/home.js";
import { LoginPage } from "./routes/login.js";

const HOME_PATH = "/";
const LOGIN_PATH = "/login";

function Shell() {
  return (
    <main data-testid="shell">
      <Outlet />
    </main>
  );
}

export const rootRoute = createRootRoute({ component: Shell });

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: HOME_PATH,
  component: HomePage,
});

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: LOGIN_PATH,
  component: LoginPage,
});

export const routeTree = rootRoute.addChildren([homeRoute, loginRoute]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    ...(history === undefined ? {} : { history }),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
