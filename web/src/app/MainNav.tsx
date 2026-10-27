/**
 * The Main navigation landmark (R3.13, A7 section 2). Each entry is a router Link; the router sets
 * aria-current="page" on the active one, and exact matching keeps "/" and "/drills" from staying
 * active on their child routes. The active link is also bold and underlined, so color is never the
 * only signal (A7 section 4).
 */
import { Link } from "@tanstack/react-router";

import { NAV_ITEMS } from "./nav-items.js";

const LINK_CLASSES =
  "block rounded-md px-3 py-2 text-sm text-text hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2";
const ACTIVE_CLASSES = "bg-surface-sunken font-semibold underline";

export function MainNav() {
  return (
    <nav aria-label="Main" className="md:w-48 md:shrink-0">
      <ul className="flex flex-wrap gap-1 md:flex-col">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              activeOptions={{ exact: true }}
              className={LINK_CLASSES}
              activeProps={{ className: ACTIVE_CLASSES }}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
