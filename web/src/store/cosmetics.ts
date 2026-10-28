/**
 * Equipped cosmetics, one choice per slot (S32, R4.14, O-323, O-279, ADR 0012). The slots are the
 * catalog's kinds: card back, felt and badge; each holds a catalog key or null (the app's standard
 * look, the default).
 *
 * Mechanism: a zustand store persisted under "gto-cosmetics" through guarded storage
 * (guarded-storage.ts): every read and write is inside try and catch, and a stored value is
 * validated on read against the current catalog, so a stale key, a key of another kind or a
 * tampered value falls back to null for that slot. Equipping is a choice only: the server owns the
 * unlocks (GET /progress/streak), and effectiveCosmetics keeps a choice only while it is unlocked,
 * so a locked choice is ignored wherever the app applies cosmetics (CosmeticsRoot, the home badge).
 * Nothing here touches training (ADR 0012).
 */
import { create } from "zustand";

import { isCosmeticOfKind, type CosmeticKind } from "../cosmetics/catalog.js";
import { defaultStorage, isRecord, readJson, writeJson } from "./guarded-storage.js";
import { COSMETICS_STORAGE_KEY } from "./preference-keys.js";

export { COSMETICS_STORAGE_KEY };

export const COSMETIC_SLOTS: readonly CosmeticKind[] = ["card-back", "felt", "badge"];

export type CosmeticChoices = Readonly<Record<CosmeticKind, string | null>>;

export const NO_COSMETICS: CosmeticChoices = { "card-back": null, felt: null, badge: null };

export interface CosmeticsEnvironment {
  storage?: Storage | null;
}

export interface CosmeticsState {
  choices: CosmeticChoices;
  /** Chooses a catalog item of the slot's kind, or null for the standard look. */
  equip: (slot: CosmeticKind, key: string | null) => void;
}

/** Validates a stored value slot by slot; anything not a catalog key of the slot's kind is null. */
export function parseCosmeticChoices(value: unknown): CosmeticChoices {
  if (!isRecord(value)) return NO_COSMETICS;
  const choice = (slot: CosmeticKind): string | null => {
    const stored = value[slot];
    return isCosmeticOfKind(stored, slot) ? stored : null;
  };
  return { "card-back": choice("card-back"), felt: choice("felt"), badge: choice("badge") };
}

/** The choices that are unlocked now; a choice the server has not unlocked is ignored. */
export function effectiveCosmetics(choices: CosmeticChoices, unlockedKeys: ReadonlySet<string>): CosmeticChoices {
  const keep = (key: string | null): string | null => (key !== null && unlockedKeys.has(key) ? key : null);
  return { "card-back": keep(choices["card-back"]), felt: keep(choices.felt), badge: keep(choices.badge) };
}

export function hasAnyChoice(choices: CosmeticChoices): boolean {
  return COSMETIC_SLOTS.some((slot) => choices[slot] !== null);
}

export function createCosmeticsStore(environment: CosmeticsEnvironment = {}) {
  const storage = environment.storage === undefined ? defaultStorage() : environment.storage;
  const initial = parseCosmeticChoices(readJson(storage, COSMETICS_STORAGE_KEY));

  return create<CosmeticsState>()((set, get) => ({
    choices: initial,
    equip: (slot, key) => {
      if (key !== null && !isCosmeticOfKind(key, slot)) throw new RangeError(`${String(key)} is not a ${slot} in the cosmetic catalog`);
      const choices: CosmeticChoices = { ...get().choices, [slot]: key };
      writeJson(storage, COSMETICS_STORAGE_KEY, choices);
      set({ choices });
    },
  }));
}

/** The app's cosmetics store. */
export const useCosmeticsStore = createCosmeticsStore();
