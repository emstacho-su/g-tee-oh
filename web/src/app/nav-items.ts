/**
 * The Main navigation entries (R3.13, A7 section 2): every app route without a path parameter.
 * The drill routes with an id (/drills/$id, /drills/$id/run) are reached from the drill library.
 */
export const NAV_ITEMS = [
  { to: "/", label: "Home" },
  { to: "/train", label: "Train" },
  { to: "/drills", label: "Drills" },
  { to: "/drills/new", label: "New drill" },
  { to: "/study", label: "Study" },
  { to: "/predict", label: "Predict" },
  { to: "/paint", label: "Paint" },
  { to: "/progress", label: "Progress" },
  { to: "/library", label: "Library" },
  { to: "/settings", label: "Settings" },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
