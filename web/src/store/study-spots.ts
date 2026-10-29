/**
 * The study screen's saved spots per browser (S45, R3.27, O-460): the last confirmed spot, the
 * starred spots and the recent searches.
 *
 * Mechanism: a zustand store over three guarded localStorage keys (preference-keys.ts), the
 * session-defaults pattern: storage can be missing or throw, so a failure only means the spots are
 * not remembered past this page. Values are validated on read (study/saved-spots.ts). Every update
 * writes the key it changed and replaces the state with new lists, never mutated ones. reload reads
 * the storage again, which the test setup uses to start each test empty.
 */
import { create } from "zustand";

import { parseLastSpot, parseRecentSpots, parseStarredSpots, pushRecent, spotOf, toggleStar, type StudySpot } from "../study/saved-spots.js";
import type { StudySearch } from "../study/search.js";
import { defaultStorage, readJson, writeJson } from "./guarded-storage.js";
import { STUDY_LAST_SPOT_STORAGE_KEY, STUDY_RECENT_STORAGE_KEY, STUDY_STARRED_STORAGE_KEY } from "./preference-keys.js";

export interface StudySpotsEnvironment {
  storage?: Storage | null;
}

export interface StudySpotsState {
  readonly last: StudySearch | null;
  readonly starred: readonly StudySpot[];
  readonly recent: readonly StudySearch[];
  /** A spot now on screen: the last spot and the newest recent entry; an incomplete search is ignored. */
  recordConfirmed: (search: StudySearch) => void;
  /** Forgets the last spot (Start over); the recent and starred lists stay. */
  clearLast: () => void;
  toggleStar: (search: StudySearch) => void;
  reload: () => void;
}

interface StoredSpots {
  readonly last: StudySearch | null;
  readonly starred: readonly StudySpot[];
  readonly recent: readonly StudySearch[];
}

function readSpots(storage: Storage | null): StoredSpots {
  return {
    last: parseLastSpot(readJson(storage, STUDY_LAST_SPOT_STORAGE_KEY)),
    starred: parseStarredSpots(readJson(storage, STUDY_STARRED_STORAGE_KEY)),
    recent: parseRecentSpots(readJson(storage, STUDY_RECENT_STORAGE_KEY)),
  };
}

export function createStudySpotsStore(environment: StudySpotsEnvironment = {}) {
  const storage = environment.storage === undefined ? defaultStorage() : environment.storage;
  return create<StudySpotsState>()((set, get) => ({
    ...readSpots(storage),
    recordConfirmed: (search) => {
      if (spotOf(search) === undefined) return;
      const recent = pushRecent(get().recent, search);
      writeJson(storage, STUDY_LAST_SPOT_STORAGE_KEY, search);
      writeJson(storage, STUDY_RECENT_STORAGE_KEY, recent);
      set({ last: search, recent });
    },
    clearLast: () => {
      writeJson(storage, STUDY_LAST_SPOT_STORAGE_KEY, null);
      set({ last: null });
    },
    toggleStar: (search) => {
      const starred = toggleStar(get().starred, search);
      writeJson(storage, STUDY_STARRED_STORAGE_KEY, starred);
      set({ starred });
    },
    reload: () => set(readSpots(storage)),
  }));
}

/** The app's saved spots store. */
export const useStudySpotsStore = createStudySpotsStore();
