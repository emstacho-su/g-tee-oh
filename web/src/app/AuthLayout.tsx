/**
 * The authenticated layout (R3.13, A7 section 2): the hotkey root, header, the Main navigation as a sidebar on
 * desktop (stacked at narrow widths, which are a sanity view only, O-266), the route content and
 * the shortcuts hint. The route's beforeLoad (router.tsx) already proved a session; if the me
 * query later turns null (a 401 anywhere, see query-client.ts), this layout sends the user to
 * /login with the current path as the redirect.
 */
import { Navigate, Outlet, useLocation } from "@tanstack/react-router";

import { useMe } from "../auth/index.js";
import { CosmeticsRoot } from "../cosmetics/CosmeticsRoot.js";
import { HotkeyRoot } from "../hotkeys/index.js";
import { AppHeader } from "./AppHeader.js";
import { MainNav } from "./MainNav.js";

export const SHORTCUTS_HINT = "Press ? for shortcuts";
const LOGIN_PATH = "/login";

export function AuthLayout() {
  const me = useMe();
  const location = useLocation();
  if (me.data === null) {
    // While a navigation to /login is already under way the location is /login itself; sending
    // it again as the redirect would nest /login inside its own redirect on every render.
    if (location.pathname === LOGIN_PATH) return null;
    return <Navigate to="/login" search={{ redirect: location.href }} replace />;
  }
  return (
    <div className="flex min-h-screen flex-col">
      {/* One window keydown listener and the ? shortcuts overlay for every signed-in screen (A7 section 4) */}
      <HotkeyRoot />
      <CosmeticsRoot />
      <AppHeader />
      <div className="flex flex-1 flex-col gap-4 p-4 md:flex-row">
        <MainNav />
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
      <p className="border-t border-border px-4 py-2 text-sm text-muted">{SHORTCUTS_HINT}</p>
    </div>
  );
}
