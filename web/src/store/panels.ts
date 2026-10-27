/**
 * Panel visibility toggles (R3.13, A7 section 3). One boolean per TrainerSettings.panels key,
 * all off by default; setPanels takes the settings' panels object, where an absent key means off,
 * so it replaces the whole map rather than merging into the previous one. Updates are immutable.
 */
import { create } from "zustand";

import type { PanelKey, TrainerSettings } from "../contracts.js";

export type PanelMap = Readonly<Record<PanelKey, boolean>>;

/** Every panel key; the Record type below fails to compile if the contract adds or drops one. */
const PANEL_KEY_SET: Readonly<Record<PanelKey, true>> = {
  action_frequency_table: true,
  draw_breakdown: true,
  equity_distribution_chart: true,
  hand_class: true,
  hero_range_matrix: true,
  hero_strategy_matrix: true,
  made_hand_breakdown: true,
  range_advantage: true,
  rng_roller: true,
  streak_counter: true,
  threshold_card: true,
  villain_range_matrix: true,
};

export const PANEL_KEYS: readonly PanelKey[] = Object.keys(PANEL_KEY_SET) as PanelKey[];

function panelsFrom(settings: TrainerSettings["panels"]): PanelMap {
  return Object.fromEntries(PANEL_KEYS.map((key) => [key, settings[key] === true])) as PanelMap;
}

export interface PanelState {
  panels: PanelMap;
  togglePanel: (key: PanelKey) => void;
  setPanels: (panels: TrainerSettings["panels"]) => void;
}

export function createPanelStore() {
  return create<PanelState>()((set) => ({
    panels: panelsFrom({}),
    togglePanel: (key) => set((state) => ({ panels: { ...state.panels, [key]: !state.panels[key] } })),
    setPanels: (panels) => set({ panels: panelsFrom(panels) }),
  }));
}

/** The app's panel toggle store. */
export const usePanelStore = createPanelStore();
