/**
 * Placeholder screens for the A7 section 2 routes not built yet (R3.13); S25 replaced /study and
 * /drills/$id/run with their screens, S28 /library and /settings, S27 /predict and /paint, S26
 * /drills, /drills/new and /drills/$id. Each shows the screen name from A7 section 2 as its h1 and
 * names the session that builds it, so a visitor (and the router tests) can tell a missing screen
 * from a broken one.
 */

export interface PlaceholderScreen {
  title: string;
  summary: string;
  session: string;
}

export const PLACEHOLDER_SCREENS = {
  train: { title: "Automated training session", summary: "Library-served spots with grading.", session: "Phase 4 (S32)" },
  progress: { title: "Progress", summary: "Rank, tracks, leak-cost trend, mastery heat map, holdout.", session: "S32" },
} as const satisfies Readonly<Record<string, PlaceholderScreen>>;

export type PlaceholderKey = keyof typeof PLACEHOLDER_SCREENS;

export interface PlaceholderPageProps {
  screen: PlaceholderScreen;
}

export function PlaceholderPage({ screen }: PlaceholderPageProps) {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">{screen.title}</h1>
      <p className="text-muted">{screen.summary}</p>
      <p className="text-sm text-muted">Built in {screen.session}.</p>
    </section>
  );
}

/** A route component for one placeholder screen. */
export function placeholderRoute(key: PlaceholderKey) {
  const screen = PLACEHOLDER_SCREENS[key];
  function Placeholder() {
    return <PlaceholderPage screen={screen} />;
  }
  Placeholder.displayName = `Placeholder(${key})`;
  return Placeholder;
}
