/**
 * The Main navigation entries (R3.13, A7 section 2): every app route without a path parameter.
 * The drill routes with an id (/drills/$id, /drills/$id/run) are reached from the drill library.
 *
 * exact: the link is active only on its own path. Home and Drills need it, because "/" and
 * "/drills" prefix other entries; Settings is active on every /settings/<section> page (O-360),
 * Library on every /library/<section> page and New drill on every /drills/new/<section> page (S40,
 * O-405, O-406).
 */
export const NAV_ITEMS = [
  { to: "/", label: "Home", exact: true },
  { to: "/train", label: "Train", exact: true },
  { to: "/drills", label: "Drills", exact: true },
  { to: "/drills/new", label: "New drill", exact: false },
  { to: "/study", label: "Study", exact: true },
  { to: "/predict", label: "Predict", exact: true },
  { to: "/paint", label: "Paint", exact: true },
  { to: "/progress", label: "Progress", exact: true },
  { to: "/library", label: "Library", exact: false },
  { to: "/settings", label: "Settings", exact: false },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
