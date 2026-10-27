/**
 * Root layout (R0.7, R3.13). Wraps every route, /login included, in <div data-testid="shell">,
 * which the S06 Playwright smoke flow and the R0.7 router test look for. The wrapper is a plain
 * div so the header, the Main navigation and the main region below it are top-level landmarks:
 * each layout (the login page, the authenticated layout) renders its own <main>.
 */
import { Outlet } from "@tanstack/react-router";

export function RootLayout() {
  return (
    <div data-testid="shell" className="min-h-screen bg-surface text-text">
      <Outlet />
    </div>
  );
}
