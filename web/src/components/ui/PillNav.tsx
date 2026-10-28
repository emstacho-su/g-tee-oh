/**
 * The nav pill list (S36 review): a labelled nav whose list is one row of pills that scrolls
 * sideways at phone width and a column from md up. The Main navigation and the settings section
 * list both render through it; their links spread NAV_PILL_LINK_PROPS into a router Link, so the
 * pill look and the active state are defined once. The active and inactive classes never overlap,
 * so no two utilities compete for one property, and the active pill is raised and bold as well as
 * accent coloured (colour is never the only signal, A7 section 4).
 */
import type { ReactNode } from "react";

import { cn } from "./cn.js";
import { FLAT_REST_CLASS, TACTILE_CLASS } from "./tactile.js";

export const NAV_PILL_LINK_PROPS = {
  className: cn("block whitespace-nowrap rounded-xl px-3 py-2 text-sm", TACTILE_CLASS),
  activeProps: { className: "bg-surface-raised font-semibold text-accent" },
  inactiveProps: { className: cn("text-text hover:bg-surface-sunken", FLAT_REST_CLASS) },
} as const;

export interface PillNavProps {
  label: string;
  /** Classes for the nav itself (a raised sidebar panel, a width). */
  className?: string;
  /** The list items, each an <li className="shrink-0"> holding one link. */
  children: ReactNode;
}

export function PillNav({ label, className, children }: PillNavProps) {
  return (
    <nav aria-label={label} className={cn("-mx-4 md:mx-0", className)}>
      <ul className="flex flex-nowrap gap-1 overflow-x-auto px-4 py-1 md:flex-col md:overflow-visible md:px-0 md:py-0">{children}</ul>
    </nav>
  );
}
