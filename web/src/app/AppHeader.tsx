/**
 * The shell header (R3.13, A7 section 2): app name, the signed-in email, the theme toggle and
 * Sign out. Sign out is disabled while its request runs. At phone width the name and the buttons
 * stay on one line each and the email is shortened with an ellipsis (its full text in the title).
 * S36 (O-346): the header stays at the top while the page scrolls, on a translucent ground, with
 * the wordmark beside a small raised accent chip.
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
    <header
      data-testid="app-header"
      className="sticky top-0 z-20 flex items-center gap-3 border-b border-border/50 bg-surface/90 px-4 py-2.5 backdrop-blur md:px-6"
    >
      <div className="flex items-center gap-2">
        {/* A small raised chip in the accent: the wordmark's mark, decorative only. */}
        <span aria-hidden="true" className="raised h-7 w-7 shrink-0 rounded-lg bg-accent" />
        <p className="whitespace-nowrap text-lg font-bold tracking-tight">{APP_NAME}</p>
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        {email === undefined ? null : <span title={email} className="min-w-0 truncate text-sm text-muted">{email}</span>}
        <ThemeToggle />
        <Button variant="secondary" size="sm" className="whitespace-nowrap" onClick={() => logout.mutate()} disabled={logout.isPending}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
