/**
 * The shell header (R3.13, A7 section 2): app name, the signed-in email, the theme toggle and
 * Sign out. Sign out is disabled while its request runs.
 */
import { useLogout, useMe } from "../auth/index.js";
import { Button } from "../components/ui/index.js";
import { ThemeToggle } from "./ThemeToggle.js";

export const APP_NAME = "g-tee-oh";

export function AppHeader() {
  const me = useMe();
  const logout = useLogout();
  const email = me.data?.user.email;
  return (
    <header data-testid="app-header" className="flex items-center gap-3 border-b border-border px-4 py-2">
      <p className="text-lg font-semibold">{APP_NAME}</p>
      <div className="ml-auto flex items-center gap-2">
        {email === undefined ? null : <span className="text-sm text-muted">{email}</span>}
        <ThemeToggle />
        <Button variant="secondary" size="sm" onClick={() => logout.mutate()} disabled={logout.isPending}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
