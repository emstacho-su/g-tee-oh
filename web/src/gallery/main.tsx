/**
 * Component gallery entry (S24, O-267): built only with `vite build --mode harness`, never in the
 * production image. It renders every S24 component with synthetic fixtures so the Playwright
 * shots project can screenshot each one in both themes (O-266). The theme comes from the
 * query string (?theme=dark), so a screenshot never depends on stored state. S25 adds the RNG
 * explainer, roll badge and wired feedback sections (rng-sections.tsx); the feedback range view
 * reads its theme from the app's theme store, so the query-string theme is put into that store
 * in memory only (setState, not setTheme, so nothing is written to localStorage).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { HotkeyRoot } from "../hotkeys/index.js";
import { useThemeStore } from "../store/index.js";
import { DesignSystemSections } from "./design-sections.js";
import { MatrixSections } from "./matrix-sections.js";
import { ProgressSections } from "./progress-sections.js";
import { FeedbackGallerySections } from "./feedback-sections.js";
import { RngSections } from "./rng-sections.js";
import { TableSections, TrainerSections } from "./sections.js";
import "../styles.css";

const DARK = "dark";

function themeFromQuery(): "light" | "dark" {
  return new URLSearchParams(window.location.search).get("theme") === DARK ? "dark" : "light";
}

const theme = themeFromQuery();
document.documentElement.classList.toggle(DARK, theme === "dark");
useThemeStore.setState({ theme });

const container = document.getElementById("root");
if (container === null) throw new Error("gallery: no #root element");

createRoot(container).render(
  <StrictMode>
    <HotkeyRoot>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        <header>
          <h1 className="text-2xl font-bold">Component gallery</h1>
          <p className="text-sm text-muted">S24 components with synthetic data. Press ? for the shortcuts overlay.</p>
        </header>
        <DesignSystemSections />
        <TableSections />
        <TrainerSections />
        <FeedbackGallerySections />
        <RngSections />
        <MatrixSections theme={theme} />
        <ProgressSections />
      </main>
    </HotkeyRoot>
  </StrictMode>,
);
