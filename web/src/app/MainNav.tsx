/**
 * The Main navigation landmark (R3.13, A7 section 2; S36, O-346). Each entry is a router Link; the
 * router sets aria-current="page" on the active one (exact per entry, nav-items.ts). The active
 * link is raised and bold as well as accent coloured, so colour is never the only signal (A7
 * section 4).
 *
 * Layout: from md up a raised sidebar panel that stays in view; at phone width one row of pills
 * that scrolls sideways instead of wrapping into several lines. Every link takes the shared
 * tactile press, flat at rest except the active one.
 */
import { Link } from "@tanstack/react-router";

import { cn, FLAT_REST_CLASS, TACTILE_CLASS } from "../components/ui/index.js";
import { NAV_ITEMS } from "./nav-items.js";

const LINK_CLASSES = cn("block whitespace-nowrap rounded-xl px-3 py-2 text-sm", TACTILE_CLASS);
// Active and inactive classes never overlap, so no two utilities compete for one property.
const ACTIVE_CLASSES = "bg-surface-raised font-semibold text-accent";
const INACTIVE_CLASSES = cn("text-text hover:bg-surface-sunken", FLAT_REST_CLASS);
const PANEL_CLASSES =
  "-mx-4 md:sticky md:top-20 md:mx-0 md:w-52 md:shrink-0 md:self-start md:rounded-2xl md:border md:border-border/50 md:bg-surface-raised md:p-2 md:raised";

export function MainNav() {
  return (
    <nav aria-label="Main" className={PANEL_CLASSES}>
      <ul className="flex flex-nowrap gap-1 overflow-x-auto px-4 py-1 md:flex-col md:overflow-visible md:px-0 md:py-0">
        {NAV_ITEMS.map((item) => (
          <li key={item.to} className="shrink-0">
            <Link
              to={item.to}
              activeOptions={{ exact: item.exact }}
              className={LINK_CLASSES}
              activeProps={{ className: ACTIVE_CLASSES }}
              inactiveProps={{ className: INACTIVE_CLASSES }}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
