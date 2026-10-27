/**
 * Light and dark theme (R3.13, O-266). The initial theme is the one stored under "gto-theme" in
 * localStorage when that value is valid, else the system preference (prefers-color-scheme), else
 * light. Every change is written back to storage as a convenience and applied as the "dark" class
 * on <html>, which is what Tailwind's dark variant reads (src/styles.css). Storage can be missing
 * or can throw (private windows, blocked site data), so every access is guarded and a failure only
 * means the choice is not remembered. The environment is injectable so tests use fresh stores.
 */
import { create } from "zustand";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "gto-theme";
const DARK_CLASS = "dark";
const DARK_QUERY = "(prefers-color-scheme: dark)";

type MatchMediaFn = (query: string) => { matches: boolean };

export interface ThemeEnvironment {
  storage?: Storage | null;
  matchMedia?: MatchMediaFn | null;
  root?: HTMLElement;
}

export interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

function readStored(storage: Storage | null): Theme | null {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStored(storage: Storage | null, theme: Theme): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage is a convenience only (O-266); the theme still applies for this page.
  }
}

function systemTheme(matchMedia: MatchMediaFn | null): Theme {
  return matchMedia?.(DARK_QUERY).matches === true ? "dark" : "light";
}

function defaultStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function defaultMatchMedia(): MatchMediaFn | null {
  return typeof window.matchMedia === "function" ? (query) => window.matchMedia(query) : null;
}

/** Adds or removes the dark class on the root element (default <html>). */
export function applyThemeClass(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.classList.toggle(DARK_CLASS, theme === "dark");
}

export function createThemeStore(environment: ThemeEnvironment = {}) {
  const storage = environment.storage === undefined ? defaultStorage() : environment.storage;
  const matchMedia = environment.matchMedia === undefined ? defaultMatchMedia() : environment.matchMedia;
  const root = environment.root;
  const initial = readStored(storage) ?? systemTheme(matchMedia);

  return create<ThemeState>()((set, get) => {
    const setTheme = (theme: Theme): void => {
      writeStored(storage, theme);
      applyThemeClass(theme, root);
      set({ theme });
    };
    return {
      theme: initial,
      setTheme,
      toggle: () => setTheme(get().theme === "dark" ? "light" : "dark"),
    };
  });
}

/** The app's theme store; main.tsx applies its theme class before the first render. */
export const useThemeStore = createThemeStore();
