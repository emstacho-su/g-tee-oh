/**
 * The Main navigation landmark (R3.13, A7 section 2; S36, O-346). Each entry is a router Link; the
 * router sets aria-current="page" on the active one (exact per entry, nav-items.ts). The pill
 * look, the scrolling row at phone width and the active state come from the shared PillNav
 * (components/ui), as the settings section list does.
 *
 * Layout: from md up a raised sidebar panel that stays in view below the sticky header. Its height
 * is capped at the viewport less that offset (top-20, 5rem) and a 1rem gap, and it scrolls inside,
 * so on a short screen every link stays reachable by Tab and by scrolling.
 */
import { Link } from "@tanstack/react-router";

import { NAV_PILL_LINK_PROPS, PillNav } from "../components/ui/index.js";
import { NAV_ITEMS } from "./nav-items.js";

const PANEL_CLASSES =
  "md:sticky md:top-20 md:max-h-[calc(100dvh-6rem)] md:w-52 md:shrink-0 md:self-start md:overflow-y-auto md:rounded-2xl md:border md:border-border/50 md:bg-surface-raised md:p-2 md:raised";

export function MainNav() {
  return (
    <PillNav label="Main" className={PANEL_CLASSES}>
      {NAV_ITEMS.map((item) => (
        <li key={item.to} className="shrink-0">
          <Link to={item.to} activeOptions={{ exact: item.exact, includeSearch: false }} {...NAV_PILL_LINK_PROPS}>
            {item.label}
          </Link>
        </li>
      ))}
    </PillNav>
  );
}
