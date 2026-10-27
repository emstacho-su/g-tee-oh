/**
 * Placeholder screens for the A7 section 2 routes not built in S24 (R3.13). Each shows the screen
 * name from A7 section 2 as its h1 and names the session that builds it, so a visitor (and the
 * router tests) can tell a missing screen from a broken one.
 */

export interface PlaceholderScreen {
  title: string;
  summary: string;
  session: string;
}

export const PLACEHOLDER_SCREENS = {
  train: { title: "Automated training session", summary: "Library-served spots with grading.", session: "Phase 4 (S32)" },
  drills: { title: "Drill library", summary: "Tags, import and export, duplicate.", session: "S26" },
  drillNew: { title: "Drill builder", summary: "Build a new drill.", session: "S26" },
  drillEdit: { title: "Drill builder", summary: "Edit this drill.", session: "S26" },
  drillRun: { title: "Drill session", summary: "Play this drill.", session: "S25" },
  study: { title: "Solution browser", summary: "Config, stake, depth, pair, line, then node.", session: "S25" },
  predict: { title: "Prediction drills", summary: "Predict the strategy before it is shown.", session: "S27" },
  paint: { title: "Range painting", summary: "Paint a range and compare it.", session: "S27" },
  progress: { title: "Progress", summary: "Rank, tracks, leak-cost trend, mastery heat map, holdout.", session: "S32" },
  library: { title: "Coverage and builder health", summary: "Coverage view, queue, throughput, storage.", session: "S28" },
  settings: { title: "Settings", summary: "Session defaults, hotkeys, builder schedule, cosmetics.", session: "S25" },
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
