/**
 * A small router for the drill run screen's tests (S26, R3.14, PR #30 review MEDIUM 4). The
 * screen's notes link to /library through the router Link, which needs a router around it. This
 * one has two routes over a memory history: SCREEN_PATH renders whatever the test passes as the
 * screen (through a context, so a rerender with new props reaches it), and /library renders a
 * marker, so a test can follow the link and see a client-side navigation: the click's default is
 * prevented (no full page load) and the router's location becomes /library.
 */
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { act, render, type RenderResult } from "@testing-library/react";
import { createContext, useContext, type ReactElement, type ReactNode } from "react";

export const SCREEN_PATH = "/screen";
export const LIBRARY_ROUTE_PATH = "/library";
export const LIBRARY_MARKER_ID = "library-route";

const ScreenContext = createContext<ReactNode>(null);

function Screen() {
  return <>{useContext(ScreenContext)}</>;
}

function LibraryMarker() {
  return <p data-testid={LIBRARY_MARKER_ID}>Library route</p>;
}

export function createScreenRouter() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const screenRoute = createRoute({ getParentRoute: () => rootRoute, path: SCREEN_PATH, component: Screen });
  const libraryRoute = createRoute({ getParentRoute: () => rootRoute, path: LIBRARY_ROUTE_PATH, component: LibraryMarker });
  return createRouter({
    routeTree: rootRoute.addChildren([screenRoute, libraryRoute]),
    history: createMemoryHistory({ initialEntries: [SCREEN_PATH] }),
  });
}

export type ScreenRouter = ReturnType<typeof createScreenRouter>;

export interface ScreenRouterViewProps {
  router: ScreenRouter;
  children: ReactNode;
}

/** Renders children as the screen route of router; providers around it reach the children. */
export function ScreenRouterView({ router, children }: ScreenRouterViewProps) {
  return (
    <ScreenContext.Provider value={children}>
      {/* The test router is not the app's registered router type; its two paths are a subset of the app's. */}
      <RouterProvider router={router as never} />
    </ScreenContext.Provider>
  );
}

export type RenderedInRouter = RenderResult & { router: ScreenRouter };

/** Renders ui at SCREEN_PATH once the router has matched it; rerender keeps the same router. */
export async function renderInRouter(ui: ReactElement): Promise<RenderedInRouter> {
  const router = createScreenRouter();
  await router.load();
  const wrapper = ({ children }: { children: ReactNode }) => <ScreenRouterView router={router}>{children}</ScreenRouterView>;
  const view: RenderResult = render(ui, { wrapper });
  // Let the router's first render settle before the test reads the screen.
  await act(async () => {
    await Promise.resolve();
  });
  return { ...view, router };
}
