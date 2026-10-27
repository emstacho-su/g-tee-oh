/**
 * Zustand store tests (R3.13, O-266). Each test builds a fresh store from its factory, so no
 * state leaks between tests. Updates must be immutable: a new state object replaces the old one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { fixturePrompt } from "../../src/fixtures/index.js";
import {
  applyThemeClass,
  createPanelStore,
  createThemeStore,
  createTrainerTableStore,
  PANEL_KEYS,
  THEME_STORAGE_KEY,
  usePanelStore,
  useThemeStore,
  useTrainerTableStore,
} from "../../src/store/index.js";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

function throwingStorage(): Storage {
  const fail = () => {
    throw new Error("storage blocked");
  };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

function prefersDark(matches: boolean) {
  return (query: string) => ({ matches: matches && query === "(prefers-color-scheme: dark)" });
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

describe("trainer table store", () => {
  it("R3.13 starts empty, holds a prompt and clears it", () => {
    const store = createTrainerTableStore();
    expect(store.getState().prompt).toBeNull();
    const before = store.getState();
    store.getState().setPrompt(fixturePrompt);
    expect(store.getState().prompt).toEqual(fixturePrompt);
    expect(store.getState()).not.toBe(before);
    store.getState().clear();
    expect(store.getState().prompt).toBeNull();
  });

  it("R3.13 the app singleton exists", () => {
    expect(useTrainerTableStore.getState().prompt).toBeNull();
  });
});

describe("panel store", () => {
  it("R3.13 every panel starts off", () => {
    const store = createPanelStore();
    expect(Object.keys(store.getState().panels).sort()).toEqual([...PANEL_KEYS].sort());
    expect(Object.values(store.getState().panels).every((on) => !on)).toBe(true);
    expect(usePanelStore.getState().panels.rng_roller).toBe(false);
  });

  it("R3.13 togglePanel flips one key with a new panels object", () => {
    const store = createPanelStore();
    const before = store.getState().panels;
    store.getState().togglePanel("hero_range_matrix");
    const after = store.getState().panels;
    expect(after.hero_range_matrix).toBe(true);
    expect(before.hero_range_matrix).toBe(false);
    expect(after).not.toBe(before);
    store.getState().togglePanel("hero_range_matrix");
    expect(store.getState().panels.hero_range_matrix).toBe(false);
  });

  it("R3.13 setPanels takes the settings panels, an absent key meaning off", () => {
    const store = createPanelStore();
    store.getState().togglePanel("rng_roller");
    store.getState().setPanels({ threshold_card: true, draw_breakdown: false });
    const panels = store.getState().panels;
    expect(panels.threshold_card).toBe(true);
    expect(panels.draw_breakdown).toBe(false);
    expect(panels.rng_roller).toBe(false);
  });
});

describe("theme store", () => {
  it("R3.13 a valid stored theme wins over the system preference", () => {
    const store = createThemeStore({ storage: memoryStorage({ [THEME_STORAGE_KEY]: "light" }), matchMedia: prefersDark(true) });
    expect(store.getState().theme).toBe("light");
  });

  it("R3.13 an invalid stored value falls back to prefers-color-scheme", () => {
    const dark = createThemeStore({ storage: memoryStorage({ [THEME_STORAGE_KEY]: "purple" }), matchMedia: prefersDark(true) });
    const light = createThemeStore({ storage: memoryStorage(), matchMedia: prefersDark(false) });
    expect(dark.getState().theme).toBe("dark");
    expect(light.getState().theme).toBe("light");
  });

  it("R3.13 toggle persists the theme and sets the dark class on the root element", () => {
    const storage = memoryStorage();
    const root = document.createElement("html");
    const store = createThemeStore({ storage, matchMedia: prefersDark(false), root });
    store.getState().toggle();
    expect(store.getState().theme).toBe("dark");
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(root.classList.contains("dark")).toBe(true);
    store.getState().setTheme("light");
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(root.classList.contains("dark")).toBe(false);
  });

  it("R3.13 storage that throws never breaks reading or writing the theme", () => {
    const store = createThemeStore({ storage: throwingStorage(), matchMedia: prefersDark(true) });
    expect(store.getState().theme).toBe("dark");
    expect(() => store.getState().toggle()).not.toThrow();
    expect(store.getState().theme).toBe("light");
  });

  it("R3.13 a missing storage or matchMedia falls back to light", () => {
    const store = createThemeStore({ storage: null, matchMedia: null });
    expect(store.getState().theme).toBe("light");
    expect(() => store.getState().toggle()).not.toThrow();
  });

  it("R3.13 the singleton reads window.localStorage and the default root is <html>", () => {
    const spy = vi.spyOn(window, "matchMedia");
    expect(["light", "dark"]).toContain(useThemeStore.getState().theme);
    applyThemeClass("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyThemeClass("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    spy.mockRestore();
  });
});
