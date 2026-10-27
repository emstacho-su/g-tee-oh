/**
 * Root layout (R0.7, R3.13). Wraps every route, /login included, in <main data-testid="shell">,
 * which the S06 Playwright smoke flow and the R0.7 router test look for.
 */
import { Outlet } from "@tanstack/react-router";

export function RootLayout() {
  return (
    <main data-testid="shell" className="min-h-screen bg-surface text-text">
      <Outlet />
    </main>
  );
}
